const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { obterIP } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'margem_secret';

/**
 * Middleware de autenticação JWT
 */
function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de autenticação não fornecido' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(payload.id);
    if (!usuario) {
      return res.status(401).json({ erro: 'Usuário inativo ou não encontrado' });
    }
    req.usuario = usuario;
    req.user = usuario; // alias para compatibilidade
    next();
  } catch (err) {
    registrarLog({
      ip: obterIP(req),
      acao: 'TOKEN_INVALIDO',
      modulo: 'AUTH',
      resultado: 'FALHA',
      detalhe: err.message
    });
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

/**
 * Middleware de autorização por perfil
 */
function autorizar(...perfisPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Não autenticado' });
    }
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      registrarLog({
        usuario_id: req.usuario.id,
        usuario_email: req.usuario.email,
        perfil: req.usuario.perfil,
        ip: obterIP(req),
        acao: 'ACESSO_NEGADO',
        modulo: req.path,
        resultado: 'FALHA',
        detalhe: `Perfil ${req.usuario.perfil} não tem acesso. Requerido: ${perfisPermitidos.join(',')}`
      });
      return res.status(403).json({ erro: 'Acesso negado. Perfil sem permissão.' });
    }
    next();
  };
}

module.exports = { autenticar, autorizar };
