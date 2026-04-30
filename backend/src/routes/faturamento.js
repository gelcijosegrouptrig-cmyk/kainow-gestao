const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../database');
const { autenticar, autorizar } = require('../middleware/auth');
const { registrarLog } = require('../utils/auditoria');
const { obterIP, gerarId } = require('../utils/helpers');

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function competenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function gerarNumeroFatura(bancoId, comp) {
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `FAT-${comp.replace('-', '')}-${bancoId.substring(0, 4).toUpperCase()}-${rand}`;
}

function gerarHashComprovante(dados) {
  return crypto.createHash('sha256').update(JSON.stringify(dados)).digest('hex');
}

function gerarNumeroComprovante(averbacaoId) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `CMP-${ts}-${rand}`;
}

function saldoPrePago(banco_id) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN tipo IN ('CREDITO','BONUS') THEN valor
                            WHEN tipo IN ('DEBITO','ESTORNO') THEN -valor ELSE 0 END), 0) as saldo
    FROM faturamento_creditos WHERE banco_id = ?
  `).get(banco_id);
  return parseFloat(row ? row.saldo : 0);
}

function tarifaParaBanco(banco_id, convenio_id) {
  // Tenta tarifa específica banco × convenio
  let t = db.prepare(`
    SELECT valor_tarifa, modelo_cobranca FROM tarifas_banco_convenio
    WHERE banco_id = ? AND convenio_id = ? AND ativo = 1 LIMIT 1
  `).get(banco_id, convenio_id);
  if (!t) {
    // Fallback: tarifa geral do banco (convenio_id IS NULL)
    t = db.prepare(`
      SELECT valor_tarifa, modelo_cobranca FROM tarifas_banco_convenio
      WHERE banco_id = ? AND convenio_id IS NULL AND ativo = 1 LIMIT 1
    `).get(banco_id);
  }
  if (!t) {
    // Fallback: taxa_averbacao da tabela bancos
    const banco = db.prepare('SELECT taxa_averbacao FROM bancos WHERE id = ?').get(banco_id);
    return { valor: parseFloat(banco?.taxa_averbacao || 20.00), modelo: 'POS_PAGO' };
  }
  return { valor: parseFloat(t.valor_tarifa), modelo: t.modelo_cobranca };
}

// ─────────────────────────────────────────────
// TRIGGER de billing quando averbação é APROVADA
// Chamado internamente por averbacoes.js
// ─────────────────────────────────────────────
function registrarBillingAverbacao(averbacao_id) {
  try {
    const av = db.prepare(`
      SELECT a.*, f.nome as func_nome, f.cpf as func_cpf, f.matricula,
             b.nome as banco_nome, b.codigo_bacen,
             c.nome as conv_nome
      FROM averbacoes a
      LEFT JOIN funcionarios f ON f.id = a.funcionario_id
      LEFT JOIN bancos b ON b.id = a.banco_id
      LEFT JOIN convenios c ON c.id = a.convenio_id
      WHERE a.id = ? AND a.status = 'APROVADA'
    `).get(averbacao_id);

    if (!av) return;

    const { valor: tarifa, modelo } = tarifaParaBanco(av.banco_id, av.convenio_id);
    const comp = av.competencia_inicio || competenciaAtual();
    const [ano, mes] = comp.split('-').map(Number);

    // Garantir ciclo existe
    let ciclo = db.prepare('SELECT * FROM faturamento_ciclos WHERE banco_id = ? AND competencia = ?')
      .get(av.banco_id, comp);

    if (!ciclo) {
      const cicloId = gerarId();
      const venc = `${ano}-${String(mes).padStart(2, '0')}-05`;
      db.prepare(`
        INSERT INTO faturamento_ciclos
          (id, banco_id, competencia, mes, ano, modelo_cobranca, data_vencimento)
        VALUES (?,?,?,?,?,?,?)
      `).run(cicloId, av.banco_id, comp, mes, ano, modelo, venc);
      ciclo = db.prepare('SELECT * FROM faturamento_ciclos WHERE id = ?').get(cicloId);
    }

    // Dados para hash
    const dadosComprovante = {
      averbacao_id: av.id,
      codigo_averbacao: av.codigo_averbacao,
      banco: av.banco_nome,
      convenio: av.conv_nome,
      funcionario_cpf: av.func_cpf,
      valor_parcela: av.valor_parcela,
      prazo_meses: av.prazo_meses,
      tarifa,
      timestamp: new Date().toISOString()
    };
    const hash = gerarHashComprovante(dadosComprovante);
    const numComp = gerarNumeroComprovante(av.id);

    // Verificar se já existe item para esta averbação neste ciclo
    const existeItem = db.prepare('SELECT id FROM faturamento_itens WHERE averbacao_id = ? AND ciclo_id = ?')
      .get(av.id, ciclo.id);

    if (!existeItem) {
      const doBilling = db.transaction(() => {
        // Item do ciclo
        db.prepare(`
          INSERT INTO faturamento_itens
            (id, ciclo_id, averbacao_id, banco_id, convenio_id, funcionario_id,
             codigo_averbacao, tipo_averbacao, valor_parcela, valor_tarifa, hash_comprovante, data_averbacao)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        `).run(gerarId(), ciclo.id, av.id, av.banco_id, av.convenio_id, av.funcionario_id,
               av.codigo_averbacao, av.tipo, av.valor_parcela, tarifa, hash);

        // Comprovante digital
        db.prepare(`
          INSERT INTO faturamento_comprovantes
            (id, averbacao_id, ciclo_id, numero_comprovante, hash_sha256, dados_json,
             banco_id, convenio_id, funcionario_id, valor_tarifa)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(gerarId(), av.id, ciclo.id, numComp, hash,
               JSON.stringify(dadosComprovante),
               av.banco_id, av.convenio_id, av.funcionario_id, tarifa);

        // Atualizar totais do ciclo
        db.prepare(`
          UPDATE faturamento_ciclos SET
            total_averbacoes = total_averbacoes + 1,
            valor_total = valor_total + ?,
            valor_taxa_media = (valor_total + ?) / (total_averbacoes + 1),
            atualizado_em = datetime('now')
          WHERE id = ?
        `).run(tarifa, tarifa, ciclo.id);

        // Se pré-pago: debitar crédito
        if (modelo === 'PRE_PAGO') {
          const saldoAtual = saldoPrePago(av.banco_id);
          const saldoNovo = saldoAtual - tarifa;
          db.prepare(`
            INSERT INTO faturamento_creditos
              (id, banco_id, tipo, valor, saldo_antes, saldo_depois, descricao, referencia_id, referencia_tipo)
            VALUES (?,?,?,?,?,?,?,?,?)
          `).run(gerarId(), av.banco_id, 'DEBITO', tarifa, saldoAtual, saldoNovo,
                 `Averbação ${av.codigo_averbacao} — ${av.tipo}`, av.id, 'AVERBACAO');
        }

        // Gravar hash na averbação
        db.prepare(`UPDATE averbacoes SET taxa_averbacao_cobrada = ?, atualizado_em = datetime('now') WHERE id = ?`)
          .run(tarifa, av.id);
      });

      doBilling();
    }
  } catch (err) {
    console.error('[BILLING] Erro ao registrar billing:', err.message);
  }
}

