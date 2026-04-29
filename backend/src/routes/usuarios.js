const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');

const router = express.Router();

// GET /api/usuarios
router.get('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const usuarios = db.prepare(`
    SELECT u.id, u.nome, u.email, u.perfil, u.ativo, u.ultimo_login, u.criado_em,
      c.nome as convenio_nome, b.nome as banco_nome
    FROM usuarios u
    LEFT JOIN convenios c ON c.id = u.convenio_id
    LEFT JOIN bancos b ON b.id = u.banco_id
    ORDER BY u.nome
  `).all();
  res.json(usuarios);
});

// POST /api/usuarios
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { nome, email, senha, perfil, convenio_id, banco_id } = req.body;
  const ip = obterIP(req);

  if (!nome || !email || !senha || !perfil) {
    return res.status(400).json({ erro: 'Nome, email, senha e perfil são obrigatórios' });
  }
  if (senha.length < 8) {
    return res.status(400).json({ erro: 'Senha deve ter pelo menos 8 caracteres' });
  }
  const perfisValidos = ['SUPER_ADMIN', 'ADMIN', 'RH', 'BANCO', 'FUNCIONARIO'];
  if (!perfisValidos.includes(perfil)) {
    return res.status(400).json({ erro: 'Perfil inválido' });
  }

  const id = gerarId();
  const senhaHash = bcrypt.hashSync(senha, 12);

  try {
    db.prepare(`
      INSERT INTO usuarios (id, nome, email, senha_hash, perfil, convenio_id, banco_id)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, nome, email.toLowerCase().trim(), senhaHash, perfil, convenio_id || null, banco_id || null);

    registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'CRIAR_USUARIO', modulo: 'USUARIOS', entidade_tipo: 'usuario', entidade_id: id, resultado: 'SUCESSO' });
    res.status(201).json({ id, mensagem: 'Usuário criado com sucesso' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: 'Email já cadastrado' });
    throw err;
  }
});

// PUT /api/usuarios/:id
router.put('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { nome, perfil, convenio_id, banco_id, ativo } = req.body;
  const ip = obterIP(req);

  const antes = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!antes) return res.status(404).json({ erro: 'Usuário não encontrado' });

  db.prepare(`
    UPDATE usuarios SET nome=?, perfil=?, convenio_id=?, banco_id=?, ativo=?, atualizado_em=datetime('now')
    WHERE id=?
  `).run(nome || antes.nome, perfil || antes.perfil,
    convenio_id !== undefined ? convenio_id : antes.convenio_id,
    banco_id !== undefined ? banco_id : antes.banco_id,
    ativo !== undefined ? ativo : antes.ativo, req.params.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'ATUALIZAR_USUARIO', modulo: 'USUARIOS', entidade_tipo: 'usuario', entidade_id: req.params.id, resultado: 'SUCESSO' });
  res.json({ mensagem: 'Usuário atualizado com sucesso' });
});

// DELETE /api/usuarios/:id (desativar)
router.delete('/:id', autenticar, autorizar('SUPER_ADMIN'), (req, res) => {
  const ip = obterIP(req);
  if (req.params.id === req.usuario.id) return res.status(400).json({ erro: 'Não é possível desativar seu próprio usuário' });

  db.prepare("UPDATE usuarios SET ativo=0, atualizado_em=datetime('now') WHERE id=?").run(req.params.id);
  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'DESATIVAR_USUARIO', modulo: 'USUARIOS', entidade_tipo: 'usuario', entidade_id: req.params.id, resultado: 'SUCESSO' });
  res.json({ mensagem: 'Usuário desativado' });
});

module.exports = router;
