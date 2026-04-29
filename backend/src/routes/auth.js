const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP } = require('../utils/helpers');
const { autenticar } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'margem_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  const ip = obterIP(req);

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  }

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(email.toLowerCase().trim());

  if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    registrarLog({ ip, acao: 'LOGIN_FALHOU', modulo: 'AUTH', resultado: 'FALHA', detalhe: `Tentativa para: ${email}` });
    return res.status(401).json({ erro: 'Email ou senha inválidos' });
  }

  // Atualizar último login
  db.prepare("UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?").run(usuario.id);

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, perfil: usuario.perfil },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  registrarLog({
    usuario_id: usuario.id,
    usuario_email: usuario.email,
    perfil: usuario.perfil,
    ip,
    acao: 'LOGIN',
    modulo: 'AUTH',
    resultado: 'SUCESSO'
  });

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      convenio_id: usuario.convenio_id,
      banco_id: usuario.banco_id
    }
  });
});

// GET /api/auth/me
router.get('/me', autenticar, (req, res) => {
  const u = req.usuario;
  res.json({
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    convenio_id: u.convenio_id,
    banco_id: u.banco_id,
    ultimo_login: u.ultimo_login
  });
});

// POST /api/auth/alterar-senha
router.post('/alterar-senha', autenticar, async (req, res) => {
  const { senha_atual, nova_senha } = req.body;
  const ip = obterIP(req);

  if (!senha_atual || !nova_senha) {
    return res.status(400).json({ erro: 'Preencha senha atual e nova senha' });
  }
  if (nova_senha.length < 8) {
    return res.status(400).json({ erro: 'Nova senha deve ter pelo menos 8 caracteres' });
  }

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!bcrypt.compareSync(senha_atual, usuario.senha_hash)) {
    return res.status(401).json({ erro: 'Senha atual incorreta' });
  }

  const novoHash = bcrypt.hashSync(nova_senha, 12);
  db.prepare("UPDATE usuarios SET senha_hash = ?, atualizado_em = datetime('now') WHERE id = ?")
    .run(novoHash, req.usuario.id);

  registrarLog({
    usuario_id: req.usuario.id,
    usuario_email: req.usuario.email,
    perfil: req.usuario.perfil,
    ip,
    acao: 'ALTERAR_SENHA',
    modulo: 'AUTH',
    resultado: 'SUCESSO'
  });

  res.json({ mensagem: 'Senha alterada com sucesso' });
});

module.exports = router;
