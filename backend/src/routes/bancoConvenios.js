/**
 * Credenciamento Banco × Convênio
 * Controla quais bancos podem operar em quais convênios
 */
const express = require('express');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { obterIP } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');

const router = express.Router();

// GET /api/banco-convenios — Listar credenciamentos
router.get('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'BANCO', 'RH'), (req, res) => {
  const { banco_id, convenio_id, ativo } = req.query;
  let where = '1=1';
  const params = [];

  // Banco só vê os próprios credenciamentos
  if (req.usuario.perfil === 'BANCO' && req.usuario.banco_id) {
    where += ' AND bc.banco_id = ?'; params.push(req.usuario.banco_id);
  } else if (banco_id) { where += ' AND bc.banco_id = ?'; params.push(banco_id); }

  if (convenio_id) { where += ' AND bc.convenio_id = ?'; params.push(convenio_id); }
  if (ativo !== undefined) { where += ' AND bc.ativo = ?'; params.push(ativo === 'true' ? 1 : 0); }

  const rows = db.prepare(`
    SELECT bc.*,
      b.nome as banco_nome, b.codigo_bacen,
      c.nome as convenio_nome, c.cnpj as convenio_cnpj, c.tipo as convenio_tipo,
      (SELECT COUNT(*) FROM averbacoes a WHERE a.banco_id=bc.banco_id AND a.convenio_id=bc.convenio_id AND a.status IN ('APROVADA','RESERVADA')) as contratos_ativos
    FROM banco_convenios bc
    LEFT JOIN bancos b ON b.id = bc.banco_id
    LEFT JOIN convenios c ON c.id = bc.convenio_id
    WHERE ${where}
    ORDER BY b.nome, c.nome
  `).all(...params);

  res.json(rows);
});

// GET /api/banco-convenios/bancos-convenio/:convenio_id — Bancos credenciados para um convênio
router.get('/bancos-convenio/:convenio_id', autenticar, (req, res) => {
  const rows = db.prepare(`
    SELECT bc.*, b.nome as banco_nome, b.codigo_bacen, b.taxa_averbacao, b.email_operacional
    FROM banco_convenios bc
    JOIN bancos b ON b.id = bc.banco_id
    WHERE bc.convenio_id = ? AND bc.ativo = 1 AND b.ativo = 1
    ORDER BY b.nome
  `).all(req.params.convenio_id);
  res.json(rows);
});

// GET /api/banco-convenios/convenios-banco/:banco_id — Convênios de um banco
router.get('/convenios-banco/:banco_id', autenticar, (req, res) => {
  const rows = db.prepare(`
    SELECT bc.*, c.nome as convenio_nome, c.cnpj, c.tipo, c.sistema_folha,
      c.percentual_emprestimo, c.percentual_cartao
    FROM banco_convenios bc
    JOIN convenios c ON c.id = bc.convenio_id
    WHERE bc.banco_id = ? AND bc.ativo = 1 AND c.ativo = 1
    ORDER BY c.nome
  `).all(req.params.banco_id);
  res.json(rows);
});

// POST /api/banco-convenios — Credenciar banco em convênio
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { banco_id, convenio_id, taxa_negociada, limite_operacoes, data_inicio, data_fim, observacoes } = req.body;
  const ip = obterIP(req);

  if (!banco_id || !convenio_id) {
    return res.status(400).json({ erro: 'banco_id e convenio_id são obrigatórios' });
  }

  const banco = db.prepare('SELECT * FROM bancos WHERE id = ? AND ativo = 1').get(banco_id);
  if (!banco) return res.status(404).json({ erro: 'Banco não encontrado ou inativo' });

  const convenio = db.prepare('SELECT * FROM convenios WHERE id = ? AND ativo = 1').get(convenio_id);
  if (!convenio) return res.status(404).json({ erro: 'Convênio não encontrado ou inativo' });

  try {
    const existente = db.prepare('SELECT id FROM banco_convenios WHERE banco_id = ? AND convenio_id = ?').get(banco_id, convenio_id);
    if (existente) {
      // Reativar se estava inativo
      db.prepare(`UPDATE banco_convenios SET ativo=1, taxa_negociada=?, limite_operacoes=?, observacoes=?, aprovado_por=?, atualizado_em=datetime('now') WHERE id=?`
      ).run(taxa_negociada || null, limite_operacoes || 0, observacoes || null, req.usuario.email, existente.id);
      registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'REATIVAR_CREDENCIAMENTO', modulo: 'BANCO_CONVENIOS', resultado: 'SUCESSO' });
      return res.json({ id: existente.id, mensagem: `${banco.nome} reativado no convênio ${convenio.nome}` });
    }

    const result = db.prepare(`
      INSERT INTO banco_convenios (banco_id, convenio_id, taxa_negociada, limite_operacoes, data_inicio, data_fim, aprovado_por, observacoes)
      VALUES (?,?,?,?,?,?,?,?)
      RETURNING id
    `).get(banco_id, convenio_id, taxa_negociada || null, limite_operacoes || 0,
        data_inicio || new Date().toISOString().slice(0,10), data_fim || null, req.usuario.email, observacoes || null);

    registrarLog({
      usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip,
      acao: 'CREDENCIAR_BANCO', modulo: 'BANCO_CONVENIOS', resultado: 'SUCESSO',
      dados_depois: { banco: banco.nome, convenio: convenio.nome }
    });

    res.status(201).json({ id: result.id, mensagem: `${banco.nome} credenciado no convênio ${convenio.nome} com sucesso!` });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: 'Banco já credenciado neste convênio' });
    throw err;
  }
});

// PUT /api/banco-convenios/:id — Atualizar credenciamento
router.put('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { taxa_negociada, limite_operacoes, data_fim, observacoes, ativo } = req.body;
  const ip = obterIP(req);

  const cred = db.prepare('SELECT * FROM banco_convenios WHERE id = ?').get(req.params.id);
  if (!cred) return res.status(404).json({ erro: 'Credenciamento não encontrado' });

  db.prepare(`
    UPDATE banco_convenios SET
      taxa_negociada=?, limite_operacoes=?, data_fim=?, observacoes=?,
      ativo=?, aprovado_por=?, atualizado_em=datetime('now')
    WHERE id=?
  `).run(
    taxa_negociada ?? cred.taxa_negociada,
    limite_operacoes ?? cred.limite_operacoes,
    data_fim ?? cred.data_fim,
    observacoes ?? cred.observacoes,
    ativo !== undefined ? (ativo ? 1 : 0) : cred.ativo,
    req.usuario.email, req.params.id
  );

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'ATUALIZAR_CREDENCIAMENTO', modulo: 'BANCO_CONVENIOS', resultado: 'SUCESSO' });
  res.json({ mensagem: 'Credenciamento atualizado' });
});

// DELETE /api/banco-convenios/:id — Descredenciar (inativar)
router.delete('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const ip = obterIP(req);
  const cred = db.prepare('SELECT * FROM banco_convenios WHERE id = ?').get(req.params.id);
  if (!cred) return res.status(404).json({ erro: 'Credenciamento não encontrado' });

  db.prepare(`UPDATE banco_convenios SET ativo=0, atualizado_em=datetime('now') WHERE id=?`).run(req.params.id);
  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'DESCREDENCIAR_BANCO', modulo: 'BANCO_CONVENIOS', resultado: 'SUCESSO' });
  res.json({ mensagem: 'Banco descredenciado deste convênio' });
});

module.exports = router;
