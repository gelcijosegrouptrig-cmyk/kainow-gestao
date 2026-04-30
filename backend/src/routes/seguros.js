/**
 * AverbaTech — Módulo Consignação de Facultativos (Seguros)
 * Seguros de vida, saúde, odontológico, farmácia, associações e sindicatos
 * Faturamento recorrente: R$2/mês por linha ativa
 */
const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { autenticar, autorizar } = require('../middleware/auth');

const auth    = autenticar;
const adminRH = autorizar('SUPER_ADMIN','ADMIN','RH');

function gerarCodigoSeguro() {
  return 'SEG-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function competenciaAtual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ─── SEGURADORAS ──────────────────────────────────────────────────────────────

// GET /api/seguros/seguradoras
router.get('/seguradoras', auth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM seguros_facultativos sf WHERE sf.seguradora_id = s.id AND sf.status = 'ATIVO') AS linhas_ativas,
        (SELECT COALESCE(SUM(valor_premio),0) FROM seguros_facultativos sf WHERE sf.seguradora_id = s.id AND sf.status = 'ATIVO') AS volume_mensal
      FROM seguradoras s ORDER BY s.nome
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/seguros/seguradoras
router.post('/seguradoras', auth, adminRH, (req, res) => {
  try {
    const { nome, cnpj, tipo = 'SEGURADORA', responsavel, email, telefone,
            taxa_manutencao = 2.00, modelo_cobranca = 'POS_PAGO' } = req.body;
    if (!nome || !cnpj) return res.status(400).json({ erro: 'nome e cnpj são obrigatórios' });
    const id = uuidv4();
    db.prepare(`INSERT INTO seguradoras (id,nome,cnpj,tipo,responsavel,email,telefone,taxa_manutencao,modelo_cobranca)
                VALUES (?,?,?,?,?,?,?,?,?)`).run(id, nome, cnpj.replace(/\D/g,''), tipo, responsavel, email, telefone, taxa_manutencao, modelo_cobranca);
    res.status(201).json({ id, mensagem: 'Seguradora cadastrada com sucesso' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PUT /api/seguros/seguradoras/:id
router.put('/seguradoras/:id', auth, adminRH, (req, res) => {
  try {
    const { nome, tipo, responsavel, email, telefone, taxa_manutencao, modelo_cobranca, ativo } = req.body;
    db.prepare(`UPDATE seguradoras SET nome=COALESCE(?,nome), tipo=COALESCE(?,tipo),
      responsavel=COALESCE(?,responsavel), email=COALESCE(?,email), telefone=COALESCE(?,telefone),
      taxa_manutencao=COALESCE(?,taxa_manutencao), modelo_cobranca=COALESCE(?,modelo_cobranca),
      ativo=COALESCE(?,ativo), atualizado_em=datetime('now') WHERE id=?`
    ).run(nome, tipo, responsavel, email, telefone, taxa_manutencao, modelo_cobranca, ativo, req.params.id);
    res.json({ mensagem: 'Seguradora atualizada' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── PRODUTOS ─────────────────────────────────────────────────────────────────

// GET /api/seguros/produtos
router.get('/produtos', auth, (req, res) => {
  try {
    const { seguradora_id } = req.query;
    let sql = `SELECT p.*, s.nome AS seguradora_nome FROM produtos_seguro p
               JOIN seguradoras s ON s.id = p.seguradora_id WHERE p.ativo=1`;
    const params = [];
    if (seguradora_id) { sql += ' AND p.seguradora_id=?'; params.push(seguradora_id); }
    res.json(db.prepare(sql + ' ORDER BY p.nome').all(...params));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/seguros/produtos
router.post('/produtos', auth, adminRH, (req, res) => {
  try {
    const { seguradora_id, nome, codigo, descricao, tipo = 'VIDA',
            valor_premio_minimo = 0, valor_premio_maximo,
            taxa_averbacao_ativacao = 5.00, taxa_manutencao_mensal = 2.00 } = req.body;
    if (!seguradora_id || !nome || !codigo) return res.status(400).json({ erro: 'seguradora_id, nome e codigo são obrigatórios' });
    const id = uuidv4();
    db.prepare(`INSERT INTO produtos_seguro (id,seguradora_id,nome,codigo,descricao,tipo,valor_premio_minimo,valor_premio_maximo,taxa_averbacao_ativacao,taxa_manutencao_mensal)
                VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, seguradora_id, nome, codigo, descricao, tipo, valor_premio_minimo, valor_premio_maximo, taxa_averbacao_ativacao, taxa_manutencao_mensal);
    res.status(201).json({ id, mensagem: 'Produto cadastrado' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── SEGUROS FACULTATIVOS ─────────────────────────────────────────────────────

// GET /api/seguros — lista com filtros
router.get('/', auth, (req, res) => {
  try {
    const { status, seguradora_id, convenio_id, funcionario_id, tipo_produto, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = `SELECT sf.*,
        f.nome AS funcionario_nome, f.matricula, f.cpf, f.salario_bruto,
        c.nome AS convenio_nome,
        seg.nome AS seguradora_nome, seg.tipo AS seguradora_tipo,
        p.nome AS produto_nome, p.codigo AS produto_codigo
      FROM seguros_facultativos sf
      JOIN funcionarios f ON f.id = sf.funcionario_id
      JOIN convenios c ON c.id = sf.convenio_id
      JOIN seguradoras seg ON seg.id = sf.seguradora_id
      LEFT JOIN produtos_seguro p ON p.id = sf.produto_id
      WHERE 1=1`;
    const params = [];
    if (status)        { sql += ' AND sf.status=?';         params.push(status); }
    if (seguradora_id) { sql += ' AND sf.seguradora_id=?';  params.push(seguradora_id); }
    if (convenio_id)   { sql += ' AND sf.convenio_id=?';    params.push(convenio_id); }
    if (funcionario_id){ sql += ' AND sf.funcionario_id=?'; params.push(funcionario_id); }
    if (tipo_produto)  { sql += ' AND sf.tipo_produto=?';   params.push(tipo_produto); }

    const total = db.prepare(`SELECT COUNT(*) as n FROM (${sql})`).get(...params).n;
    const data  = db.prepare(sql + ' ORDER BY sf.criado_em DESC LIMIT ? OFFSET ?').all(...params, parseInt(limit), offset);
    res.json({ data, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/seguros/dashboard
router.get('/dashboard', auth, (req, res) => {
  try {
    const comp = competenciaAtual();
    const linhas_ativas    = db.prepare(`SELECT COUNT(*) as n FROM seguros_facultativos WHERE status='ATIVO'`).get().n;
    const volume_mensal    = db.prepare(`SELECT COALESCE(SUM(valor_premio),0) as t FROM seguros_facultativos WHERE status='ATIVO'`).get().t;
    const receita_manutencao = db.prepare(`SELECT COALESCE(SUM(taxa_manutencao_mensal),0) as t FROM seguros_facultativos WHERE status='ATIVO'`).get().t;
    const por_tipo         = db.prepare(`SELECT tipo_produto, COUNT(*) as total, SUM(valor_premio) as volume
                                         FROM seguros_facultativos WHERE status='ATIVO' GROUP BY tipo_produto`).all();
    const por_seguradora   = db.prepare(`SELECT seg.nome, COUNT(sf.id) as linhas, SUM(sf.valor_premio) as volume, SUM(sf.taxa_manutencao_mensal) as receita
                                         FROM seguros_facultativos sf JOIN seguradoras seg ON seg.id=sf.seguradora_id
                                         WHERE sf.status='ATIVO' GROUP BY sf.seguradora_id ORDER BY linhas DESC`).all();
    const lancamentos_mes  = db.prepare(`SELECT COUNT(*) as n, COALESCE(SUM(valor_premio),0) as t FROM seguros_lancamentos WHERE competencia=?`).get(comp);
    const projecao_anual   = receita_manutencao * 12;
    res.json({ linhas_ativas, volume_mensal, receita_manutencao, projecao_anual, por_tipo, por_seguradora, lancamentos_mes });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/seguros — criar novo seguro facultativo
router.post('/', auth, adminRH, (req, res) => {
  try {
    const { funcionario_id, convenio_id, seguradora_id, produto_id,
            tipo_produto, valor_premio, numero_apolice, observacoes,
            taxa_averbacao_cobrada = 5.00, taxa_manutencao_mensal = 2.00 } = req.body;
    if (!funcionario_id || !convenio_id || !seguradora_id || !tipo_produto || !valor_premio)
      return res.status(400).json({ erro: 'Campos obrigatórios: funcionario_id, convenio_id, seguradora_id, tipo_produto, valor_premio' });

    // Verificar funcionário ativo
    const func = db.prepare(`SELECT * FROM funcionarios WHERE id=? AND situacao='ATIVO'`).get(funcionario_id);
    if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado ou inativo' });

    // Verificar margem facultativa disponível (percentual_beneficio do convênio)
    const conv = db.prepare(`SELECT * FROM convenios WHERE id=?`).get(convenio_id);
    if (!conv) return res.status(404).json({ erro: 'Convênio não encontrado' });

    const margem_facultativa_total = func.salario_bruto * (conv.percentual_beneficio / 100);
    const seguros_ativos = db.prepare(`SELECT COALESCE(SUM(valor_premio),0) as total FROM seguros_facultativos WHERE funcionario_id=? AND status='ATIVO'`).get(funcionario_id).total;
    const margem_disponivel = margem_facultativa_total - seguros_ativos;

    if (valor_premio > margem_disponivel)
      return res.status(422).json({
        erro: 'Margem facultativa insuficiente',
        margem_total: margem_facultativa_total,
        margem_usada: seguros_ativos,
        margem_disponivel,
        valor_solicitado: valor_premio
      });

    const id = uuidv4();
    const codigo_seguro = gerarCodigoSeguro();
    const solicitado_por = req.usuario?.email || 'SISTEMA';

    db.prepare(`INSERT INTO seguros_facultativos
      (id, codigo_seguro, funcionario_id, convenio_id, seguradora_id, produto_id,
       tipo_produto, valor_premio, status, numero_apolice, observacoes,
       taxa_averbacao_cobrada, taxa_manutencao_mensal, solicitado_por)
      VALUES (?,?,?,?,?,?,?,?,'ATIVO',?,?,?,?,?)`
    ).run(id, codigo_seguro, funcionario_id, convenio_id, seguradora_id, produto_id,
          tipo_produto, valor_premio, numero_apolice, observacoes,
          taxa_averbacao_cobrada, taxa_manutencao_mensal, solicitado_por);

    // Lançamento do mês corrente
    const lancId = uuidv4();
    db.prepare(`INSERT INTO seguros_lancamentos (id,seguro_id,funcionario_id,convenio_id,seguradora_id,competencia,valor_premio,status)
                VALUES (?,?,?,?,?,?,'PROCESSADO')`
    ).run(lancId, id, funcionario_id, convenio_id, seguradora_id, competenciaAtual(), valor_premio);

    // Registrar cobrança de ativação no faturamento recorrente
    _registrarCobrancaRecorrente({
      competencia: competenciaAtual(),
      tipo_cobranca: 'SEGURO_ATIVACAO',
      entidade_tipo: 'SEGURADORA',
      entidade_id: seguradora_id,
      referencia_id: id,
      referencia_tipo: 'seguro_facultativo',
      funcionario_id,
      valor_unitario: taxa_averbacao_cobrada
    });

    db.prepare(`INSERT INTO logs_auditoria (usuario_id,usuario_email,perfil,acao,modulo,entidade_tipo,entidade_id,resultado)
                VALUES (?,?,?,'CRIAR_SEGURO','SEGUROS','seguro_facultativo',?,'SUCESSO')`
    ).run(req.usuario?.id, req.usuario?.email, req.usuario?.perfil, id);

    res.status(201).json({ id, codigo_seguro, mensagem: 'Seguro facultativo criado com sucesso' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/seguros/:id
router.get('/:id', auth, (req, res) => {
  try {
    const row = db.prepare(`SELECT sf.*,
        f.nome AS funcionario_nome, f.matricula, f.cpf, f.salario_bruto,
        c.nome AS convenio_nome, c.percentual_beneficio,
        seg.nome AS seguradora_nome, seg.taxa_manutencao,
        p.nome AS produto_nome
      FROM seguros_facultativos sf
      JOIN funcionarios f ON f.id=sf.funcionario_id
      JOIN convenios c ON c.id=sf.convenio_id
      JOIN seguradoras seg ON seg.id=sf.seguradora_id
      LEFT JOIN produtos_seguro p ON p.id=sf.produto_id
      WHERE sf.id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ erro: 'Seguro não encontrado' });
    const lancamentos = db.prepare(`SELECT * FROM seguros_lancamentos WHERE seguro_id=? ORDER BY competencia DESC LIMIT 12`).all(req.params.id);
    res.json({ ...row, lancamentos });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /api/seguros/:id/cancelar
router.patch('/:id/cancelar', auth, adminRH, (req, res) => {
  try {
    const { motivo_cancelamento = 'Solicitação do beneficiário' } = req.body;
    const seg = db.prepare(`SELECT * FROM seguros_facultativos WHERE id=?`).get(req.params.id);
    if (!seg) return res.status(404).json({ erro: 'Seguro não encontrado' });
    if (seg.status !== 'ATIVO') return res.status(422).json({ erro: `Seguro já está ${seg.status}` });

    db.prepare(`UPDATE seguros_facultativos SET status='CANCELADO', motivo_cancelamento=?, cancelado_por=?, cancelado_em=datetime('now'), data_fim=date('now'), atualizado_em=datetime('now') WHERE id=?`
    ).run(motivo_cancelamento, req.usuario?.email, req.params.id);

    db.prepare(`INSERT INTO logs_auditoria (usuario_id,usuario_email,perfil,acao,modulo,entidade_tipo,entidade_id,resultado)
                VALUES (?,?,?,'CANCELAR_SEGURO','SEGUROS','seguro_facultativo',?,'SUCESSO')`
    ).run(req.usuario?.id, req.usuario?.email, req.usuario?.perfil, req.params.id);

    res.json({ mensagem: 'Seguro cancelado — endosso de cancelamento registrado' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /api/seguros/:id/suspender
router.patch('/:id/suspender', auth, adminRH, (req, res) => {
  try {
    db.prepare(`UPDATE seguros_facultativos SET status='SUSPENSO', atualizado_em=datetime('now') WHERE id=? AND status='ATIVO'`).run(req.params.id);
    res.json({ mensagem: 'Seguro suspenso' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /api/seguros/:id/reativar
router.patch('/:id/reativar', auth, adminRH, (req, res) => {
  try {
    db.prepare(`UPDATE seguros_facultativos SET status='ATIVO', atualizado_em=datetime('now') WHERE id=? AND status='SUSPENSO'`).run(req.params.id);
    res.json({ mensagem: 'Seguro reativado' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── LANÇAMENTOS MENSAIS ──────────────────────────────────────────────────────

// POST /api/seguros/lancamentos/processar — processa todos os ativos do mês
router.post('/lancamentos/processar', auth, adminRH, (req, res) => {
  try {
    const { competencia } = req.body;
    const comp = competencia || competenciaAtual();
    const segurosAtivos = db.prepare(`SELECT * FROM seguros_facultativos WHERE status='ATIVO'`).all();
    let processados = 0, erros = 0, ignorados = 0;

    const processarTx = db.transaction(() => {
      for (const seg of segurosAtivos) {
        // Verificar se já existe lançamento nesta competência
        const existe = db.prepare(`SELECT id FROM seguros_lancamentos WHERE seguro_id=? AND competencia=?`).get(seg.id, comp);
        if (existe) { ignorados++; continue; }

        // Verificar margem atual
        const func = db.prepare(`SELECT salario_bruto FROM funcionarios WHERE id=?`).get(seg.funcionario_id);
        const conv = db.prepare(`SELECT percentual_beneficio FROM convenios WHERE id=?`).get(seg.convenio_id);
        if (!func || !conv) { erros++; continue; }

        const margem_total = func.salario_bruto * (conv.percentual_beneficio / 100);
        const outros_seguros = db.prepare(`SELECT COALESCE(SUM(valor_premio),0) as t FROM seguros_facultativos WHERE funcionario_id=? AND status='ATIVO' AND id!=?`).get(seg.funcionario_id, seg.id).t;
        const disponivel = margem_total - outros_seguros;

        const lancId = uuidv4();
        if (seg.valor_premio <= disponivel) {
          db.prepare(`INSERT INTO seguros_lancamentos (id,seguro_id,funcionario_id,convenio_id,seguradora_id,competencia,valor_premio,status,processado_em)
                      VALUES (?,?,?,?,?,?,?,'PROCESSADO',datetime('now'))`
          ).run(lancId, seg.id, seg.funcionario_id, seg.convenio_id, seg.seguradora_id, comp, seg.valor_premio);

          // Registrar manutenção recorrente
          _registrarCobrancaRecorrente({
            competencia: comp,
            tipo_cobranca: 'SEGURO_MANUTENCAO',
            entidade_tipo: 'SEGURADORA',
            entidade_id: seg.seguradora_id,
            referencia_id: seg.id,
            referencia_tipo: 'seguro_facultativo',
            funcionario_id: seg.funcionario_id,
            valor_unitario: seg.taxa_manutencao_mensal
          });
          processados++;
        } else {
          db.prepare(`INSERT INTO seguros_lancamentos (id,seguro_id,funcionario_id,convenio_id,seguradora_id,competencia,valor_premio,status,motivo_rejeicao)
                      VALUES (?,?,?,?,?,?,?,'REJEITADO','Margem insuficiente')`
          ).run(lancId, seg.id, seg.funcionario_id, seg.convenio_id, seg.seguradora_id, comp, seg.valor_premio);
          erros++;
        }
      }
    });
    processarTx();

    res.json({ competencia: comp, total: segurosAtivos.length, processados, erros, ignorados });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/seguros/lancamentos
router.get('/lancamentos', auth, (req, res) => {
  try {
    const { competencia, seguradora_id, status } = req.query;
    const comp = competencia || competenciaAtual();
    let sql = `SELECT sl.*, sf.codigo_seguro, sf.tipo_produto,
        f.nome AS funcionario_nome, f.matricula,
        seg.nome AS seguradora_nome
      FROM seguros_lancamentos sl
      JOIN seguros_facultativos sf ON sf.id=sl.seguro_id
      JOIN funcionarios f ON f.id=sl.funcionario_id
      JOIN seguradoras seg ON seg.id=sl.seguradora_id
      WHERE sl.competencia=?`;
    const params = [comp];
    if (seguradora_id) { sql += ' AND sl.seguradora_id=?'; params.push(seguradora_id); }
    if (status)        { sql += ' AND sl.status=?';        params.push(status); }
    res.json(db.prepare(sql + ' ORDER BY sl.criado_em DESC').all(...params));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/seguros/importar — upload em lote da seguradora
router.post('/importar', auth, adminRH, (req, res) => {
  try {
    const { seguradora_id, convenio_id, competencia, registros } = req.body;
    if (!seguradora_id || !Array.isArray(registros))
      return res.status(400).json({ erro: 'seguradora_id e registros[] são obrigatórios' });

    const comp = competencia || competenciaAtual();
    const importId = uuidv4();
    db.prepare(`INSERT INTO seguros_importacoes (id,seguradora_id,convenio_id,competencia,total_registros,importado_por,status)
                VALUES (?,?,?,?,?,'PROCESSANDO')`
    ).run(importId, seguradora_id, convenio_id, comp, registros.length, req.usuario?.email);

    let processados = 0, novos = 0, atualizados = 0, erros = 0;
    const importTx = db.transaction(() => {
      for (const reg of registros) {
        try {
          const func = db.prepare(`SELECT id, salario_bruto, situacao FROM funcionarios WHERE cpf=? OR matricula=?`).get(reg.cpf, reg.matricula);
          if (!func || func.situacao !== 'ATIVO') { erros++; continue; }
          const existente = db.prepare(`SELECT id FROM seguros_facultativos WHERE funcionario_id=? AND seguradora_id=? AND status='ATIVO'`).get(func.id, seguradora_id);
          if (existente) {
            db.prepare(`UPDATE seguros_facultativos SET valor_premio=?, atualizado_em=datetime('now') WHERE id=?`).run(reg.valor_premio || reg.valor, existente.id);
            atualizados++;
          } else {
            const id = uuidv4();
            db.prepare(`INSERT INTO seguros_facultativos (id,codigo_seguro,funcionario_id,convenio_id,seguradora_id,tipo_produto,valor_premio,status,numero_apolice,taxa_manutencao_mensal,solicitado_por)
                        VALUES (?,?,?,?,?,?,?,'ATIVO',?,2.00,'IMPORTACAO')`
            ).run(id, gerarCodigoSeguro(), func.id, convenio_id || reg.convenio_id, seguradora_id, reg.tipo || 'VIDA', reg.valor_premio || reg.valor, reg.numero_apolice);
            novos++;
          }
          processados++;
        } catch { erros++; }
      }
    });
    importTx();

    db.prepare(`UPDATE seguros_importacoes SET processados=?,novos=?,atualizados=?,erros=?,status='CONCLUIDO',concluido_em=datetime('now') WHERE id=?`
    ).run(processados, novos, atualizados, erros, importId);

    res.json({ importacao_id: importId, competencia: comp, total: registros.length, processados, novos, atualizados, erros });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── FATURAMENTO RECORRENTE ───────────────────────────────────────────────────

// GET /api/seguros/faturamento/recorrente
router.get('/faturamento/recorrente', auth, adminRH, (req, res) => {
  try {
    const { competencia, entidade_id, tipo_cobranca } = req.query;
    const comp = competencia || competenciaAtual();
    let sql = `SELECT fr.*,
        f.nome AS funcionario_nome, f.matricula
      FROM faturamento_recorrente fr
      LEFT JOIN funcionarios f ON f.id=fr.funcionario_id
      WHERE fr.competencia=?`;
    const params = [comp];
    if (entidade_id)   { sql += ' AND fr.entidade_id=?';   params.push(entidade_id); }
    if (tipo_cobranca) { sql += ' AND fr.tipo_cobranca=?'; params.push(tipo_cobranca); }
    const rows = db.prepare(sql + ' ORDER BY fr.entidade_nome, fr.tipo_cobranca').all(...params);
    const total = rows.reduce((s, r) => s + r.valor_unitario, 0);
    res.json({ competencia: comp, itens: rows, total_itens: rows.length, valor_total: total });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/seguros/faturamento/ciclos-recorrentes
router.get('/faturamento/ciclos-recorrentes', auth, adminRH, (req, res) => {
  try {
    const { competencia } = req.query;
    const comp = competencia || competenciaAtual();
    const ciclos = db.prepare(`SELECT * FROM faturamento_recorrente_ciclos WHERE competencia=? ORDER BY valor_total DESC`).all(comp);
    const total_geral = ciclos.reduce((s, c) => s + c.valor_total, 0);
    res.json({ competencia: comp, ciclos, total_geral });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/seguros/faturamento/fechar-ciclo
router.post('/faturamento/fechar-ciclo', auth, adminRH, (req, res) => {
  try {
    const { competencia, entidade_id } = req.body;
    const comp = competencia || competenciaAtual();
    let where = 'competencia=? AND status=\'ABERTO\'';
    const params = [comp];
    if (entidade_id) { where += ' AND entidade_id=?'; params.push(entidade_id); }

    const ciclos = db.prepare(`SELECT * FROM faturamento_recorrente_ciclos WHERE ${where}`).all(...params);
    let fechados = 0;
    for (const c of ciclos) {
      const numFat = 'REC-' + comp.replace('-','') + '-' + c.id.substring(0,4).toUpperCase();
      db.prepare(`UPDATE faturamento_recorrente_ciclos SET status='FATURADO', numero_fatura=?, atualizado_em=datetime('now') WHERE id=?`).run(numFat, c.id);
      db.prepare(`UPDATE faturamento_recorrente SET status='FATURADO', numero_fatura=?, atualizado_em=datetime('now') WHERE competencia=? AND entidade_id=? AND status='PENDENTE'`).run(numFat, comp, c.entidade_id);
      fechados++;
    }
    res.json({ mensagem: `${fechados} ciclo(s) faturado(s)`, competencia: comp });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/seguros/projecao-receita
router.get('/projecao-receita', auth, (req, res) => {
  try {
    const linhas = parseInt(req.query.linhas || 1000);
    const taxa = parseFloat(req.query.taxa || 2.00);
    const meses = 12;
    const mensal = linhas * taxa;
    const anual = mensal * meses;
    const projecao = Array.from({ length: meses }, (_, i) => ({
      mes: i + 1,
      linhas_acumuladas: Math.round(linhas * (1 + i * 0.02)),
      receita: Math.round(linhas * (1 + i * 0.02) * taxa * 100) / 100
    }));
    res.json({ linhas_base: linhas, taxa_mensal: taxa, receita_mensal: mensal, receita_anual: anual, projecao });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function _registrarCobrancaRecorrente({ competencia, tipo_cobranca, entidade_tipo, entidade_id, referencia_id, referencia_tipo, funcionario_id, valor_unitario }) {
  try {
    // Buscar nome da entidade
    let entidade_nome = '';
    if (entidade_tipo === 'SEGURADORA') {
      const s = db.prepare(`SELECT nome FROM seguradoras WHERE id=?`).get(entidade_id);
      entidade_nome = s?.nome || '';
    } else {
      const b = db.prepare(`SELECT nome FROM bancos WHERE id=?`).get(entidade_id);
      entidade_nome = b?.nome || '';
    }

    const [ano, mes] = competencia.split('-').map(Number);
    const id = uuidv4();
    db.prepare(`INSERT INTO faturamento_recorrente
      (id,competencia,mes,ano,tipo_cobranca,entidade_tipo,entidade_id,entidade_nome,referencia_id,referencia_tipo,funcionario_id,valor_unitario)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, competencia, mes, ano, tipo_cobranca, entidade_tipo, entidade_id, entidade_nome, referencia_id, referencia_tipo, funcionario_id, valor_unitario);

    // Upsert no ciclo recorrente
    const cicloExistente = db.prepare(`SELECT * FROM faturamento_recorrente_ciclos WHERE competencia=? AND entidade_id=? AND tipo_cobranca=?`).get(competencia, entidade_id, tipo_cobranca);
    if (cicloExistente) {
      db.prepare(`UPDATE faturamento_recorrente_ciclos SET total_linhas=total_linhas+1, valor_total=valor_total+?, atualizado_em=datetime('now') WHERE id=?`).run(valor_unitario, cicloExistente.id);
    } else {
      db.prepare(`INSERT INTO faturamento_recorrente_ciclos (id,competencia,entidade_tipo,entidade_id,entidade_nome,tipo_cobranca,total_linhas,valor_unitario,valor_total)
                  VALUES (?,?,?,?,?,?,1,?,?)`
      ).run(uuidv4(), competencia, entidade_tipo, entidade_id, entidade_nome, tipo_cobranca, valor_unitario, valor_unitario);
    }
  } catch (_) {}
}

// Exportar helper para uso externo (cartão)
router.registrarCobrancaRecorrente = _registrarCobrancaRecorrente;

module.exports = router;
