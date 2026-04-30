const express = require('express');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, gerarCodigoAverbacao, obterIP } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');
const { verificarDisponibilidade, calcularTotalContrato, gerarCompetencia, competenciaFutura } = require('../services/margemEngine');

// Billing trigger — importado de forma lazy para evitar circular dependency
function dispararBilling(averbacao_id) {
  try {
    const { registrarBillingAverbacao } = require('./faturamento');
    registrarBillingAverbacao(averbacao_id);
  } catch (e) {
    console.error('[BILLING] trigger falhou:', e.message);
  }
}

const router = express.Router();

// =====================================================
// GET /api/averbacoes - Listar averbações
// =====================================================
router.get('/', autenticar, (req, res) => {
  const { status, banco_id, convenio_id, funcionario_id, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  if (req.usuario.perfil === 'BANCO' && req.usuario.banco_id) {
    where += ' AND a.banco_id = ?'; params.push(req.usuario.banco_id);
  } else if (req.usuario.perfil === 'RH' && req.usuario.convenio_id) {
    where += ' AND a.convenio_id = ?'; params.push(req.usuario.convenio_id);
  } else if (req.usuario.perfil === 'FUNCIONARIO') {
    where += ' AND a.funcionario_id = ?'; params.push(req.usuario.id);
  }

  if (status) { where += ' AND a.status = ?'; params.push(status); }
  if (banco_id) { where += ' AND a.banco_id = ?'; params.push(banco_id); }
  if (convenio_id) { where += ' AND a.convenio_id = ?'; params.push(convenio_id); }
  if (funcionario_id) { where += ' AND a.funcionario_id = ?'; params.push(funcionario_id); }

  const total = db.prepare(`SELECT COUNT(*) as total FROM averbacoes a WHERE ${where}`).get(...params).total;
  const averbacoes = db.prepare(`
    SELECT a.*,
      f.nome as funcionario_nome, f.matricula, f.cpf,
      b.nome as banco_nome,
      c.nome as convenio_nome
    FROM averbacoes a
    LEFT JOIN funcionarios f ON f.id = a.funcionario_id
    LEFT JOIN bancos b ON b.id = a.banco_id
    LEFT JOIN convenios c ON c.id = a.convenio_id
    WHERE ${where}
    ORDER BY a.criado_em DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ data: averbacoes, total, page: parseInt(page), limit: parseInt(limit) });
});

// =====================================================
// GET /api/averbacoes/:id - Detalhe
// =====================================================
router.get('/:id', autenticar, (req, res) => {
  const averb = db.prepare(`
    SELECT a.*,
      f.nome as funcionario_nome, f.matricula, f.cpf, f.salario_liquido,
      b.nome as banco_nome, b.codigo_bacen,
      c.nome as convenio_nome
    FROM averbacoes a
    LEFT JOIN funcionarios f ON f.id = a.funcionario_id
    LEFT JOIN bancos b ON b.id = a.banco_id
    LEFT JOIN convenios c ON c.id = a.convenio_id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!averb) return res.status(404).json({ erro: 'Averbação não encontrada' });

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil,
    ip: obterIP(req), acao: 'CONSULTAR_AVERBACAO', modulo: 'AVERBACOES',
    entidade_tipo: 'averbacao', entidade_id: averb.id, resultado: 'SUCESSO'
  });

  res.json(averb);
});

