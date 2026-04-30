const express = require('express');
const { db } = require('../database');
const { autenticar, autorizar } = require('../middleware/auth');
const { calcularMargens, gerarCompetencia } = require('../services/margemEngine');
const { gerarId } = require('../utils/helpers');

const router = express.Router();

// GET /api/dashboard/resumo - Resumo geral do sistema
router.get('/resumo', autenticar, (req, res) => {
  const convenio_id = req.usuario.convenio_id || req.query.convenio_id;

  let whereFunc = '1=1';
  let whereAverb = '1=1';
  const pFunc = [];
  const pAverb = [];

  if (req.usuario.perfil === 'RH' && convenio_id) {
    whereFunc  += ' AND f.convenio_id = ?'; pFunc.push(convenio_id);
    whereAverb += ' AND a.convenio_id = ?'; pAverb.push(convenio_id);
  } else if (req.usuario.perfil === 'BANCO' && req.usuario.banco_id) {
    whereAverb += ' AND a.banco_id = ?'; pAverb.push(req.usuario.banco_id);
  }

  const totalFuncionarios = db.prepare(`SELECT COUNT(*) as v FROM funcionarios f WHERE f.situacao='ATIVO' AND ${whereFunc}`).get(...pFunc).v;
  const totalConvenios = db.prepare(`SELECT COUNT(*) as v FROM convenios WHERE ativo=1`).get().v;
  const totalBancos = db.prepare(`SELECT COUNT(*) as v FROM bancos WHERE ativo=1`).get().v;

  const averbacoesMes = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status='APROVADA' THEN 1 ELSE 0 END) as aprovadas,
      SUM(CASE WHEN status='RESERVADA' THEN 1 ELSE 0 END) as reservadas,
      SUM(CASE WHEN status='CANCELADA' THEN 1 ELSE 0 END) as canceladas,
      SUM(CASE WHEN status IN ('APROVADA','RESERVADA') THEN valor_parcela ELSE 0 END) as volume_parcelas,
      SUM(CASE WHEN status IN ('APROVADA','RESERVADA') THEN taxa_averbacao_cobrada ELSE 0 END) as receita_averbacao
    FROM averbacoes a WHERE strftime('%Y-%m', a.criado_em) = strftime('%Y-%m', 'now') AND ${whereAverb}
  `).get(...pAverb);

  const averbacoesPorTipo = db.prepare(`
    SELECT a.tipo, COUNT(*) as total, SUM(a.valor_parcela) as volume
    FROM averbacoes a WHERE a.status IN ('APROVADA','RESERVADA','ATIVO','PENDENTE') AND ${whereAverb}
    GROUP BY a.tipo
  `).all(...pAverb);

  const ultimasAverbacoes = db.prepare(`
    SELECT a.codigo_averbacao, a.tipo, a.status, a.valor_parcela, a.criado_em,
      f.nome as funcionario_nome, b.nome as banco_nome
    FROM averbacoes a
    LEFT JOIN funcionarios f ON f.id = a.funcionario_id
    LEFT JOIN bancos b ON b.id = a.banco_id
    WHERE ${whereAverb}
    ORDER BY a.criado_em DESC LIMIT 5
  `).all(...pAverb);

  res.json({
    totais: { funcionarios: totalFuncionarios, convenios: totalConvenios, bancos: totalBancos },
    averbacoes_mes: averbacoesMes,
    por_tipo: averbacoesPorTipo,
    ultimas: ultimasAverbacoes
  });
});

// GET /api/dashboard/grafico-mensal
router.get('/grafico-mensal', autenticar, (req, res) => {
  const meses = db.prepare(`
    SELECT 
      strftime('%Y-%m', criado_em) as mes,
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('APROVADA','RESERVADA') THEN valor_parcela ELSE 0 END) as volume,
      SUM(CASE WHEN status IN ('APROVADA','RESERVADA') THEN taxa_averbacao_cobrada ELSE 0 END) as receita
    FROM averbacoes
    WHERE criado_em >= date('now', '-6 months')
    GROUP BY mes ORDER BY mes ASC
  `).all();
  res.json(meses);
});

// GET /api/dashboard/top-bancos
router.get('/top-bancos', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const bancos = db.prepare(`
    SELECT b.nome, COUNT(a.id) as total_averbacoes,
      SUM(a.valor_parcela) as volume_total,
      SUM(a.taxa_averbacao_cobrada) as receita_total
    FROM averbacoes a
    LEFT JOIN bancos b ON b.id = a.banco_id
    WHERE a.status IN ('APROVADA','RESERVADA')
    GROUP BY a.banco_id ORDER BY volume_total DESC LIMIT 10
  `).all();
  res.json(bancos);
});

module.exports = router;
