const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { autenticar, autorizar } = require('../middleware/auth');
const { registrarLog } = require('../utils/auditoria');
const { obterIP, gerarId } = require('../utils/helpers');

// GET /api/faturamento/dashboard - Dashboard de faturamento
router.get('/dashboard', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const dbInstance = db;
    const { mes, ano } = req.query;
    const mesRef = mes || (new Date().getMonth() + 1);
    const anoRef = ano || new Date().getFullYear();
    const inicioMes = `${anoRef}-${String(mesRef).padStart(2, '0')}-01`;
    const fimMes = `${anoRef}-${String(mesRef).padStart(2, '0')}-31`;

    // Averbações aprovadas no período
    const averbacoesMes = dbInstance.prepare(`
      SELECT av.*, f.nome as funcionario_nome, f.cpf as funcionario_cpf,
             b.nome as banco_nome, c.nome as convenio_nome,
             b.taxa_averbacao
      FROM averbacoes av
      LEFT JOIN funcionarios f ON av.funcionario_id = f.id
      LEFT JOIN bancos b ON av.banco_id = b.id
      LEFT JOIN convenios c ON av.convenio_id = c.id
      WHERE av.status = 'APROVADA'
      AND av.criado_em >= ? AND av.criado_em <= ?
      ORDER BY av.criado_em DESC
    `).all(inicioMes, fimMes);

    // Calcular receita por banco
    const receitaPorBanco = {};
    let receitaTotal = 0;
    averbacoesMes.forEach(av => {
      const taxa = parseFloat(av.taxa_averbacao) || 15.00;
      const nomeBanco = av.banco_nome || 'Não informado';
      if (!receitaPorBanco[nomeBanco]) {
        receitaPorBanco[nomeBanco] = { banco: nomeBanco, quantidade: 0, receita: 0 };
      }
      receitaPorBanco[nomeBanco].quantidade++;
      receitaPorBanco[nomeBanco].receita += taxa;
      receitaTotal += taxa;
    });

    // Histórico mensal (últimos 6 meses)
    const historicoMensal = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const m = d.getMonth() + 1;
      const a = d.getFullYear();
      const ini = `${a}-${String(m).padStart(2, '0')}-01`;
      const fim = `${a}-${String(m).padStart(2, '0')}-31`;

      const dadosMes = dbInstance.prepare(`
        SELECT COUNT(*) as quantidade, SUM(COALESCE(b.taxa_averbacao, 15.00)) as receita
        FROM averbacoes av
        LEFT JOIN bancos b ON av.banco_id = b.id
        WHERE av.status = 'APROVADA'
        AND av.criado_em >= ? AND av.criado_em <= ?
      `).get(ini, fim);

      historicoMensal.push({
        mes: `${String(m).padStart(2, '0')}/${a}`,
        quantidade: dadosMes.quantidade || 0,
        receita: parseFloat(dadosMes.receita) || 0
      });
    }

    // Projeção anual
    const mediaReceita = historicoMensal.reduce((s, m) => s + m.receita, 0) / 6;
    const projecaoAnual = mediaReceita * 12;

    res.json({
      periodo: { mes: mesRef, ano: anoRef },
      resumo: {
        totalAverbacoes: averbacoesMes.length,
        receitaTotal: parseFloat(receitaTotal.toFixed(2)),
        taxaMedia: averbacoesMes.length > 0 ? parseFloat((receitaTotal / averbacoesMes.length).toFixed(2)) : 0,
        projecaoAnual: parseFloat(projecaoAnual.toFixed(2))
      },
      receitaPorBanco: Object.values(receitaPorBanco),
      historicoMensal,
      averbacoes: averbacoesMes
    });

  } catch (error) {
    console.error('Erro faturamento dashboard:', error);
    res.status(500).json({ erro: 'Erro ao carregar faturamento', detalhe: error.message });
  }
});

// GET /api/faturamento/extrato - Extrato de cobranças
router.get('/extrato', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const dbInstance = db;
    const { inicio, fim, banco_id } = req.query;

    let query = `
      SELECT av.id, av.codigo_averbacao, av.tipo, av.valor_parcela,
             av.status, av.criado_em,
             f.nome as funcionario_nome, f.cpf as funcionario_cpf,
             b.nome as banco_nome, b.taxa_averbacao,
             c.nome as convenio_nome
      FROM averbacoes av
      LEFT JOIN funcionarios f ON av.funcionario_id = f.id
      LEFT JOIN bancos b ON av.banco_id = b.id
      LEFT JOIN convenios c ON av.convenio_id = c.id
      WHERE av.status = 'APROVADA'
    `;
    const params = [];

    if (inicio) { query += ` AND av.criado_em >= ?`; params.push(inicio); }
    if (fim) { query += ` AND av.criado_em <= ?`; params.push(fim + ' 23:59:59'); }
    if (banco_id) { query += ` AND av.banco_id = ?`; params.push(banco_id); }

    query += ` ORDER BY av.criado_em DESC LIMIT 500`;

    const registros = dbInstance.prepare(query).all(...params);

    const totalReceita = registros.reduce((s, r) => s + (parseFloat(r.taxa_averbacao) || 15.00), 0);

    registrarLog(dbInstance, req.user.id, 'EXTRATO_FATURAMENTO_CONSULTADO', 'FATURAMENTO', null, null, obterIP(req));

    res.json({
      totalRegistros: registros.length,
      totalReceita: parseFloat(totalReceita.toFixed(2)),
      registros
    });

  } catch (error) {
    console.error('Erro extrato faturamento:', error);
    res.status(500).json({ erro: 'Erro ao gerar extrato', detalhe: error.message });
  }
});