// =====================================================
// POST /api/averbacoes/consultar-codigo - Banco consulta reserva pelo código
// =====================================================
router.post('/consultar-codigo', autenticar, (req, res) => {
  const { codigo_averbacao } = req.body;
  if (!codigo_averbacao) return res.status(400).json({ erro: 'Código de averbação é obrigatório' });

  const averb = db.prepare(`
    SELECT a.*,
      f.nome as funcionario_nome, f.matricula,
      b.nome as banco_nome,
      c.nome as convenio_nome
    FROM averbacoes a
    LEFT JOIN funcionarios f ON f.id = a.funcionario_id
    LEFT JOIN bancos b ON b.id = a.banco_id
    LEFT JOIN convenios c ON c.id = a.convenio_id
    WHERE a.codigo_averbacao = ?
  `).get(codigo_averbacao.toUpperCase().trim());

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil,
    ip: obterIP(req), acao: 'CONSULTAR_CODIGO_AVERBACAO', modulo: 'AVERBACOES',
    detalhe: codigo_averbacao, resultado: averb ? 'SUCESSO' : 'FALHA'
  });

  if (!averb) return res.status(404).json({ erro: 'Código de averbação não encontrado' });
  res.json(averb);
});

// =====================================================
// POST /api/averbacoes - Solicitar nova averbação (Banco solicita)
// =====================================================
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'BANCO', 'RH'), async (req, res) => {
  const {
    funcionario_id, banco_id, tipo, valor_parcela, prazo_meses, taxa_juros,
    competencia_inicio, numero_contrato_banco, observacoes
  } = req.body;
  const ip = obterIP(req);

  // Validações básicas
  if (!funcionario_id || !banco_id || !tipo || !valor_parcela || !prazo_meses) {
    return res.status(400).json({ erro: 'Campos obrigatórios: funcionario_id, banco_id, tipo, valor_parcela, prazo_meses' });
  }
  if (!['EMPRESTIMO', 'CARTAO', 'BENEFICIO', 'REFINANCIAMENTO'].includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo inválido. Use: EMPRESTIMO, CARTAO, BENEFICIO, REFINANCIAMENTO' });
  }
  if (parseFloat(valor_parcela) <= 0) {
    return res.status(400).json({ erro: 'Valor da parcela deve ser maior que zero' });
  }

  // Banco só pode averbar para si mesmo
  if (req.usuario.perfil === 'BANCO' && req.usuario.banco_id !== banco_id) {
    return res.status(403).json({ erro: 'Banco só pode solicitar averbações para si mesmo' });
  }

  // Buscar funcionário
  const func = db.prepare(`
    SELECT f.*, c.percentual_emprestimo, c.percentual_cartao, c.percentual_beneficio
    FROM funcionarios f LEFT JOIN convenios c ON c.id = f.convenio_id WHERE f.id = ?
  `).get(funcionario_id);
  if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado' });
  if (func.situacao !== 'ATIVO') return res.status(422).json({ erro: `Funcionário com situação ${func.situacao}. Averbação não permitida.` });

  // Buscar banco
  const banco = db.prepare('SELECT * FROM bancos WHERE id = ? AND ativo = 1').get(banco_id);
  if (!banco) return res.status(404).json({ erro: 'Banco não encontrado ou inativo' });

  // Buscar margem atual
  const comp = competencia_inicio || gerarCompetencia();
  let margem = db.prepare('SELECT * FROM margens WHERE funcionario_id = ? AND competencia = ?').get(func.id, comp);

  if (!margem) {
    // Criar margem para competência se não existir
    const { calcularMargens } = require('../services/margemEngine');
    const margens = calcularMargens(func.salario_bruto, func.salario_liquido, {
      emprestimo: func.percentual_emprestimo,
      cartao: func.percentual_cartao,
      beneficio: func.percentual_beneficio
    });
    const margemId = gerarId();
    db.prepare(`
      INSERT INTO margens (id, funcionario_id, convenio_id, competencia, salario_bruto, salario_liquido,
        margem_total_emprestimo, margem_total_cartao, margem_total_beneficio,
        margem_disponivel_emprestimo, margem_disponivel_cartao, margem_disponivel_beneficio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(margemId, func.id, func.convenio_id, comp,
      margens.salarioBruto, margens.salarioLiquido,
      margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio,
      margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio);
    margem = db.prepare('SELECT * FROM margens WHERE id = ?').get(margemId);
  }

  // Verificar disponibilidade conforme tipo
  const tipoMap = {
    'EMPRESTIMO': { campo: 'margem_disponivel_emprestimo', label: 'Empréstimo' },
    'REFINANCIAMENTO': { campo: 'margem_disponivel_emprestimo', label: 'Empréstimo' },
    'CARTAO': { campo: 'margem_disponivel_cartao', label: 'Cartão' },
    'BENEFICIO': { campo: 'margem_disponivel_beneficio', label: 'Benefício' }
  };
  const tipoInfo = tipoMap[tipo];
  const disponibilidade = verificarDisponibilidade(
    parseFloat(valor_parcela),
    margem[tipoInfo.campo],
    tipoInfo.label
  );

  if (!disponibilidade.disponivel) {
    registrarLog({
      usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil,
      ip, acao: 'AVERBACAO_RECUSADA', modulo: 'AVERBACOES',
      entidade_tipo: 'funcionario', entidade_id: func.id,
      detalhe: disponibilidade.motivo, resultado: 'FALHA'
    });
    return res.status(422).json({
      erro: 'Margem insuficiente',
      detalhe: disponibilidade.motivo,
      margem_disponivel: margem[tipoInfo.campo]
    });
  }

  // Gerar código único de averbação
  const codigoAverbacao = gerarCodigoAverbacao(func.convenio_id.substring(0, 3));
  const valorTotal = calcularTotalContrato(parseFloat(valor_parcela), parseInt(prazo_meses), parseFloat(taxa_juros || 0));
  const compFim = competenciaFutura(comp, parseInt(prazo_meses));
  const id = gerarId();
  const taxaAverbacao = banco.taxa_averbacao || 15.00;

  // Usar transação para garantir atomicidade
  const criarAverbacao = db.transaction(() => {
    // Inserir averbação
    db.prepare(`
      INSERT INTO averbacoes (id, codigo_averbacao, funcionario_id, convenio_id, banco_id, tipo, status,
        valor_parcela, prazo_meses, valor_total, taxa_juros, competencia_inicio, competencia_fim,
        numero_contrato_banco, solicitado_por, observacoes, taxa_averbacao_cobrada)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, codigoAverbacao, func.id, func.convenio_id, banco_id, tipo, 'RESERVADA',
      parseFloat(valor_parcela), parseInt(prazo_meses), valorTotal, parseFloat(taxa_juros || 0),
      comp, compFim, numero_contrato_banco || null, req.usuario.id, observacoes || null, taxaAverbacao);

    // Debitar da margem
    const campoUsado = tipoInfo.campo.replace('disponivel', 'usada');
    db.prepare(`
      UPDATE margens SET
        ${campoUsado} = ${campoUsado} + ?,
        ${tipoInfo.campo} = ${tipoInfo.campo} - ?,
        atualizado_em = datetime('now')
      WHERE id = ?
    `).run(parseFloat(valor_parcela), parseFloat(valor_parcela), margem.id);
  });

  criarAverbacao();

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil,
    ip, acao: 'CRIAR_AVERBACAO', modulo: 'AVERBACOES',
    entidade_tipo: 'averbacao', entidade_id: id,
    dados_depois: { codigo_averbacao: codigoAverbacao, valor_parcela, tipo, banco: banco.nome },
    resultado: 'SUCESSO'
  });

  res.status(201).json({
    id,
    codigo_averbacao: codigoAverbacao,
    status: 'RESERVADA',
    valor_parcela: parseFloat(valor_parcela),
    valor_total: valorTotal,
    prazo_meses: parseInt(prazo_meses),
    competencia_inicio: comp,
    competencia_fim: compFim,
    taxa_averbacao_cobrada: taxaAverbacao,
    margem_restante: disponibilidade.margemRestante,
    mensagem: `Averbação realizada com sucesso! Código: ${codigoAverbacao}`
  });
});

