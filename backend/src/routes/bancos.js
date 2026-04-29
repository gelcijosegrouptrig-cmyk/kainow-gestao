const express = require('express');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');

const router = express.Router();

// GET /api/bancos
router.get('/', autenticar, (req, res) => {
  const bancos = db.prepare('SELECT * FROM bancos ORDER BY nome').all();
  res.json(bancos);
});

// GET /api/bancos/:id
router.get('/:id', autenticar, (req, res) => {
  const banco = db.prepare('SELECT * FROM bancos WHERE id = ?').get(req.params.id);
  if (!banco) return res.status(404).json({ erro: 'Banco não encontrado' });
  res.json(banco);
});

// POST /api/bancos
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { nome, codigo_bacen, cnpj, taxa_averbacao, contato_responsavel, email_operacional } = req.body;
  const ip = obterIP(req);

  if (!nome || !codigo_bacen || !cnpj) {
    return res.status(400).json({ erro: 'Nome, código BACEN e CNPJ são obrigatórios' });
  }

  const id = gerarId();
  try {
    db.prepare(`
      INSERT INTO bancos (id, nome, codigo_bacen, cnpj, taxa_averbacao, contato_responsavel, email_operacional)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, nome, codigo_bacen, cnpj.replace(/\D/g, ''), taxa_averbacao || 15.00, contato_responsavel || null, email_operacional || null);

    registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'CRIAR_BANCO', modulo: 'BANCOS', entidade_tipo: 'banco', entidade_id: id, resultado: 'SUCESSO' });
    res.status(201).json({ id, mensagem: 'Banco cadastrado com sucesso' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: 'Banco já cadastrado (CNPJ ou código BACEN duplicado)' });
    throw err;
  }
});

// PUT /api/bancos/:id
router.put('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { nome, taxa_averbacao, contato_responsavel, email_operacional, ativo } = req.body;
  const ip = obterIP(req);

  const antes = db.prepare('SELECT * FROM bancos WHERE id = ?').get(req.params.id);
  if (!antes) return res.status(404).json({ erro: 'Banco não encontrado' });

  db.prepare(`
    UPDATE bancos SET nome=?, taxa_averbacao=?, contato_responsavel=?, email_operacional=?, ativo=? WHERE id=?
  `).run(nome || antes.nome, taxa_averbacao ?? antes.taxa_averbacao,
    contato_responsavel || antes.contato_responsavel, email_operacional || antes.email_operacional,
    ativo !== undefined ? ativo : antes.ativo, req.params.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'ATUALIZAR_BANCO', modulo: 'BANCOS', entidade_tipo: 'banco', entidade_id: req.params.id, resultado: 'SUCESSO' });
  res.json({ mensagem: 'Banco atualizado com sucesso' });
});

module.exports = router;
