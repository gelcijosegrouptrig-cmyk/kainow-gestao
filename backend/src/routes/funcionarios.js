const express = require('express');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP, validarCPF, mascaraCPF } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');
const { calcularMargens, gerarCompetencia } = require('../services/margemEngine');

const router = express.Router();

// GET /api/funcionarios
router.get('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH', 'BANCO'), (req, res) => {
  const { convenio_id, situacao, busca, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  if (convenio_id) { where += ' AND f.convenio_id = ?'; params.push(convenio_id); }
  else if (req.usuario.perfil === 'RH' && req.usuario.convenio_id) {
    where += ' AND f.convenio_id = ?'; params.push(req.usuario.convenio_id);
  }
  if (situacao) { where += ' AND f.situacao = ?'; params.push(situacao); }
  if (busca) {
    where += ' AND (f.nome LIKE ? OR f.matricula LIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as total FROM funcionarios f WHERE ${where}`).get(...params).total;
  const funcionarios = db.prepare(`
    SELECT f.*, c.nome as convenio_nome 
    FROM funcionarios f
    LEFT JOIN convenios c ON c.id = f.convenio_id
    WHERE ${where} ORDER BY f.nome LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  // Mascarar CPF na listagem (LGPD)
  const result = funcionarios.map(f => ({ ...f, cpf: mascaraCPF(f.cpf) }));
  res.json({ data: result, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/funcionarios/:id
router.get('/:id', autenticar, (req, res) => {
  const func = db.prepare(`
    SELECT f.*, c.nome as convenio_nome, c.percentual_emprestimo, c.percentual_cartao, c.percentual_beneficio
    FROM funcionarios f
    LEFT JOIN convenios c ON c.id = f.convenio_id
    WHERE f.id = ?
  `).get(req.params.id);
  if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado' });

  // Controle de acesso: FUNCIONARIO só vê a si mesmo
  if (req.usuario.perfil === 'FUNCIONARIO' && req.usuario.id !== func.id) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  // CPF completo só para ADMIN/RH
  if (!['SUPER_ADMIN', 'ADMIN', 'RH'].includes(req.usuario.perfil)) {
    func.cpf = mascaraCPF(func.cpf);
  }

  // Buscar última margem
  const margem = db.prepare(`
    SELECT * FROM margens WHERE funcionario_id = ? ORDER BY competencia DESC LIMIT 1
  `).get(func.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip: obterIP(req), acao: 'CONSULTAR_FUNCIONARIO', modulo: 'FUNCIONARIOS', entidade_tipo: 'funcionario', entidade_id: func.id, resultado: 'SUCESSO' });

  res.json({ ...func, margem_atual: margem || null });
});

// POST /api/funcionarios
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { matricula, nome, cpf, data_nascimento, convenio_id, cargo, lotacao, salario_bruto, salario_liquido, data_admissao } = req.body;
  const ip = obterIP(req);

  if (!matricula || !nome || !cpf || !convenio_id || salario_bruto === undefined) {
    return res.status(400).json({ erro: 'Matricula, nome, CPF, convênio e salário são obrigatórios' });
  }
  const cpfLimpo = cpf.replace(/\D/g, '');
  if (!validarCPF(cpfLimpo)) {
    return res.status(400).json({ erro: 'CPF inválido' });
  }

  const conv = db.prepare('SELECT * FROM convenios WHERE id = ?').get(convenio_id);
  if (!conv) return res.status(404).json({ erro: 'Convênio não encontrado' });

  const id = gerarId();
  try {
    db.prepare(`
      INSERT INTO funcionarios (id, matricula, nome, cpf, data_nascimento, convenio_id, cargo, lotacao, salario_bruto, salario_liquido, data_admissao)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, matricula, nome, cpfLimpo, data_nascimento || null, convenio_id, cargo || null, lotacao || null,
      parseFloat(salario_bruto), parseFloat(salario_liquido || salario_bruto * 0.8), data_admissao || null);

    // Calcular e criar margem inicial
    const competencia = gerarCompetencia();
    const margens = calcularMargens(parseFloat(salario_bruto), parseFloat(salario_liquido || salario_bruto * 0.8), {
      emprestimo: conv.percentual_emprestimo,
      cartao: conv.percentual_cartao,
      beneficio: conv.percentual_beneficio
    });

    const margemId = gerarId();
    db.prepare(`
      INSERT INTO margens (id, funcionario_id, convenio_id, competencia, salario_bruto, salario_liquido,
        margem_total_emprestimo, margem_total_cartao, margem_total_beneficio,
        margem_disponivel_emprestimo, margem_disponivel_cartao, margem_disponivel_beneficio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(margemId, id, convenio_id, competencia, margens.salarioBruto, margens.salarioLiquido,
      margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio,
      margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio);

    registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'CRIAR_FUNCIONARIO', modulo: 'FUNCIONARIOS', entidade_tipo: 'funcionario', entidade_id: id, resultado: 'SUCESSO' });
    res.status(201).json({ id, mensagem: 'Funcionário cadastrado com sucesso', margem: margens });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: 'CPF ou matrícula já cadastrado neste convênio' });
    throw err;
  }
});

// PUT /api/funcionarios/:id
router.put('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { nome, cargo, lotacao, salario_bruto, salario_liquido, situacao, data_admissao } = req.body;
  const ip = obterIP(req);

  const antes = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(req.params.id);
  if (!antes) return res.status(404).json({ erro: 'Funcionário não encontrado' });

  db.prepare(`
    UPDATE funcionarios SET nome=?, cargo=?, lotacao=?, salario_bruto=?, salario_liquido=?, situacao=?, data_admissao=?, atualizado_em=datetime('now') WHERE id=?
  `).run(nome || antes.nome, cargo || antes.cargo, lotacao || antes.lotacao,
    salario_bruto ?? antes.salario_bruto, salario_liquido ?? antes.salario_liquido,
    situacao || antes.situacao, data_admissao || antes.data_admissao, req.params.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'ATUALIZAR_FUNCIONARIO', modulo: 'FUNCIONARIOS', entidade_tipo: 'funcionario', entidade_id: req.params.id, dados_antes: { salario_bruto: antes.salario_bruto }, dados_depois: { salario_bruto }, resultado: 'SUCESSO' });
  res.json({ mensagem: 'Funcionário atualizado com sucesso' });
});

// GET /api/funcionarios/:id/margem
router.get('/:id/margem', autenticar, (req, res) => {
  const { competencia } = req.query;

  const func = db.prepare('SELECT f.*, c.percentual_emprestimo, c.percentual_cartao, c.percentual_beneficio, c.nome as convenio_nome FROM funcionarios f LEFT JOIN convenios c ON c.id = f.convenio_id WHERE f.id = ?').get(req.params.id);
  if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado' });

  if (req.usuario.perfil === 'FUNCIONARIO' && req.usuario.id !== func.id) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  const comp = competencia || gerarCompetencia();
  const margem = db.prepare('SELECT * FROM margens WHERE funcionario_id = ? AND competencia = ?').get(func.id, comp);

  const averbacoes = db.prepare(`
    SELECT a.*, b.nome as banco_nome FROM averbacoes a
    LEFT JOIN bancos b ON b.id = a.banco_id
    WHERE a.funcionario_id = ? AND a.status IN ('RESERVADA','APROVADA')
    ORDER BY a.criado_em DESC
  `).all(func.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip: obterIP(req), acao: 'CONSULTAR_MARGEM', modulo: 'MARGENS', entidade_tipo: 'funcionario', entidade_id: func.id, resultado: 'SUCESSO' });

  res.json({
    funcionario: { id: func.id, nome: func.nome, matricula: func.matricula, cpf: mascaraCPF(func.cpf), convenio: func.convenio_nome },
    competencia: comp,
    margem: margem || null,
    averbacoes_ativas: averbacoes
  });
});

module.exports = router;