// =====================================================
// PATCH /api/averbacoes/:id/aprovar - RH aprova (confirma na folha)
// =====================================================
router.patch('/:id/aprovar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const ip = obterIP(req);
  const averb = db.prepare('SELECT * FROM averbacoes WHERE id = ?').get(req.params.id);
  if (!averb) return res.status(404).json({ erro: 'Averbação não encontrada' });
  if (averb.status !== 'RESERVADA') return res.status(422).json({ erro: `Não é possível aprovar averbação com status: ${averb.status}` });

  db.prepare(`
    UPDATE averbacoes SET status = 'APROVADA', aprovado_por = ?, data_aprovacao = datetime('now'), atualizado_em = datetime('now')
    WHERE id = ?
  `).run(req.usuario.id, req.params.id);

  // ── Billing trigger: registrar faturamento por transação ──
  dispararBilling(req.params.id);

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil,
    ip, acao: 'APROVAR_AVERBACAO', modulo: 'AVERBACOES',
    entidade_tipo: 'averbacao', entidade_id: averb.id,
    dados_antes: { status: 'RESERVADA' }, dados_depois: { status: 'APROVADA' }, resultado: 'SUCESSO'
  });

  res.json({ mensagem: 'Averbação aprovada com sucesso', codigo_averbacao: averb.codigo_averbacao });
});

