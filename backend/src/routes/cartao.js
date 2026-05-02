/**
 * AverbaTech — Módulo Cartão Consignado (RMC / RCC)
 * Margem rotativa exclusiva 5% | Bloqueio automático | Manutenção mensal R$1
 */
const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { autenticar, autorizar } = require('../middleware/auth');

const auth      = autenticar;
const adminRH   = autorizar('SUPER_ADMIN','ADMIN','RH');
const adminBanco= autorizar('SUPER_ADMIN','ADMIN','BANCO');

function gerarCodigoCartao() {
  return 'CC-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function competenciaAtual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function _registrarCobrancaRecorrente({ competencia, tipo_cobranca, entidade_tipo, entidade_id, referencia_id, referencia_tipo, funcionario_id, valor_unitario }) {
  try {
    let entidade_nome = '';
    const b = db.prepare(`SELECT nome FROM bancos WHERE id=?`).get(entidade_id);
    entidade_nome = b?.nome || '';
    const [ano, mes] = competencia.split('-').map(Number);
    const id = uuidv4();
    db.prepare(`INSERT INTO faturamento_recorrente
      (id,competencia,mes,ano,tipo_cobranca,entidade_tipo,entidade_id,entidade_nome,referencia_id,referencia_tipo,funcionario_id,valor_unitario)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, competencia, mes, ano, tipo_cobranca, entidade_tipo, entidade_id, entidade_nome, referencia_id, referencia_tipo, funcionario_id, valor_unitario);

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

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

// GET /api/cartao/dashboard
router.get('/dashboard', auth, (req, res) => {
  try {
    const cartoes_ativos   = db.prepare(`SELECT COUNT(*) as n FROM cartoes_consignados WHERE status='ATIVO'`).get().n;
    const margem_reservada = db.prepare(`SELECT COALESCE(SUM(margem_reservada),0) as t FROM cartoes_consignados WHERE status='ATIVO'`).get().t;
    const receita_manutencao = db.prepare(`SELECT COALESCE(SUM(taxa_manutencao_mensal),0) as t FROM cartoes_consignados WHERE status='ATIVO'`).get().t;
    const por_banco = db.prepare(`SELECT b.nome, COUNT(cc.id) as cartoes, SUM(cc.margem_reservada) as margem, SUM(cc.taxa_manutencao_mensal) as receita
      FROM cartoes_consignados cc JOIN bancos b ON b.id=cc.banco_id WHERE cc.status='ATIVO' GROUP BY cc.banco_id ORDER BY cartoes DESC`).all();
    const comp = competenciaAtual();
    const faturas_mes = db.prepare(`SELECT COUNT(*) as n, COALESCE(SUM(valor_total_desconto),0) as t FROM cartoes_faturas WHERE competencia=?`).get(comp);
    const bloqueados = db.prepare(`SELECT COUNT(*) as n FROM cartoes_consignados WHERE status='BLOQUEADO'`).get().n;
    const projecao_anual = receita_manutencao * 12;
    res.json({ cartoes_ativos, margem_reservada, receita_manutencao, projecao_anual, bloqueados, por_banco, faturas_mes });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── LISTAGEM ─────────────────────────────────────────────────────────────────

// GET /api/cartao
router.get('/', auth, (req, res) => {
  try {
    const { status, banco_id, convenio_id, funcionario_id, tipo, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql = `SELECT cc.*,
        f.nome AS funcionario_nome, f.matricula, f.cpf, f.salario_bruto,
        c.nome AS convenio_nome,
        b.nome AS banco_nome
      FROM cartoes_consignados cc
      JOIN funcionarios f ON f.id=cc.funcionario_id
      JOIN convenios c ON c.id=cc.convenio_id
      JOIN bancos b ON b.id=cc.banco_id
      WHERE 1=1`;
    const params = [];
    if (status)        { sql += ' AND cc.status=?';         params.push(status); }
    if (banco_id)      { sql += ' AND cc.banco_id=?';       params.push(banco_id); }
    if (convenio_id)   { sql += ' AND cc.convenio_id=?';    params.push(convenio_id); }
    if (funcionario_id){ sql += ' AND cc.funcionario_id=?'; params.push(funcionario_id); }
    if (tipo)          { sql += ' AND cc.tipo=?';           params.push(tipo); }

    // Banco só vê seus cartões
    if (req.usuario?.perfil === 'BANCO' && req.usuario?.banco_id)
      { sql += ' AND cc.banco_id=?'; params.push(req.usuario.banco_id); }

    const total = db.prepare(`SELECT COUNT(*) as n FROM (${sql})`).get(...params).n;
    const data  = db.prepare(sql + ' ORDER BY cc.criado_em DESC LIMIT ? OFFSET ?').all(...params, parseInt(limit), offset);
    res.json({ data, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── SOLICITAR CARTÃO ─────────────────────────────────────────────────────────

// POST /api/cartao
router.post('/', auth, adminBanco, (req, res) => {
  try {
    const { funcionario_id, convenio_id, banco_id, tipo = 'RMC',
            numero_contrato_banco, taxa_manutencao_mensal = 1.00,
            taxa_averbacao_cobrada = 15.00 } = req.body;
    if (!funcionario_id || !convenio_id || !banco_id)
      return res.status(400).json({ erro: 'funcionario_id, convenio_id e banco_id são obrigatórios' });

    // Verificar funcionário ativo
    const func = db.prepare(`SELECT * FROM funcionarios WHERE id=? AND situacao='ATIVO'`).get(funcionario_id);
    if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado ou inativo' });

    // Verificar margem de cartão disponível (5% do salário)
    const conv = db.prepare(`SELECT * FROM convenios WHERE id=?`).get(convenio_id);
    if (!conv) return res.status(404).json({ erro: 'Convênio não encontrado' });

    const margem_cartao_total = func.salario_bruto * (conv.percentual_cartao / 100);
    const cartoes_ativos = db.prepare(`SELECT COALESCE(SUM(margem_reservada),0) as t FROM cartoes_consignados WHERE funcionario_id=? AND status IN ('ATIVO','SOLICITADO')`).get(funcionario_id).t;
    const margem_disponivel = margem_cartao_total - cartoes_ativos;

    if (margem_disponivel <= 0)
      return res.status(422).json({
        erro: 'Margem de cartão (RMC/RCC) indisponível',
        margem_total: margem_cartao_total,
        margem_usada: cartoes_ativos,
        margem_disponivel: 0,
        percentual_cartao: conv.percentual_cartao
      });

    // Verificar cartão já ativo no mesmo banco
    const cartaoExistente = db.prepare(`SELECT id FROM cartoes_consignados WHERE funcionario_id=? AND banco_id=? AND status IN ('ATIVO','SOLICITADO')`).get(funcionario_id, banco_id);
    if (cartaoExistente) return res.status(422).json({ erro: 'Funcionário já possui cartão ativo neste banco' });

    const id = uuidv4();
    const codigo_cartao = gerarCodigoCartao();
    const margem_reservada = Math.min(margem_disponivel, margem_cartao_total);
    const limite_total = margem_reservada * 3; // Estimativa: limite ≈ 3x a margem

    db.prepare(`INSERT INTO cartoes_consignados
      (id,codigo_cartao,funcionario_id,convenio_id,banco_id,tipo,status,margem_reservada,limite_total,saldo_limite_atual,percentual_margem,numero_contrato_banco,taxa_averbacao_cobrada,taxa_manutencao_mensal,solicitado_por,data_ativacao)
      VALUES (?,?,?,?,?,?,'ATIVO',?,?,?,?,?,?,?,?,date('now'))`
    ).run(id, codigo_cartao, funcionario_id, convenio_id, banco_id, tipo,
          margem_reservada, limite_total, limite_total, conv.percentual_cartao,
          numero_contrato_banco, taxa_averbacao_cobrada, taxa_manutencao_mensal,
          req.usuario?.email);

    // Atualizar margem usada de cartão
    db.prepare(`UPDATE margens SET margem_usada_cartao=margem_usada_cartao+?, margem_disponivel_cartao=margem_disponivel_cartao-?, atualizado_em=datetime('now')
      WHERE funcionario_id=? AND competencia=(SELECT MAX(competencia) FROM margens WHERE funcionario_id=?)`
    ).run(margem_reservada, margem_reservada, funcionario_id, funcionario_id);

    // Registrar taxa de ativação no faturamento recorrente
    _registrarCobrancaRecorrente({
      competencia: competenciaAtual(),
      tipo_cobranca: 'CARTAO_ATIVACAO',
      entidade_tipo: 'BANCO',
      entidade_id: banco_id,
      referencia_id: id,
      referencia_tipo: 'cartao_consignado',
      funcionario_id,
      valor_unitario: taxa_averbacao_cobrada
    });

    db.prepare(`INSERT INTO logs_auditoria (usuario_id,usuario_email,perfil,acao,modulo,entidade_tipo,entidade_id,resultado)
                VALUES (?,?,?,'EMITIR_CARTAO','CARTAO','cartao_consignado',?,'SUCESSO')`
    ).run(req.usuario?.id, req.usuario?.email, req.usuario?.perfil, id);

    res.status(201).json({
      id, codigo_cartao, margem_reservada, limite_total,
      mensagem: `Cartão ${tipo} emitido com sucesso — margem R$${margem_reservada.toFixed(2)} reservada`
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/cartao/faturas — listar faturas (DEVE ficar antes de /:id para não conflitar)
router.get('/faturas', auth, (req, res) => {
  try {
    const { competencia, banco_id, cartao_id, status } = req.query;
    const comp = competencia || competenciaAtual();
    let sql = `SELECT cf.*, cc.codigo_cartao, cc.tipo AS tipo_cartao, cc.margem_reservada,
        f.nome AS funcionario_nome, f.matricula, f.cpf,
        b.nome AS banco_nome
      FROM cartoes_faturas cf
      JOIN cartoes_consignados cc ON cc.id=cf.cartao_id
      JOIN funcionarios f ON f.id=cf.funcionario_id
      JOIN bancos b ON b.id=cf.banco_id
      WHERE cf.competencia=?`;
    const params = [comp];
    if (banco_id) { sql += ' AND cf.banco_id=?';  params.push(banco_id); }
    if (cartao_id){ sql += ' AND cf.cartao_id=?'; params.push(cartao_id); }
    if (status)   { sql += ' AND cf.status=?';    params.push(status); }
    if (req.usuario?.perfil === 'BANCO' && req.usuario?.banco_id)
      { sql += ' AND cf.banco_id=?'; params.push(req.usuario.banco_id); }
    res.json(db.prepare(sql + ' ORDER BY cf.criado_em DESC').all(...params));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/cartao/:id
router.get('/:id', auth, (req, res) => {
  try {
    const cc = db.prepare(`SELECT cc.*,
        f.nome AS funcionario_nome, f.matricula, f.cpf, f.salario_bruto,
        c.nome AS convenio_nome, c.percentual_cartao,
        b.nome AS banco_nome
      FROM cartoes_consignados cc
      JOIN funcionarios f ON f.id=cc.funcionario_id
      JOIN convenios c ON c.id=cc.convenio_id
      JOIN bancos b ON b.id=cc.banco_id
      WHERE cc.id=?`).get(req.params.id);
    if (!cc) return res.status(404).json({ erro: 'Cartão não encontrado' });
    const faturas = db.prepare(`SELECT * FROM cartoes_faturas WHERE cartao_id=? ORDER BY competencia DESC LIMIT 12`).all(req.params.id);
    res.json({ ...cc, faturas });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── BLOQUEIO / DESBLOQUEIO ───────────────────────────────────────────────────

// PATCH /api/cartao/:id/bloquear
router.patch('/:id/bloquear', auth, (req, res) => {
  try {
    const { motivo = 'Demissão / Afastamento' } = req.body;
    const cc = db.prepare(`SELECT * FROM cartoes_consignados WHERE id=?`).get(req.params.id);
    if (!cc) return res.status(404).json({ erro: 'Cartão não encontrado' });
    if (cc.status === 'BLOQUEADO') return res.status(422).json({ erro: 'Cartão já está bloqueado' });
    if (cc.status === 'CANCELADO') return res.status(422).json({ erro: 'Cartão já cancelado' });

    db.prepare(`UPDATE cartoes_consignados SET status='BLOQUEADO', motivo_bloqueio=?, bloqueado_em=datetime('now'), bloqueado_por=?, atualizado_em=datetime('now') WHERE id=?`
    ).run(motivo, req.usuario?.email, req.params.id);

    // Disparar webhook para o banco
    _dispararWebhookBloqueio(cc.banco_id, { cartao_id: req.params.id, codigo_cartao: cc.codigo_cartao, motivo, evento: 'CARTAO_BLOQUEADO' });

    db.prepare(`INSERT INTO logs_auditoria (usuario_id,usuario_email,perfil,acao,modulo,entidade_tipo,entidade_id,resultado)
                VALUES (?,?,?,'BLOQUEAR_CARTAO','CARTAO','cartao_consignado',?,'SUCESSO')`
    ).run(req.usuario?.id, req.usuario?.email, req.usuario?.perfil, req.params.id);

    res.json({ mensagem: 'Cartão bloqueado — webhook de bloqueio disparado para o banco' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /api/cartao/:id/desbloquear
router.patch('/:id/desbloquear', auth, adminRH, (req, res) => {
  try {
    db.prepare(`UPDATE cartoes_consignados SET status='ATIVO', motivo_bloqueio=NULL, bloqueado_em=NULL, bloqueado_por=NULL, atualizado_em=datetime('now') WHERE id=? AND status='BLOQUEADO'`).run(req.params.id);
    const cc = db.prepare(`SELECT * FROM cartoes_consignados WHERE id=?`).get(req.params.id);
    _dispararWebhookBloqueio(cc?.banco_id, { cartao_id: req.params.id, evento: 'CARTAO_DESBLOQUEADO' });
    res.json({ mensagem: 'Cartão desbloqueado' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /api/cartao/:id/cancelar
router.patch('/:id/cancelar', auth, adminRH, (req, res) => {
  try {
    const { motivo = 'Cancelamento solicitado' } = req.body;
    const cc = db.prepare(`SELECT * FROM cartoes_consignados WHERE id=?`).get(req.params.id);
    if (!cc) return res.status(404).json({ erro: 'Cartão não encontrado' });

    db.prepare(`UPDATE cartoes_consignados SET status='CANCELADO', motivo_cancelamento=?, data_cancelamento=date('now'), atualizado_em=datetime('now') WHERE id=?`
    ).run(motivo, req.params.id);

    // Devolver margem
    db.prepare(`UPDATE margens SET margem_usada_cartao=MAX(0,margem_usada_cartao-?), margem_disponivel_cartao=margem_disponivel_cartao+?, atualizado_em=datetime('now')
      WHERE funcionario_id=? AND competencia=(SELECT MAX(competencia) FROM margens WHERE funcionario_id=?)`
    ).run(cc.margem_reservada, cc.margem_reservada, cc.funcionario_id, cc.funcionario_id);

    _dispararWebhookBloqueio(cc.banco_id, { cartao_id: req.params.id, codigo_cartao: cc.codigo_cartao, motivo, evento: 'CARTAO_CANCELADO' });
    res.json({ mensagem: 'Cartão cancelado — margem devolvida ao funcionário' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── FATURAS MENSAIS ──────────────────────────────────────────────────────────

// POST /api/cartao/faturas — banco envia gastos do mês
router.post('/faturas', auth, adminBanco, (req, res) => {
  try {
    const { cartao_id, competencia, valor_gasto = 0, valor_saque = 0 } = req.body;
    if (!cartao_id) return res.status(400).json({ erro: 'cartao_id obrigatório' });
    const comp = competencia || competenciaAtual();

    const cc = db.prepare(`SELECT * FROM cartoes_consignados WHERE id=? AND status='ATIVO'`).get(cartao_id);
    if (!cc) return res.status(404).json({ erro: 'Cartão não encontrado ou não está ativo' });

    const total = parseFloat(valor_gasto) + parseFloat(valor_saque);
    let status = 'VALIDADO';
    let motivo_rejeicao = null;

    // Validar se o total cabe na margem reservada
    if (total > cc.margem_reservada) {
      status = 'REJEITADO';
      motivo_rejeicao = `Valor R$${total.toFixed(2)} excede margem reservada R$${cc.margem_reservada.toFixed(2)}`;
    }

    // Verificar duplicata
    const existente = db.prepare(`SELECT id FROM cartoes_faturas WHERE cartao_id=? AND competencia=?`).get(cartao_id, comp);
    if (existente) {
      db.prepare(`UPDATE cartoes_faturas SET valor_gasto=?,valor_saque=?,valor_total_desconto=?,status=?,motivo_rejeicao=?,atualizado_em=datetime('now') WHERE id=?`
      ).run(valor_gasto, valor_saque, total, status, motivo_rejeicao, existente.id);
      return res.json({ fatura_id: existente.id, status, mensagem: 'Fatura atualizada' });
    }

    const id = uuidv4();
    db.prepare(`INSERT INTO cartoes_faturas (id,cartao_id,funcionario_id,banco_id,competencia,valor_gasto,valor_saque,valor_total_desconto,margem_reservada,status,motivo_rejeicao)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, cartao_id, cc.funcionario_id, cc.banco_id, comp, valor_gasto, valor_saque, total, cc.margem_reservada, status, motivo_rejeicao);

    // Registrar manutenção mensal no faturamento recorrente
    if (status === 'VALIDADO') {
      _registrarCobrancaRecorrente({
        competencia: comp,
        tipo_cobranca: 'CARTAO_MANUTENCAO',
        entidade_tipo: 'BANCO',
        entidade_id: cc.banco_id,
        referencia_id: id,
        referencia_tipo: 'cartao_fatura',
        funcionario_id: cc.funcionario_id,
        valor_unitario: cc.taxa_manutencao_mensal
      });
    }

    res.status(201).json({ fatura_id: id, status, motivo_rejeicao, total_desconto: total, margem_reservada: cc.margem_reservada });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// GET /api/cartao/faturas — listar faturas
router.get('/faturas', auth, (req, res) => {
  try {
    const { competencia, banco_id, cartao_id, status } = req.query;
    const comp = competencia || competenciaAtual();
    let sql = `SELECT cf.*, cc.codigo_cartao, cc.tipo AS tipo_cartao, cc.margem_reservada,
        f.nome AS funcionario_nome, f.matricula, f.cpf,
        b.nome AS banco_nome
      FROM cartoes_faturas cf
      JOIN cartoes_consignados cc ON cc.id=cf.cartao_id
      JOIN funcionarios f ON f.id=cf.funcionario_id
      JOIN bancos b ON b.id=cf.banco_id
      WHERE cf.competencia=?`;
    const params = [comp];
    if (banco_id) { sql += ' AND cf.banco_id=?';  params.push(banco_id); }
    if (cartao_id){ sql += ' AND cf.cartao_id=?'; params.push(cartao_id); }
    if (status)   { sql += ' AND cf.status=?';    params.push(status); }
    if (req.usuario?.perfil === 'BANCO' && req.usuario?.banco_id)
      { sql += ' AND cf.banco_id=?'; params.push(req.usuario.banco_id); }
    res.json(db.prepare(sql + ' ORDER BY cf.criado_em DESC').all(...params));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/cartao/faturas/processar — gerar arquivo de desconto para RH
router.post('/faturas/processar', auth, adminRH, (req, res) => {
  try {
    const { competencia } = req.body;
    const comp = competencia || competenciaAtual();
    const faturas = db.prepare(`SELECT cf.*, f.matricula, f.nome AS funcionario_nome, f.cpf FROM cartoes_faturas cf
      JOIN funcionarios f ON f.id=cf.funcionario_id WHERE cf.competencia=? AND cf.status='VALIDADO' AND cf.enviado_rh=0`).all(comp);

    let processadas = 0;
    for (const f of faturas) {
      db.prepare(`UPDATE cartoes_faturas SET enviado_rh=1, enviado_rh_em=datetime('now'), status='DESCONTADO' WHERE id=?`).run(f.id);
      processadas++;
    }

    // Gerar CSV de desconto
    const csv = ['matricula,nome,cpf,valor_desconto,competencia,tipo']
      .concat(faturas.map(f => `${f.matricula},${f.funcionario_nome},${f.cpf},${f.valor_total_desconto},${comp},CARTAO_CONSIGNADO`))
      .join('\n');

    res.json({ competencia: comp, processadas, csv_preview: csv.substring(0, 500) + (csv.length > 500 ? '...' : '') });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── ATUALIZAÇÃO DE LIMITE (banco consulta mensalmente) ───────────────────────

// PATCH /api/cartao/:id/atualizar-limite
router.patch('/:id/atualizar-limite', auth, adminBanco, (req, res) => {
  try {
    const cc = db.prepare(`SELECT cc.*, f.salario_bruto, c.percentual_cartao FROM cartoes_consignados cc
      JOIN funcionarios f ON f.id=cc.funcionario_id JOIN convenios c ON c.id=cc.convenio_id WHERE cc.id=?`).get(req.params.id);
    if (!cc) return res.status(404).json({ erro: 'Cartão não encontrado' });

    const nova_margem = cc.salario_bruto * (cc.percentual_cartao / 100);
    const outros = db.prepare(`SELECT COALESCE(SUM(margem_reservada),0) as t FROM cartoes_consignados WHERE funcionario_id=? AND status='ATIVO' AND id!=?`).get(cc.funcionario_id, req.params.id).t;
    const margem_disponivel = Math.max(0, nova_margem - outros);
    const novo_limite = margem_disponivel * 3;

    db.prepare(`UPDATE cartoes_consignados SET margem_reservada=?, saldo_limite_atual=?, limite_total=?, atualizado_em=datetime('now') WHERE id=?`
    ).run(margem_disponivel, novo_limite, novo_limite, req.params.id);

    res.json({ nova_margem_reservada: margem_disponivel, novo_limite, mensagem: 'Limite atualizado conforme salário atual' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── SAQUE COMPLEMENTAR ───────────────────────────────────────────────────────

// POST /api/cartao/:id/saque
router.post('/:id/saque', auth, adminBanco, (req, res) => {
  try {
    const { valor_saque, competencia } = req.body;
    if (!valor_saque) return res.status(400).json({ erro: 'valor_saque obrigatório' });
    const comp = competencia || competenciaAtual();
    const cc = db.prepare(`SELECT * FROM cartoes_consignados WHERE id=? AND status='ATIVO'`).get(req.params.id);
    if (!cc) return res.status(404).json({ erro: 'Cartão não encontrado ou não ativo' });
    if (valor_saque > cc.margem_reservada)
      return res.status(422).json({ erro: `Saque R$${valor_saque} excede margem R$${cc.margem_reservada.toFixed(2)}` });

    // Registrar como fatura com saque prioritário
    const id = uuidv4();
    db.prepare(`INSERT INTO cartoes_faturas (id,cartao_id,funcionario_id,banco_id,competencia,valor_gasto,valor_saque,valor_total_desconto,margem_reservada,status)
                VALUES (?,?,?,?,?,0,?,?,?,'VALIDADO')`
    ).run(id, req.params.id, cc.funcionario_id, cc.banco_id, comp, valor_saque, valor_saque, cc.margem_reservada);

    res.status(201).json({ fatura_id: id, valor_saque, competencia: comp, mensagem: 'Saque complementar registrado com prioridade' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── EXTRATO DO SERVIDOR ──────────────────────────────────────────────────────

// GET /api/cartao/extrato/:funcionario_id
router.get('/extrato/:funcionario_id', auth, (req, res) => {
  try {
    const cartoes = db.prepare(`SELECT cc.*, b.nome AS banco_nome FROM cartoes_consignados cc JOIN bancos b ON b.id=cc.banco_id WHERE cc.funcionario_id=? ORDER BY cc.criado_em DESC`).all(req.params.funcionario_id);
    const faturas = db.prepare(`SELECT cf.*, b.nome AS banco_nome FROM cartoes_faturas cf JOIN bancos b ON b.id=cf.banco_id WHERE cf.funcionario_id=? ORDER BY cf.competencia DESC LIMIT 24`).all(req.params.funcionario_id);
    const margem_total_usada = cartoes.filter(c => c.status === 'ATIVO').reduce((s, c) => s + c.margem_reservada, 0);
    res.json({ cartoes, faturas, margem_total_usada });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── BLOQUEIO AUTOMÁTICO POR DEMISSÃO ────────────────────────────────────────

// POST /api/cartao/bloquear-demitidos — chamado pelo RH ao marcar demissão
router.post('/bloquear-demitidos', auth, adminRH, (req, res) => {
  try {
    const { funcionario_id } = req.body;
    if (!funcionario_id) return res.status(400).json({ erro: 'funcionario_id obrigatório' });
    const cartoes = db.prepare(`SELECT * FROM cartoes_consignados WHERE funcionario_id=? AND status='ATIVO'`).all(funcionario_id);
    let bloqueados = 0;
    for (const cc of cartoes) {
      db.prepare(`UPDATE cartoes_consignados SET status='BLOQUEADO', motivo_bloqueio='Demissão/Desligamento automático', bloqueado_em=datetime('now'), bloqueado_por='SISTEMA_RH', atualizado_em=datetime('now') WHERE id=?`).run(cc.id);
      _dispararWebhookBloqueio(cc.banco_id, { cartao_id: cc.id, codigo_cartao: cc.codigo_cartao, motivo: 'DEMISSAO', evento: 'CARTAO_BLOQUEADO_AUTOMATICO' });
      bloqueados++;
    }
    res.json({ bloqueados, mensagem: `${bloqueados} cartão(ões) bloqueado(s) automaticamente — webhook disparado para cada banco` });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ─── WEBHOOK HELPER ───────────────────────────────────────────────────────────

function _dispararWebhookBloqueio(banco_id, payload) {
  try {
    if (!banco_id) return;
    const webhooks = db.prepare(`SELECT * FROM webhooks_config WHERE banco_id=? AND ativo=1`).all(banco_id);
    for (const wh of webhooks) {
      const eventos = JSON.parse(wh.eventos || '[]');
      if (!eventos.includes('CARTAO_BLOQUEADO') && !eventos.includes('*')) continue;
      const logId = uuidv4();
      db.prepare(`INSERT INTO webhooks_log (id,webhook_id,evento,payload,status) VALUES (?,?,?,?,'PENDENTE')`
      ).run(logId, wh.id, payload.evento || 'CARTAO_BLOQUEADO', JSON.stringify(payload));
      // Em produção: disparar HTTP POST assíncrono
    }
  } catch (_) {}
}

module.exports = router;
