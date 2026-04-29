const express = require('express');
const { db } = require('../database');
const { autenticar, autorizar } = require('../middleware/auth');

const router = express.Router();

// GET /api/auditoria/logs
router.get('/logs', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { modulo, acao, resultado, usuario_email, data_inicio, data_fim, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  if (modulo) { where += ' AND modulo = ?'; params.push(modulo); }
  if (acao) { where += ' AND acao LIKE ?'; params.push(`%${acao}%`); }
  if (resultado) { where += ' AND resultado = ?'; params.push(resultado); }
  if (usuario_email) { where += ' AND usuario_email LIKE ?'; params.push(`%${usuario_email}%`); }
  if (data_inicio) { where += ' AND criado_em >= ?'; params.push(data_inicio); }
  if (data_fim) { where += ' AND criado_em <= ?'; params.push(data_fim + ' 23:59:59'); }

  const total = db.prepare(`SELECT COUNT(*) as total FROM logs_auditoria WHERE ${where}`).get(...params).total;
  const logs = db.prepare(`
    SELECT * FROM logs_auditoria WHERE ${where}
    ORDER BY criado_em DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ data: logs, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/auditoria/estatisticas
router.get('/estatisticas', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const stats = {
    por_modulo: db.prepare(`
      SELECT modulo, COUNT(*) as total, 
        SUM(CASE WHEN resultado='SUCESSO' THEN 1 ELSE 0 END) as sucesso,
        SUM(CASE WHEN resultado='FALHA' THEN 1 ELSE 0 END) as falha
      FROM logs_auditoria GROUP BY modulo
    `).all(),
    por_perfil: db.prepare(`
      SELECT perfil, COUNT(*) as total FROM logs_auditoria WHERE perfil IS NOT NULL GROUP BY perfil
    `).all(),
    ultimas_falhas: db.prepare(`
      SELECT * FROM logs_auditoria WHERE resultado = 'FALHA' ORDER BY criado_em DESC LIMIT 10
    `).all(),
    acessos_hoje: db.prepare(`
      SELECT COUNT(*) as total FROM logs_auditoria WHERE DATE(criado_em) = DATE('now') AND acao = 'LOGIN'
    `).get()
  };
  res.json(stats);
});

module.exports = router;
