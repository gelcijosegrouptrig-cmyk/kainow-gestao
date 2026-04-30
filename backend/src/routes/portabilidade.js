/**
 * Portabilidade Automática de Crédito Consignado — AverbaTech
 * Permite transferência de contratos entre bancos com análise automática
 */
const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');
const { dispararWebhook } = require('../services/webhookService');

const router = express.Router();

function gerarCodigoPortabilidade() {
  const ano = new Date().getFullYear();
  const seq = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `PORT-${ano}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portabilidade — Listar solicitações
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', autenticar, (req, res) => {
  const { status, banco_origem_id, banco_destino_id, convenio_id, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = '1=1';
  const params = [];

  if (req.usuario.perfil === 'BANCO' && req.usuario.banco_id) {
    where += ' AND (p.banco_origem_id = ? OR p.banco_destino_id = ?)';
    params.push(req.usuario.banco_id, req.usuario.banco_id);
  } else if (req.usuario.perfil === 'RH' && req.usuario.convenio_id) {
    where += ' AND p.convenio_id = ?'; params.push(req.usuario.convenio_id);
  }

  if (status) { where += ' AND p.status = ?'; params.push(status); }
  if (banco_origem_id) { where += ' AND p.banco_origem_id = ?'; params.push(banco_origem_id); }
  if (banco_destino_id) { where += ' AND p.banco_destino_id = ?'; params.push(banco_destino_id); }
  if (convenio_id) { where += ' AND p.convenio_id = ?'; params.push(convenio_id); }

  const total = db.prepare(`SELECT COUNT(*) as t FROM portabilidades p WHERE ${where}`).get(...params).t;
  const rows = db.prepare(`
    SELECT p.*,
      f.nome as funcionario_nome, f.cpf as funcionario_cpf, f.matricula,
      bo.nome as banco_origem_nome,
      bd.nome as banco_destino_nome,
      c.nome as convenio_nome,
      a.codigo_averbacao as averbacao_origem_codigo
    FROM portabilidades p
    LEFT JOIN funcionarios f ON f.id = p.funcionario_id
    LEFT JOIN bancos bo ON bo.id = p.banco_origem_id
    LEFT JOIN bancos bd ON bd.id = p.banco_destino_id
    LEFT JOIN convenios c ON c.id = p.convenio_id
    LEFT JOIN averbacoes a ON a.id = p.averbacao_origem_id
    WHERE ${where}
    ORDER BY p.criado_em DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portabilidade/dashboard — Estatísticas
// ─────────────────────────────────────────────────────────────────────────────
router.get('/dashboard', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const totais = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='SOLICITADA' THEN 1 ELSE 0 END) as solicitadas,
      SUM(CASE WHEN status='APROVADA' THEN 1 ELSE 0 END) as aprovadas,
      SUM(CASE WHEN status='EFETIVADA' THEN 1 ELSE 0 END) as efetivadas,
      SUM(CASE WHEN status='RECUSADA' THEN 1 ELSE 0 END) as recusadas,
      COALESCE(SUM(saldo_devedor),0) as volume_total
    FROM portabilidades
  `).get();

  const porBancoDestino = db.prepare(`
    SELECT bd.nome as banco, COUNT(*) as total,
      SUM(CASE WHEN p.status='EFETIVADA' THEN 1 ELSE 0 END) as efetivadas
    FROM portabilidades p
    JOIN bancos bd ON bd.id = p.banco_destino_id
    GROUP BY p.banco_destino_id ORDER BY total DESC LIMIT 10
  `).all();

  const recentes = db.prepare(`
    SELECT p.*, f.nome as funcionario_nome, bo.nome as banco_origem_nome, bd.nome as banco_destino_nome
    FROM portabilidades p
    LEFT JOIN funcionarios f ON f.id = p.funcionario_id
    LEFT JOIN bancos bo ON bo.id = p.banco_origem_id
    LEFT JOIN bancos bd ON bd.id = p.banco_destino_id
    ORDER BY p.criado_em DESC LIMIT 10
  `).all();

  res.json({ totais, por_banco_destino: porBancoDestino, recentes });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portabilidade/solicitar — Solicitar portabilidade
// ─────────────────────────────────────────────────────────────────────────────
router.post('/solicitar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'BANCO'), (req, res) => {
  const {
    averbacao_origem_id, banco_destino_id,
    valor_parcela_destino, taxa_destino, observacoes
  } = req.body;
  const ip = obterIP(req);

  if (!averbacao_origem_id || !banco_destino_id || !valor_parcela_destino) {
    return res.status(400).json({ erro: 'averbacao_origem_id, banco_destino_id e valor_parcela_destino são obrigatórios' });
  }

  // Buscar averbação de origem
  const averb = db.prepare(`
    SELECT a.*, f.nome as func_nome, f.cpf, f.situacao,
      b.nome as banco_nome, c.nome as convenio_nome
    FROM averbacoes a
    JOIN funcionarios f ON f.id = a.funcionario_id
    JOIN bancos b ON b.id = a.banco_id
    JOIN convenios c ON c.id = a.convenio_id
    WHERE a.id = ?
  `).get(averbacao_origem_id);

  if (!averb) return res.status(404).json({ erro: 'Averbação de origem não encontrada' });
  if (!['APROVADA', 'RESERVADA'].includes(averb.status)) {
    return res.status(422).json({ erro: 'Averbação de origem deve estar APROVADA ou RESERVADA' });
  }
  if (['DEMITIDO', 'LICENCIADO', 'INATIVO'].includes(averb.situacao)) {
    return res.status(422).json({ erro: `Funcionário com situação ${averb.situacao}. Portabilidade não permitida.` });
  }

  // Banco destino
  const bancoDestino = db.prepare('SELECT * FROM bancos WHERE id = ? AND ativo = 1').get(banco_destino_id);
  if (!bancoDestino) return res.status(404).json({ erro: 'Banco destino não encontrado ou inativo' });

  if (averb.banco_id === banco_destino_id) {
    return res.status(422).json({ erro: 'Banco destino deve ser diferente do banco de origem' });
  }

  // Calcular saldo devedor estimado
  const parcelasRestantes = averb.prazo_meses - 3; // estimativa simplificada
  const saldoDevedor = Math.max(0, averb.valor_parcela * Math.max(1, parcelasRestantes));

  // Análise automática: a nova parcela deve ser menor ou taxa menor
  const economiaEstimada = (averb.valor_parcela - parseFloat(valor_parcela_destino)) * Math.max(1, parcelasRestantes);
  const aprovacaoAutomatica = parseFloat(valor_parcela_destino) <= averb.valor_parcela * 0.98 ||
                               parseFloat(taxa_destino || 0) < (averb.taxa_juros || 99);

  const codigo = gerarCodigoPortabilidade();
  const id = gerarId();

  db.prepare(`
    INSERT INTO portabilidades (
      id, averbacao_origem_id, banco_origem_id, banco_destino_id,
      funcionario_id, convenio_id,
      valor_parcela_origem, valor_parcela_destino, taxa_origem, taxa_destino,
      prazo_restante, saldo_devedor, status, codigo_portabilidade,
      solicitado_por, observacoes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, averbacao_origem_id, averb.banco_id, banco_destino_id,
    averb.funcionario_id, averb.convenio_id,
    averb.valor_parcela, parseFloat(valor_parcela_destino),
    averb.taxa_juros || 0, parseFloat(taxa_destino || 0),
    Math.max(0, parcelasRestantes), saldoDevedor,
    aprovacaoAutomatica ? 'APROVADA' : 'ANALISE',
    codigo, req.usuario.email, observacoes || null
  );

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip,
    acao: 'SOLICITAR_PORTABILIDADE', modulo: 'PORTABILIDADE',
    entidade_tipo: 'portabilidade', entidade_id: id,
    resultado: 'SUCESSO',
    dados_depois: { codigo, banco_destino: bancoDestino.nome, valor_parcela_destino, status: aprovacaoAutomatica ? 'APROVADA' : 'ANALISE' }
  });

  // Notificar bancos via webhook
  try {
    dispararWebhook(averb.convenio_id, averb.banco_id, 'portabilidade.solicitada', {
      codigo, funcionario: averb.func_nome, banco_destino: bancoDestino.nome, saldo_devedor
    });
  } catch(_) {}

  res.status(201).json({
    id, codigo_portabilidade: codigo,
    status: aprovacaoAutomatica ? 'APROVADA' : 'ANALISE',
    economia_estimada: economiaEstimada,
    saldo_devedor: saldoDevedor,
    aprovacao_automatica: aprovacaoAutomatica,
    mensagem: aprovacaoAutomatica
      ? `✅ Portabilidade aprovada automaticamente! Código: ${codigo}`
      : `📋 Portabilidade em análise. Código: ${codigo}`
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portabilidade/:id/aprovar — Aprovar portabilidade
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/aprovar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const port = db.prepare('SELECT * FROM portabilidades WHERE id = ?').get(req.params.id);
  if (!port) return res.status(404).json({ erro: 'Portabilidade não encontrada' });
  if (!['SOLICITADA', 'ANALISE'].includes(port.status)) {
    return res.status(422).json({ erro: `Não é possível aprovar portabilidade com status: ${port.status}` });
  }

  db.prepare(`
    UPDATE portabilidades SET status='APROVADA', aprovado_por=?, data_aprovacao=datetime('now'), atualizado_em=datetime('now')
    WHERE id=?
  `).run(req.usuario.email, req.params.id);

  res.json({ mensagem: 'Portabilidade aprovada', codigo: port.codigo_portabilidade });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portabilidade/:id/efetivar — Efetivar (gera nova averbação)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/efetivar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'BANCO'), (req, res) => {
  const { numero_contrato_novo } = req.body;
  const ip = obterIP(req);

  const port = db.prepare(`
    SELECT p.*, a.prazo_meses, a.competencia_inicio, a.convenio_id,
      f.situacao as func_situacao
    FROM portabilidades p
    JOIN averbacoes a ON a.id = p.averbacao_origem_id
    JOIN funcionarios f ON f.id = p.funcionario_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!port) return res.status(404).json({ erro: 'Portabilidade não encontrada' });
  if (port.status !== 'APROVADA') {
    return res.status(422).json({ erro: 'Portabilidade deve estar APROVADA para ser efetivada' });
  }

  const efetivar = db.transaction(() => {
    // Cancelar averbação original
    db.prepare(`
      UPDATE averbacoes SET status='CANCELADA', motivo_cancelamento='Portabilidade ${port.codigo_portabilidade}',
        atualizado_em=datetime('now') WHERE id=?
    `).run(port.averbacao_origem_id);

    // Criar nova averbação no banco destino
    const { gerarCodigoAverbacao } = require('../utils/helpers');
    const novoId = gerarId();
    const novoCodigo = gerarCodigoAverbacao(port.convenio_id.substring(0,3));
    db.prepare(`
      INSERT INTO averbacoes (
        id, codigo_averbacao, funcionario_id, convenio_id, banco_id, tipo, status,
        valor_parcela, prazo_meses, valor_total, taxa_juros, competencia_inicio,
        numero_contrato_banco, solicitado_por, observacoes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      novoId, novoCodigo, port.funcionario_id, port.convenio_id, port.banco_destino_id,
      'EMPRESTIMO', 'APROVADA',
      port.valor_parcela_destino, port.prazo_restante || port.prazo_meses,
      port.valor_parcela_destino * (port.prazo_restante || port.prazo_meses),
      port.taxa_destino, port.competencia_inicio,
      numero_contrato_novo || null, req.usuario.email,
      `Portabilidade de ${port.codigo_portabilidade}`
    );

    // Atualizar portabilidade
    db.prepare(`
      UPDATE portabilidades SET status='EFETIVADA', averbacao_nova_id=?,
        data_efetivacao=datetime('now'), atualizado_em=datetime('now')
      WHERE id=?
    `).run(novoId, req.params.id);

    return { novoId, novoCodigo };
  });

  const resultado = efetivar();

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip,
    acao: 'EFETIVAR_PORTABILIDADE', modulo: 'PORTABILIDADE',
    resultado: 'SUCESSO',
    dados_depois: { codigo_portabilidade: port.codigo_portabilidade, nova_averbacao: resultado.novoCodigo }
  });

  res.json({
    mensagem: 'Portabilidade efetivada com sucesso!',
    codigo_portabilidade: port.codigo_portabilidade,
    nova_averbacao: resultado.novoCodigo,
    nova_averbacao_id: resultado.novoId
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portabilidade/:id/recusar — Recusar portabilidade
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/recusar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'BANCO'), (req, res) => {
  const { motivo } = req.body;
  const port = db.prepare('SELECT * FROM portabilidades WHERE id = ?').get(req.params.id);
  if (!port) return res.status(404).json({ erro: 'Portabilidade não encontrada' });
  if (['EFETIVADA', 'CANCELADA'].includes(port.status)) {
    return res.status(422).json({ erro: 'Portabilidade já finalizada' });
  }

  db.prepare(`
    UPDATE portabilidades SET status='RECUSADA', motivo_recusa=?, aprovado_por=?, atualizado_em=datetime('now')
    WHERE id=?
  `).run(motivo || 'Recusado pelo operador', req.usuario.email, req.params.id);

  res.json({ mensagem: 'Portabilidade recusada', codigo: port.codigo_portabilidade });
});

module.exports = router;