// =====================================================
// PATCH /api/averbacoes/:id/cancelar - Cancelar averbação (devolve margem)
// =====================================================
router.patch('/:id/cancelar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH', 'BANCO'), (req, res) => {
  const { motivo } = req.body;
  const ip = obterIP(req);

  const averb = db.prepare('SELECT * FROM averbacoes WHERE id = ?').get(req.params.id);
  if (!averb) return res.status(404).json({ erro: 'Averbação não encontrada' });
  if (['CANCELADA', 'EXPIRADA'].includes(averb.status)) {
    return res.status(422).json({ erro: 'Averbação já cancelada/expirada' });
  }

  // Banco só cancela as próprias
  if (req.usuario.perfil === 'BANCO' && req.usuario.banco_id !== averb.banco_id) {
    return res.status(403).json({ erro: 'Banco não autorizado a cancelar esta averbação' });
  }

  const tipoMap = {
    'EMPRESTIMO': 'margem_disponivel_emprestimo',
    'REFINANCIAMENTO': 'margem_disponivel_emprestimo',
    'CARTAO': 'margem_disponivel_cartao',
    'BENEFICIO': 'margem_disponivel_beneficio'
  };
  const campoDisponivel = tipoMap[averb.tipo];
  const campoUsado = campoDisponivel.replace('disponivel', 'usada');

  const cancelar = db.transaction(() => {
    db.prepare(`
      UPDATE averbacoes SET status = 'CANCELADA', motivo_cancelamento = ?, atualizado_em = datetime('now')
      WHERE id = ?
    `).run(motivo || 'Cancelado pelo operador', req.params.id);

    // Devolver margem somente se estava RESERVADA ou APROVADA
    if (['RESERVADA', 'APROVADA'].includes(averb.status)) {
      const margem = db.prepare('SELECT * FROM margens WHERE funcionario_id = ? AND competencia = ?')
        .get(averb.funcionario_id, averb.competencia_inicio);
      if (margem) {
        db.prepare(`
          UPDATE margens SET
            ${campoUsado} = MAX(0, ${campoUsado} - ?),
            ${campoDisponivel} = ${campoDisponivel} + ?,
            atualizado_em = datetime('now')
          WHERE id = ?
        `).run(averb.valor_parcela, averb.valor_parcela, margem.id);
      }
    }
  });

  cancelar();

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil,
    ip, acao: 'CANCELAR_AVERBACAO', modulo: 'AVERBACOES',
    entidade_tipo: 'averbacao', entidade_id: averb.id,
    dados_antes: { status: averb.status }, dados_depois: { status: 'CANCELADA', motivo }, resultado: 'SUCESSO'
  });

  res.json({ mensagem: 'Averbação cancelada. Margem devolvida ao funcionário.' });
});

module.exports = router;