// ─────────────────────────────────────────────
// GET /api/faturamento/dashboard
// ─────────────────────────────────────────────
router.get('/dashboard', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { mes, ano } = req.query;
    const mesRef = parseInt(mes) || (new Date().getMonth() + 1);
    const anoRef = parseInt(ano) || new Date().getFullYear();
    const comp = `${anoRef}-${String(mesRef).padStart(2, '0')}`;

    // KPIs do mês
    const kpi = db.prepare(`
      SELECT
        COALESCE(SUM(c.total_averbacoes), 0) as total_averbacoes,
        COALESCE(SUM(c.valor_total), 0) as receita_total,
        COUNT(DISTINCT c.banco_id) as bancos_ativos,
        COALESCE(AVG(c.valor_taxa_media), 0) as taxa_media
      FROM faturamento_ciclos c
      WHERE c.competencia = ?
    `).get(comp);

    // Receita por banco no mês
    const porBanco = db.prepare(`
      SELECT b.nome as banco_nome, b.id as banco_id,
             c.total_averbacoes, c.valor_total, c.status,
             c.modelo_cobranca, c.data_vencimento,
             COALESCE(
               (SELECT SUM(valor) FROM faturamento_creditos cr WHERE cr.banco_id = b.id AND cr.tipo IN ('CREDITO','BONUS'))
               - (SELECT COALESCE(SUM(valor),0) FROM faturamento_creditos cr WHERE cr.banco_id = b.id AND cr.tipo IN ('DEBITO','ESTORNO'))
             , 0) as saldo_prepago
      FROM faturamento_ciclos c
      JOIN bancos b ON b.id = c.banco_id
      WHERE c.competencia = ?
      ORDER BY c.valor_total DESC
    `).all(comp);

    // Histórico últimos 6 meses
    const historico = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(anoRef, mesRef - 1 - i, 1);
      const m = d.getMonth() + 1;
      const a = d.getFullYear();
      const c2 = `${a}-${String(m).padStart(2, '0')}`;
      const row = db.prepare(`
        SELECT COALESCE(SUM(total_averbacoes),0) as qtd, COALESCE(SUM(valor_total),0) as receita
        FROM faturamento_ciclos WHERE competencia = ?
      `).get(c2);
      historico.push({ competencia: c2, qtd: row.qtd, receita: parseFloat(row.receita.toFixed(2)) });
    }

    const mediaReceita = historico.reduce((s, h) => s + h.receita, 0) / 6;

    // Ciclos abertos pendentes de fechamento
    const pendentes = db.prepare(`
      SELECT c.id, c.competencia, c.banco_id, b.nome as banco_nome,
             c.total_averbacoes, c.valor_total, c.status, c.data_vencimento
      FROM faturamento_ciclos c JOIN bancos b ON b.id = c.banco_id
      WHERE c.status IN ('ABERTO','FECHADO') ORDER BY c.competencia DESC LIMIT 20
    `).all();

    res.json({
      periodo: { mes: mesRef, ano: anoRef, competencia: comp },
      kpi: {
        totalAverbacoes: kpi.total_averbacoes,
        receitaTotal: parseFloat(kpi.receita_total.toFixed(2)),
        bancosAtivos: kpi.bancos_ativos,
        taxaMedia: parseFloat(kpi.taxa_media.toFixed(2)),
        projecaoAnual: parseFloat((mediaReceita * 12).toFixed(2))
      },
      porBanco,
      historico,
      ciclosPendentes: pendentes
    });
  } catch (err) {
    console.error('Erro faturamento dashboard:', err);
    res.status(500).json({ erro: 'Erro ao carregar dashboard de faturamento', detalhe: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/ciclos — listar ciclos
// ─────────────────────────────────────────────
router.get('/ciclos', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { banco_id, status, competencia, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = '1=1';
    const params = [];
    if (banco_id) { where += ' AND c.banco_id = ?'; params.push(banco_id); }
    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (competencia) { where += ' AND c.competencia = ?'; params.push(competencia); }

    const total = db.prepare(`SELECT COUNT(*) as n FROM faturamento_ciclos c WHERE ${where}`).get(...params).n;
    const ciclos = db.prepare(`
      SELECT c.*, b.nome as banco_nome, b.codigo_bacen,
             (SELECT COUNT(*) FROM faturamento_itens i WHERE i.ciclo_id = c.id) as itens_count
      FROM faturamento_ciclos c
      JOIN bancos b ON b.id = c.banco_id
      WHERE ${where}
      ORDER BY c.competencia DESC, c.criado_em DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    res.json({ data: ciclos, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/faturamento/ciclos/fechar — Fechar ciclo (gerar fatura)
// ─────────────────────────────────────────────
router.post('/ciclos/fechar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { ciclo_id, observacoes } = req.body;
    if (!ciclo_id) return res.status(400).json({ erro: 'ciclo_id é obrigatório' });

    const ciclo = db.prepare('SELECT * FROM faturamento_ciclos WHERE id = ?').get(ciclo_id);
    if (!ciclo) return res.status(404).json({ erro: 'Ciclo não encontrado' });
    if (!['ABERTO', 'FECHADO'].includes(ciclo.status)) {
      return res.status(422).json({ erro: `Ciclo já está com status: ${ciclo.status}` });
    }

    const banco = db.prepare('SELECT * FROM bancos WHERE id = ?').get(ciclo.banco_id);
    const numFatura = gerarNumeroFatura(ciclo.banco_id, ciclo.competencia);

    // Recalcular totais
    const totais = db.prepare(`
      SELECT COUNT(*) as qtd, COALESCE(SUM(valor_tarifa),0) as total
      FROM faturamento_itens WHERE ciclo_id = ?
    `).get(ciclo_id);

    db.prepare(`
      UPDATE faturamento_ciclos SET
        status = 'FATURADO',
        numero_fatura = ?,
        total_averbacoes = ?,
        valor_total = ?,
        valor_taxa_media = CASE WHEN ? > 0 THEN ? / ? ELSE 0 END,
        data_fechamento = datetime('now'),
        faturado_por = ?,
        observacoes = ?,
        atualizado_em = datetime('now')
      WHERE id = ?
    `).run(numFatura, totais.qtd, totais.total,
           totais.qtd, totais.total, totais.qtd,
           req.usuario.id, observacoes || null, ciclo_id);

    registrarLog(db, req.usuario.id, 'CICLO_FATURAMENTO_FECHADO', 'FATURAMENTO', ciclo_id, null, obterIP(req));

    const cicloAtualizado = db.prepare('SELECT * FROM faturamento_ciclos WHERE id = ?').get(ciclo_id);
    res.json({
      mensagem: 'Ciclo fechado e fatura gerada com sucesso',
      numero_fatura: numFatura,
      ciclo: cicloAtualizado,
      banco: banco?.nome
    });
  } catch (err) {
    console.error('Erro fechar ciclo:', err);
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/faturamento/ciclos/registrar-pagamento
// ─────────────────────────────────────────────
router.post('/ciclos/registrar-pagamento', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { ciclo_id, observacoes } = req.body;
    if (!ciclo_id) return res.status(400).json({ erro: 'ciclo_id é obrigatório' });

    const ciclo = db.prepare('SELECT * FROM faturamento_ciclos WHERE id = ?').get(ciclo_id);
    if (!ciclo) return res.status(404).json({ erro: 'Ciclo não encontrado' });
    if (ciclo.status !== 'FATURADO') {
      return res.status(422).json({ erro: `Somente ciclos FATURADO podem ter pagamento registrado. Status atual: ${ciclo.status}` });
    }

    db.prepare(`
      UPDATE faturamento_ciclos SET
        status = 'PAGO', data_pagamento = datetime('now'),
        observacoes = COALESCE(?, observacoes),
        atualizado_em = datetime('now')
      WHERE id = ?
    `).run(observacoes || null, ciclo_id);

    registrarLog(db, req.usuario.id, 'CICLO_PAGAMENTO_REGISTRADO', 'FATURAMENTO', ciclo_id, null, obterIP(req));
    res.json({ mensagem: 'Pagamento registrado com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/ciclos/:id — Detalhe do ciclo com itens
// ─────────────────────────────────────────────
router.get('/ciclos/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const ciclo = db.prepare(`
      SELECT c.*, b.nome as banco_nome, b.codigo_bacen, b.cnpj as banco_cnpj
      FROM faturamento_ciclos c JOIN bancos b ON b.id = c.banco_id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!ciclo) return res.status(404).json({ erro: 'Ciclo não encontrado' });

    const itens = db.prepare(`
      SELECT i.*, f.nome as func_nome, f.cpf as func_cpf,
             c2.nome as convenio_nome
      FROM faturamento_itens i
      LEFT JOIN funcionarios f ON f.id = i.funcionario_id
      LEFT JOIN convenios c2 ON c2.id = i.convenio_id
      WHERE i.ciclo_id = ?
      ORDER BY i.criado_em DESC
    `).all(req.params.id);

    res.json({ ciclo, itens });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/extrato — Extrato por banco/período
// ─────────────────────────────────────────────
router.get('/extrato', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { banco_id, inicio, fim, page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = '1=1';
    const params = [];
    if (banco_id) { where += ' AND i.banco_id = ?'; params.push(banco_id); }
    if (inicio) { where += ' AND i.data_averbacao >= ?'; params.push(inicio); }
    if (fim) { where += ' AND i.data_averbacao <= ?'; params.push(fim + ' 23:59:59'); }

    const total = db.prepare(`SELECT COUNT(*) as n FROM faturamento_itens i WHERE ${where}`).get(...params).n;
    const itens = db.prepare(`
      SELECT i.*, b.nome as banco_nome, c.nome as convenio_nome,
             f.nome as func_nome, f.cpf as func_cpf
      FROM faturamento_itens i
      JOIN bancos b ON b.id = i.banco_id
      JOIN convenios c ON c.id = i.convenio_id
      JOIN funcionarios f ON f.id = i.funcionario_id
      WHERE ${where}
      ORDER BY i.data_averbacao DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    const totalReceita = db.prepare(`
      SELECT COALESCE(SUM(valor_tarifa), 0) as total FROM faturamento_itens i WHERE ${where}
    `).get(...params).total;

    registrarLog(db, req.usuario.id, 'EXTRATO_FATURAMENTO_CONSULTADO', 'FATURAMENTO', null, null, obterIP(req));
    res.json({ data: itens, total, totalReceita: parseFloat(totalReceita.toFixed(2)), page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/comprovante/:averbacao_id
// ─────────────────────────────────────────────
router.get('/comprovante/:averbacao_id', autenticar, (req, res) => {
  try {
    const comp = db.prepare(`
      SELECT fc.*, b.nome as banco_nome, c.nome as convenio_nome,
             f.nome as func_nome, f.cpf as func_cpf, f.matricula,
             av.codigo_averbacao, av.tipo, av.valor_parcela, av.prazo_meses,
             av.competencia_inicio, av.status as status_averbacao
      FROM faturamento_comprovantes fc
      JOIN averbacoes av ON av.id = fc.averbacao_id
      JOIN bancos b ON b.id = fc.banco_id
      JOIN convenios c ON c.id = fc.convenio_id
      JOIN funcionarios f ON f.id = fc.funcionario_id
      WHERE fc.averbacao_id = ? AND fc.status = 'VALIDO'
      ORDER BY fc.criado_em DESC LIMIT 1
    `).get(req.params.averbacao_id);

    if (!comp) return res.status(404).json({ erro: 'Comprovante não encontrado ou averbação não faturada' });

    // Verificação de integridade
    const dadosOriginais = JSON.parse(comp.dados_json || '{}');
    const hashVerif = gerarHashComprovante(dadosOriginais);
    const integridadeOk = hashVerif === comp.hash_sha256;

    res.json({
      numero_comprovante: comp.numero_comprovante,
      timestamp_emissao: comp.timestamp_emissao,
      integridade: integridadeOk ? 'VÁLIDA ✅' : 'VIOLADA ⚠️',
      hash_sha256: comp.hash_sha256,
      averbacao: {
        codigo: comp.codigo_averbacao,
        tipo: comp.tipo,
        valor_parcela: comp.valor_parcela,
        prazo_meses: comp.prazo_meses,
        competencia_inicio: comp.competencia_inicio,
        status: comp.status_averbacao
      },
      funcionario: {
        nome: comp.func_nome,
        cpf: comp.func_cpf ? comp.func_cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '***',
        matricula: comp.matricula
      },
      banco: { nome: comp.banco_nome },
      convenio: { nome: comp.convenio_nome },
      faturamento: { valor_tarifa: comp.valor_tarifa, status: comp.status }
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/nota/:averbacao_id — Nota de cobrança
// ─────────────────────────────────────────────
router.get('/nota/:averbacao_id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const av = db.prepare(`
      SELECT a.*, f.nome as func_nome, f.cpf as func_cpf, f.matricula,
             b.nome as banco_nome, b.codigo_bacen, b.taxa_averbacao,
             c.nome as conv_nome, c.cnpj as conv_cnpj
      FROM averbacoes a
      LEFT JOIN funcionarios f ON f.id = a.funcionario_id
      LEFT JOIN bancos b ON b.id = a.banco_id
      LEFT JOIN convenios c ON c.id = a.convenio_id
      WHERE a.id = ? AND a.status = 'APROVADA'
    `).get(req.params.averbacao_id);

    if (!av) return res.status(404).json({ erro: 'Averbação não encontrada ou não aprovada' });

    const { valor: tarifa } = tarifaParaBanco(av.banco_id, av.convenio_id);
    const comp = db.prepare('SELECT * FROM faturamento_comprovantes WHERE averbacao_id = ? LIMIT 1')
      .get(av.id);

    const nota = {
      numero: `NF-${av.competencia_inicio?.replace('-', '')}-${av.codigo_averbacao.slice(-8)}`,
      emitidaEm: new Date().toISOString(),
      sistema: 'AverbaTech — Gestão de Margem Consignável',
      cnpjEmissor: process.env.CNPJ_EMISSOR || '00.000.000/0001-00',
      hash_comprovante: comp?.hash_sha256 || null,
      numero_comprovante: comp?.numero_comprovante || null,
      averbacao: {
        codigo: av.codigo_averbacao,
        tipo: av.tipo,
        valor_parcela: av.valor_parcela,
        prazo_meses: av.prazo_meses,
        data_aprovacao: av.data_aprovacao || av.criado_em
      },
      funcionario: {
        nome: av.func_nome,
        cpf: av.func_cpf ? av.func_cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '***',
        matricula: av.matricula
      },
      banco: { nome: av.banco_nome, codigo: av.codigo_bacen },
      convenio: { nome: av.conv_nome, cnpj: av.conv_cnpj },
      cobranca: { descricao: 'Taxa de Averbação — Gestão de Margem Consignável', valor: tarifa, moeda: 'BRL' }
    };

    registrarLog(db, req.usuario.id, 'NOTA_FATURAMENTO_GERADA', 'FATURAMENTO', req.params.averbacao_id, null, obterIP(req));
    res.json(nota);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/relatorio-banco — Relatório consolidado por banco
// ─────────────────────────────────────────────
router.get('/relatorio-banco', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { ano } = req.query;
    const anoRef = parseInt(ano) || new Date().getFullYear();

    const relatorio = db.prepare(`
      SELECT b.id as banco_id, b.nome as banco_nome, b.codigo_bacen, b.taxa_averbacao,
             COUNT(c.id) as ciclos,
             COALESCE(SUM(c.total_averbacoes), 0) as total_averbacoes,
             COALESCE(SUM(c.valor_total), 0) as receita_total,
             COALESCE(AVG(c.valor_taxa_media), b.taxa_averbacao) as taxa_media,
             SUM(CASE WHEN c.status = 'PAGO' THEN c.valor_total ELSE 0 END) as receita_paga,
             SUM(CASE WHEN c.status IN ('ABERTO','FECHADO','FATURADO') THEN c.valor_total ELSE 0 END) as receita_pendente
      FROM bancos b
      LEFT JOIN faturamento_ciclos c ON c.banco_id = b.id AND c.ano = ?
      WHERE b.ativo = 1
      GROUP BY b.id ORDER BY receita_total DESC
    `).all(anoRef);

    // Saldo pré-pago por banco
    relatorio.forEach(r => {
      r.saldo_prepago = saldoPrePago(r.banco_id);
      r.receita_total = parseFloat((r.receita_total || 0).toFixed(2));
      r.receita_paga = parseFloat((r.receita_paga || 0).toFixed(2));
      r.receita_pendente = parseFloat((r.receita_pendente || 0).toFixed(2));
    });

    const totGeral = relatorio.reduce((s, r) => s + r.receita_total, 0);

    registrarLog(db, req.usuario.id, 'RELATORIO_BANCO_GERADO', 'FATURAMENTO', null, null, obterIP(req));
    res.json({
      ano: anoRef,
      geradoEm: new Date().toISOString(),
      totalGeral: parseFloat(totGeral.toFixed(2)),
      bancos: relatorio
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// TARIFAS — CRUD
// ─────────────────────────────────────────────
router.get('/tarifas', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const tarifas = db.prepare(`
      SELECT t.*, b.nome as banco_nome, c.nome as convenio_nome
      FROM tarifas_banco_convenio t
      JOIN bancos b ON b.id = t.banco_id
      LEFT JOIN convenios c ON c.id = t.convenio_id
      ORDER BY b.nome, t.criado_em DESC
    `).all();
    res.json(tarifas);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/tarifas', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { banco_id, convenio_id, nome_tarifa, valor_tarifa, modelo_cobranca, vencimento_dia, observacoes } = req.body;
    if (!banco_id || !nome_tarifa || !valor_tarifa) {
      return res.status(400).json({ erro: 'banco_id, nome_tarifa e valor_tarifa são obrigatórios' });
    }
    if (!['POS_PAGO', 'PRE_PAGO'].includes(modelo_cobranca || 'POS_PAGO')) {
      return res.status(400).json({ erro: 'modelo_cobranca deve ser POS_PAGO ou PRE_PAGO' });
    }

    const id = gerarId();
    db.prepare(`
      INSERT INTO tarifas_banco_convenio
        (id, banco_id, convenio_id, nome_tarifa, valor_tarifa, modelo_cobranca, vencimento_dia, observacoes, criado_por)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id, banco_id, convenio_id || null, nome_tarifa, parseFloat(valor_tarifa),
           modelo_cobranca || 'POS_PAGO', parseInt(vencimento_dia || 5), observacoes || null, req.usuario.id);

    registrarLog(db, req.usuario.id, 'TARIFA_CRIADA', 'FATURAMENTO', id, null, obterIP(req));
    res.status(201).json({ id, mensagem: 'Tarifa criada com sucesso' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: 'Já existe tarifa para este banco/convênio' });
    res.status(500).json({ erro: err.message });
  }
});

router.put('/tarifas/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { nome_tarifa, valor_tarifa, modelo_cobranca, vencimento_dia, ativo, observacoes } = req.body;
    const tarifa = db.prepare('SELECT * FROM tarifas_banco_convenio WHERE id = ?').get(req.params.id);
    if (!tarifa) return res.status(404).json({ erro: 'Tarifa não encontrada' });

    db.prepare(`
      UPDATE tarifas_banco_convenio SET
        nome_tarifa = COALESCE(?, nome_tarifa),
        valor_tarifa = COALESCE(?, valor_tarifa),
        modelo_cobranca = COALESCE(?, modelo_cobranca),
        vencimento_dia = COALESCE(?, vencimento_dia),
        ativo = COALESCE(?, ativo),
        observacoes = COALESCE(?, observacoes),
        atualizado_em = datetime('now')
      WHERE id = ?
    `).run(nome_tarifa || null, valor_tarifa ? parseFloat(valor_tarifa) : null,
           modelo_cobranca || null, vencimento_dia ? parseInt(vencimento_dia) : null,
           ativo !== undefined ? (ativo ? 1 : 0) : null, observacoes || null, req.params.id);

    registrarLog(db, req.usuario.id, 'TARIFA_ATUALIZADA', 'FATURAMENTO', req.params.id, null, obterIP(req));
    res.json({ mensagem: 'Tarifa atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// CRÉDITOS PRÉ-PAGOS
// ─────────────────────────────────────────────
router.get('/creditos', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { banco_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = '1=1';
    const params = [];
    if (banco_id) { where += ' AND cr.banco_id = ?'; params.push(banco_id); }

    const registros = db.prepare(`
      SELECT cr.*, b.nome as banco_nome
      FROM faturamento_creditos cr
      JOIN bancos b ON b.id = cr.banco_id
      WHERE ${where}
      ORDER BY cr.criado_em DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    // Saldos por banco
    const saldos = db.prepare(`
      SELECT cr.banco_id, b.nome as banco_nome,
             SUM(CASE WHEN cr.tipo IN ('CREDITO','BONUS') THEN cr.valor ELSE -cr.valor END) as saldo
      FROM faturamento_creditos cr
      JOIN bancos b ON b.id = cr.banco_id
      GROUP BY cr.banco_id
    `).all();

    res.json({ registros, saldos });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/creditos', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { banco_id, tipo, valor, descricao } = req.body;
    if (!banco_id || !tipo || !valor || !descricao) {
      return res.status(400).json({ erro: 'banco_id, tipo, valor e descricao são obrigatórios' });
    }
    if (!['CREDITO', 'BONUS', 'ESTORNO'].includes(tipo)) {
      return res.status(400).json({ erro: 'tipo deve ser CREDITO, BONUS ou ESTORNO' });
    }

    const banco = db.prepare('SELECT * FROM bancos WHERE id = ? AND ativo = 1').get(banco_id);
    if (!banco) return res.status(404).json({ erro: 'Banco não encontrado' });

    const saldoAtual = saldoPrePago(banco_id);
    const saldoNovo = tipo === 'ESTORNO' ? saldoAtual + parseFloat(valor) : saldoAtual + parseFloat(valor);
    const id = gerarId();

    db.prepare(`
      INSERT INTO faturamento_creditos
        (id, banco_id, tipo, valor, saldo_antes, saldo_depois, descricao, criado_por)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, banco_id, tipo, parseFloat(valor), saldoAtual, saldoNovo, descricao, req.usuario.id);

    registrarLog(db, req.usuario.id, `CREDITO_${tipo}`, 'FATURAMENTO', id, null, obterIP(req));
    res.status(201).json({ id, saldo_anterior: saldoAtual, saldo_atual: saldoNovo, mensagem: `${tipo} registrado com sucesso` });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/projecao — Projeção de receita
// ─────────────────────────────────────────────
router.get('/projecao', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const { vidas = 1000, taxa = 20 } = req.query;
    const vidasN = parseInt(vidas);
    const taxaN = parseFloat(taxa);

    // Histórico real
    const historico = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const m = d.getMonth() + 1;
      const a = d.getFullYear();
      const comp = `${a}-${String(m).padStart(2, '0')}`;
      const row = db.prepare(`
        SELECT COALESCE(SUM(total_averbacoes),0) as qtd, COALESCE(SUM(valor_total),0) as receita
        FROM faturamento_ciclos WHERE competencia = ?
      `).get(comp);
      historico.push({ competencia: comp, qtd: row.qtd, receita: parseFloat(row.receita.toFixed(2)) });
    }

    const mediaQtd = historico.reduce((s, h) => s + h.qtd, 0) / 12 || 0;
    const mediaReceita = historico.reduce((s, h) => s + h.receita, 0) / 12 || 0;

    // Projeção com base em vidas informadas
    // Assume 5% de averbações novas/mês por vida
    const taxaAdesao = 0.05;
    const averbacoesMes = Math.round(vidasN * taxaAdesao);
    const receitaMes = averbacoesMes * taxaN;

    const projecao12m = [];
    for (let m = 1; m <= 12; m++) {
      projecao12m.push({
        mes: m,
        averbacoes_estimadas: averbacoesMes * m,
        receita_acumulada: parseFloat((receitaMes * m).toFixed(2)),
        receita_mensal: parseFloat(receitaMes.toFixed(2))
      });
    }

    res.json({
      parametros: { vidas: vidasN, taxa_por_averbacao: taxaN, taxa_adesao_mensal: `${(taxaAdesao * 100).toFixed(0)}%` },
      resumo: {
        averbacoes_por_mes: averbacoesMes,
        receita_por_mes: parseFloat(receitaMes.toFixed(2)),
        receita_anual: parseFloat((receitaMes * 12).toFixed(2)),
        break_even_meses: receitaMes > 0 ? Math.ceil(5000 / receitaMes) : 'N/A'
      },
      realizado: { media_averbacoes_mes: Math.round(mediaQtd), media_receita_mes: parseFloat(mediaReceita.toFixed(2)) },
      projecao12m,
      historico
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/faturamento/exportar-fatura/:ciclo_id
// Exportar fatura em JSON detalhado (boleto simulado)
// ─────────────────────────────────────────────
router.get('/exportar-fatura/:ciclo_id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const ciclo = db.prepare(`
      SELECT c.*, b.nome as banco_nome, b.codigo_bacen, b.cnpj as banco_cnpj, b.email_operacional
      FROM faturamento_ciclos c JOIN bancos b ON b.id = c.banco_id
      WHERE c.id = ?
    `).get(req.params.ciclo_id);
    if (!ciclo) return res.status(404).json({ erro: 'Ciclo não encontrado' });

    const itens = db.prepare(`
      SELECT i.*, f.nome as func_nome, f.cpf as func_cpf, c2.nome as conv_nome
      FROM faturamento_itens i
      LEFT JOIN funcionarios f ON f.id = i.funcionario_id
      LEFT JOIN convenios c2 ON c2.id = i.convenio_id
      WHERE i.ciclo_id = ?
      ORDER BY i.data_averbacao
    `).all(req.params.ciclo_id);

    const hashFatura = gerarHashComprovante({ ciclo_id: ciclo.id, numero_fatura: ciclo.numero_fatura, itens: itens.length, valor: ciclo.valor_total });

    const boleto = {
      tipo: 'FATURA_AVERBA_TECH',
      numero_fatura: ciclo.numero_fatura || `RASCUNHO-${ciclo.id.slice(0, 8)}`,
      emitidaEm: new Date().toISOString(),
      hash_integridade: hashFatura,
      emissor: { sistema: 'AverbaTech v2.0', cnpj: process.env.CNPJ_EMISSOR || '00.000.000/0001-00' },
      destinatario: { banco: ciclo.banco_nome, codigo_bacen: ciclo.codigo_bacen, cnpj: ciclo.banco_cnpj },
      periodo: { competencia: ciclo.competencia, mes: ciclo.mes, ano: ciclo.ano },
      vencimento: ciclo.data_vencimento,
      status: ciclo.status,
      resumo: {
        total_averbacoes: ciclo.total_averbacoes,
        valor_total: parseFloat((ciclo.valor_total || 0).toFixed(2)),
        taxa_media: parseFloat((ciclo.valor_taxa_media || 0).toFixed(2))
      },
      clausula_manutencao: 'Conforme contrato vigente, taxa de manutenção de R$ 1,00/funcionário/mês por 48 meses.',
      itens: itens.map(i => ({
        codigo_averbacao: i.codigo_averbacao,
        tipo: i.tipo_averbacao,
        funcionario: i.func_nome,
        cpf: i.func_cpf ? i.func_cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '***',
        convenio: i.conv_nome,
        valor_parcela: i.valor_parcela,
        taxa: i.valor_tarifa,
        hash: i.hash_comprovante,
        data: i.data_averbacao
      }))
    };

    const formato = req.query.formato || 'JSON';
    if (formato === 'JSON') {
      res.setHeader('Content-Disposition', `attachment; filename="fatura-${ciclo.competencia}-${ciclo.banco_nome?.replace(/\s/g, '_')}.json"`);
      return res.json(boleto);
    }

    // CSV simples
    const linhas = ['CÓDIGO_AVERBAÇÃO;TIPO;FUNCIONÁRIO;CPF;CONVÊNIO;VALOR_PARCELA;TAXA;DATA'];
    boleto.itens.forEach(i => {
      linhas.push(`${i.codigo_averbacao};${i.tipo};${i.funcionario};${i.cpf};${i.convenio};${i.valor_parcela};${i.taxa};${i.data}`);
    });
    linhas.push(`;;TOTAL;;;${itens.reduce((s, i) => s + i.valor_tarifa, 0).toFixed(2)};;`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fatura-${ciclo.competencia}.csv"`);
    res.send('\uFEFF' + linhas.join('\n'));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
module.exports.registrarBillingAverbacao = registrarBillingAverbacao;