// GET /api/faturamento/nota/:averbacao_id - Gerar nota de cobrança
router.get('/nota/:averbacao_id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'OPERADOR'), (req, res) => {
  try {
    const dbInstance = db;
    const { averbacao_id } = req.params;

    const averbacao = dbInstance.prepare(`
      SELECT av.*, f.nome as funcionario_nome, f.cpf as funcionario_cpf, f.matricula,
             b.nome as banco_nome, b.codigo_bacen as codigo_banco, b.taxa_averbacao,
             c.nome as convenio_nome, c.cnpj as convenio_cnpj
      FROM averbacoes av
      LEFT JOIN funcionarios f ON av.funcionario_id = f.id
      LEFT JOIN bancos b ON av.banco_id = b.id
      LEFT JOIN convenios c ON av.convenio_id = c.id
      WHERE av.id = ? AND av.status = 'APROVADA'
    `).get(averbacao_id);

    if (!averbacao) {
      return res.status(404).json({ erro: 'Averbação não encontrada ou não aprovada' });
    }

    const taxaAverbacao = parseFloat(averbacao.taxa_averbacao) || 15.00;
    const numeroNota = `NF-${new Date().getFullYear()}-${String(averbacao.codigo_averbacao).slice(-8).toUpperCase()}`;

    const nota = {
      numero: numeroNota,
      emitidaEm: new Date().toISOString(),
      sistema: 'MargemPRO - Sistema de Gestão de Margem Consignável',
      cnpjEmissor: process.env.CNPJ_EMISSOR || '00.000.000/0001-00',
      averbacao: {
        codigo: averbacao.codigo_averbacao,
        tipo: averbacao.tipo,
        valorParcela: averbacao.valor_parcela,
        dataAprovacao: averbacao.data_aprovacao || averbacao.criado_em
      },
      funcionario: {
        nome: averbacao.funcionario_nome,
        cpf: averbacao.funcionario_cpf ? averbacao.funcionario_cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '***',
        matricula: averbacao.matricula
      },
      banco: {
        nome: averbacao.banco_nome,
        codigo: averbacao.codigo_bacen
      },
      convenio: {
        nome: averbacao.convenio_nome,
        cnpj: averbacao.convenio_cnpj
      },
      cobranca: {
        descricao: `Taxa de Averbação - Serviço de Gestão de Margem Consignável`,
        valor: taxaAverbacao,
        moeda: 'BRL'
      }
    };

    registrarLog(dbInstance, req.user.id, 'NOTA_FATURAMENTO_GERADA', 'FATURAMENTO', averbacao_id, null, obterIP(req));

    res.json(nota);

  } catch (error) {
    console.error('Erro ao gerar nota:', error);
    res.status(500).json({ erro: 'Erro ao gerar nota de cobrança', detalhe: error.message });
  }
});

// GET /api/faturamento/relatorio-banco - Relatório por banco para repasse
router.get('/relatorio-banco', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  try {
    const dbInstance = db;

    const relatorioPorBanco = dbInstance.prepare(`
      SELECT b.id as banco_id, b.nome as banco_nome, b.codigo_bacen as codigo_banco, b.taxa_averbacao,
             COUNT(av.id) as total_averbacoes,
             SUM(COALESCE(b.taxa_averbacao, 15.00)) as receita_total,
             MIN(av.criado_em) as primeira_averbacao,
             MAX(av.criado_em) as ultima_averbacao
      FROM bancos b
      LEFT JOIN averbacoes av ON av.banco_id = b.id AND av.status = 'APROVADA'
      WHERE b.ativo = 1
      GROUP BY b.id
      ORDER BY receita_total DESC
    `).all();

    const totalGeral = relatorioPorBanco.reduce((s, b) => s + (parseFloat(b.receita_total) || 0), 0);

    registrarLog(dbInstance, req.user.id, 'RELATORIO_BANCO_GERADO', 'FATURAMENTO', null, null, obterIP(req));

    res.json({
      geradoEm: new Date().toISOString(),
      geradoPor: req.user.email,
      totalGeral: parseFloat(totalGeral.toFixed(2)),
      bancos: relatorioPorBanco
    });

  } catch (error) {
    console.error('Erro relatório por banco:', error);
    res.status(500).json({ erro: 'Erro ao gerar relatório', detalhe: error.message });
  }
});

module.exports = router;
