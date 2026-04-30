const express = require('express');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP, validarCPF, mascaraCPF } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');
const { calcularMargens, gerarCompetencia } = require('../services/margemEngine');
const { dispararWebhook } = require('../services/webhookService');

const router = express.Router();

// =====================================================================
// GET /api/funcionarios — Listar com busca por CPF, nome e matrícula
// =====================================================================
router.get('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH', 'BANCO'), (req, res) => {
  const { convenio_id, situacao, busca, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  // Filtro por convênio (RH só vê o próprio convênio)
  if (convenio_id) { where += ' AND f.convenio_id = ?'; params.push(convenio_id); }
  else if (req.usuario.perfil === 'RH' && req.usuario.convenio_id) {
    where += ' AND f.convenio_id = ?'; params.push(req.usuario.convenio_id);
  }

  // Filtro por situação
  if (situacao) { where += ' AND f.situacao = ?'; params.push(situacao); }

  // Busca por nome, matrícula OU CPF (exato ou parcial)
  if (busca) {
    const buscaLimpa = busca.replace(/\D/g, '');
    if (buscaLimpa.length >= 6) {
      // Parece CPF — buscar exato no campo cpf
      where += ' AND (f.nome LIKE ? OR f.matricula LIKE ? OR f.cpf = ? OR f.cpf LIKE ?)';
      params.push(`%${busca}%`, `%${busca}%`, buscaLimpa, `%${buscaLimpa}%`);
    } else {
      where += ' AND (f.nome LIKE ? OR f.matricula LIKE ?)';
      params.push(`%${busca}%`, `%${busca}%`);
    }
  }

  const total = db.prepare(`SELECT COUNT(*) as total FROM funcionarios f WHERE ${where}`).get(...params).total;
  const funcionarios = db.prepare(`
    SELECT f.*, c.nome as convenio_nome 
    FROM funcionarios f
    LEFT JOIN convenios c ON c.id = f.convenio_id
    WHERE ${where} ORDER BY f.nome LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  // Mascarar CPF na listagem (LGPD) — exceto ADMIN/RH
  const mostrarCPF = ['SUPER_ADMIN', 'ADMIN', 'RH'].includes(req.usuario.perfil);
  const result = funcionarios.map(f => ({ ...f, cpf: mostrarCPF ? f.cpf : mascaraCPF(f.cpf) }));
  res.json({ data: result, total, page: parseInt(page), limit: parseInt(limit) });
});

// =====================================================================
// GET /api/funcionarios/:id — Detalhe
// =====================================================================
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

  // Buscar contratos ativos
  const contratosAtivos = db.prepare(`
    SELECT COUNT(*) as total, COALESCE(SUM(valor_parcela),0) as total_comprometido
    FROM averbacoes WHERE funcionario_id = ? AND status IN ('RESERVADA','APROVADA')
  `).get(func.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip: obterIP(req), acao: 'CONSULTAR_FUNCIONARIO', modulo: 'FUNCIONARIOS', entidade_tipo: 'funcionario', entidade_id: func.id, resultado: 'SUCESSO' });

  res.json({ ...func, margem_atual: margem || null, contratos_ativos: contratosAtivos });
});

// =====================================================================
// POST /api/funcionarios — Criar
// =====================================================================
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { matricula, nome, cpf, data_nascimento, convenio_id, cargo, lotacao, salario_bruto, salario_liquido, data_admissao, situacao } = req.body;
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
      INSERT INTO funcionarios (id, matricula, nome, cpf, data_nascimento, convenio_id, cargo, lotacao, salario_bruto, salario_liquido, data_admissao, situacao)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, matricula, nome, cpfLimpo, data_nascimento || null, convenio_id, cargo || null, lotacao || null,
      parseFloat(salario_bruto), parseFloat(salario_liquido || salario_bruto * 0.8), data_admissao || null,
      situacao || 'ATIVO');

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

// =====================================================================
// PUT /api/funcionarios/:id — Atualizar (com suporte a LICENCIADO/DEMITIDO)
// =====================================================================
router.put('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { nome, cargo, lotacao, salario_bruto, salario_liquido, situacao, data_admissao, observacoes } = req.body;
  const ip = obterIP(req);

  const antes = db.prepare(`
    SELECT f.*, c.id as conv_id, c.nome as convenio_nome,
      c.percentual_emprestimo, c.percentual_cartao, c.percentual_beneficio
    FROM funcionarios f
    LEFT JOIN convenios c ON c.id = f.convenio_id
    WHERE f.id = ?
  `).get(req.params.id);
  if (!antes) return res.status(404).json({ erro: 'Funcionário não encontrado' });

  const situacaoValida = ['ATIVO', 'INATIVO', 'AFASTADO', 'APOSENTADO', 'DEMITIDO', 'LICENCIADO'];
  if (situacao && !situacaoValida.includes(situacao)) {
    return res.status(400).json({ erro: `Situação inválida. Use: ${situacaoValida.join(', ')}` });
  }

  const novaSituacao = situacao || antes.situacao;
  const novoSalarioBruto = salario_bruto ?? antes.salario_bruto;
  const novoSalarioLiquido = salario_liquido ?? antes.salario_liquido;

  // Transação: atualizar funcionário + tratar mudança de situação
  const executar = db.transaction(() => {
    // Atualizar dados básicos do funcionário
    // Adicionar colunas extras se necessário via try/catch
    try {
      db.exec(`ALTER TABLE funcionarios ADD COLUMN observacoes TEXT`);
    } catch(_) {}

    db.prepare(`
      UPDATE funcionarios SET
        nome=?, cargo=?, lotacao=?, salario_bruto=?, salario_liquido=?,
        situacao=?, data_admissao=?, observacoes=?, atualizado_em=datetime('now')
      WHERE id=?
    `).run(
      nome || antes.nome, cargo || antes.cargo, lotacao || antes.lotacao,
      novoSalarioBruto, novoSalarioLiquido,
      novaSituacao, data_admissao || antes.data_admissao,
      observacoes || null, req.params.id
    );

    // Se mudou para DEMITIDO ou LICENCIADO → cancelar contratos ativos
    if (situacao && situacao !== antes.situacao &&
        ['DEMITIDO', 'LICENCIADO', 'INATIVO', 'AFASTADO'].includes(situacao)) {

      const motivo = observacoes || `Funcionário marcado como ${situacao}`;

      // Buscar contratos ativos
      const contratosAtivos = db.prepare(`
        SELECT a.*, b.nome as banco_nome, b.id as banco_id
        FROM averbacoes a
        JOIN bancos b ON b.id = a.banco_id
        WHERE a.funcionario_id = ? AND a.status IN ('RESERVADA','APROVADA','PENDENTE')
      `).all(req.params.id);

      if (contratosAtivos.length > 0) {
        // Cancelar averbações e devolver margem
        for (const av of contratosAtivos) {
          const tipoMap = {
            'EMPRESTIMO': 'margem_disponivel_emprestimo', 'REFINANCIAMENTO': 'margem_disponivel_emprestimo',
            'CARTAO': 'margem_disponivel_cartao', 'BENEFICIO': 'margem_disponivel_beneficio'
          };
          const campoDisp = tipoMap[av.tipo];
          const campoUsado = campoDisp?.replace('disponivel', 'usada');

          db.prepare(`
            UPDATE averbacoes SET status='CANCELADA', motivo_cancelamento=?, atualizado_em=datetime('now')
            WHERE id=?
          `).run(motivo, av.id);

          if (campoDisp) {
            const margem = db.prepare('SELECT * FROM margens WHERE funcionario_id = ? ORDER BY competencia DESC LIMIT 1').get(req.params.id);
            if (margem) {
              db.prepare(`
                UPDATE margens SET
                  ${campoUsado} = MAX(0, ${campoUsado} - ?),
                  ${campoDisp} = ${campoDisp} + ?,
                  atualizado_em = datetime('now')
                WHERE id = ?
              `).run(av.valor_parcela, av.valor_parcela, margem.id);
            }
          }
        }

        // Cancelar reservas temporárias
        db.prepare(`
          UPDATE reservas_margem SET status='CANCELADO', atualizado_em=datetime('now')
          WHERE funcionario_id = ? AND status = 'RESERVADO'
        `).run(req.params.id);

        return { contratos_cancelados: contratosAtivos.length, contratosAtivos };
      }
    }

    // Se salário mudou → recalcular margem
    if ((salario_bruto && salario_bruto !== antes.salario_bruto) ||
        (salario_liquido && salario_liquido !== antes.salario_liquido)) {
      const margens = calcularMargens(novoSalarioBruto, novoSalarioLiquido, {
        emprestimo: antes.percentual_emprestimo || 35,
        cartao: antes.percentual_cartao || 5,
        beneficio: antes.percentual_beneficio || 5
      });
      const competencia = gerarCompetencia();
      const margemExistente = db.prepare('SELECT id FROM margens WHERE funcionario_id = ? AND competencia = ?').get(req.params.id, competencia);
      if (margemExistente) {
        db.prepare(`
          UPDATE margens SET salario_bruto=?, salario_liquido=?,
            margem_total_emprestimo=?, margem_total_cartao=?, margem_total_beneficio=?,
            atualizado_em=datetime('now')
          WHERE id=?
        `).run(novoSalarioBruto, novoSalarioLiquido,
          margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio,
          margemExistente.id);
      }
    }

    return { contratos_cancelados: 0 };
  });

  const resultado = executar();

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip,
    acao: 'ATUALIZAR_FUNCIONARIO', modulo: 'FUNCIONARIOS',
    entidade_tipo: 'funcionario', entidade_id: req.params.id,
    dados_antes: { situacao: antes.situacao, salario_bruto: antes.salario_bruto },
    dados_depois: { situacao: novaSituacao, salario_bruto: novoSalarioBruto, contratos_cancelados: resultado.contratos_cancelados },
    resultado: 'SUCESSO'
  });

  // Disparar webhook para bancos se necessário
  if (resultado.contratos_cancelados > 0 && resultado.contratosAtivos) {
    const bancosNotif = [...new Set(resultado.contratosAtivos.map(c => c.banco_id))];
    for (const bancoId of bancosNotif) {
      try {
        dispararWebhook(antes.conv_id, bancoId, 'funcionario.situacao_alterada', {
          funcionario_nome: antes.nome, situacao_nova: novaSituacao,
          contratos_cancelados: resultado.contratosAtivos.filter(c => c.banco_id === bancoId).length
        });
      } catch(_) {}
    }
  }

  res.json({
    mensagem: 'Funcionário atualizado com sucesso',
    situacao: novaSituacao,
    contratos_cancelados: resultado.contratos_cancelados || 0,
    aviso: resultado.contratos_cancelados > 0
      ? `⚠️ ${resultado.contratos_cancelados} contrato(s) cancelado(s) automaticamente.`
      : undefined
  });
});

// =====================================================================
// GET /api/funcionarios/:id/margem — Consultar margem
// =====================================================================
router.get('/:id/margem', autenticar, (req, res) => {
  const { competencia } = req.query;

  const func = db.prepare(`
    SELECT f.*, c.percentual_emprestimo, c.percentual_cartao, c.percentual_beneficio, c.nome as convenio_nome
    FROM funcionarios f LEFT JOIN convenios c ON c.id = f.convenio_id WHERE f.id = ?
  `).get(req.params.id);
  if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado' });

  if (req.usuario.perfil === 'FUNCIONARIO' && req.usuario.id !== func.id) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  const comp = competencia || gerarCompetencia();
  let margem = db.prepare('SELECT * FROM margens WHERE funcionario_id = ? AND competencia = ?').get(func.id, comp);

  // Se não há margem para a competência, calcular dinamicamente
  if (!margem) {
    const margens = calcularMargens(func.salario_bruto, func.salario_liquido, {
      emprestimo: func.percentual_emprestimo || 35,
      cartao: func.percentual_cartao || 5,
      beneficio: func.percentual_beneficio || 5
    });
    // Calcular comprometido atual
    const comprometidoEmp = db.prepare(`SELECT COALESCE(SUM(valor_parcela),0) as t FROM averbacoes WHERE funcionario_id=? AND tipo IN ('EMPRESTIMO','REFINANCIAMENTO') AND status IN ('RESERVADA','APROVADA')`).get(func.id).t;
    const comprometidoCart = db.prepare(`SELECT COALESCE(SUM(valor_parcela),0) as t FROM averbacoes WHERE funcionario_id=? AND tipo='CARTAO' AND status IN ('RESERVADA','APROVADA')`).get(func.id).t;
    const comprometidoBenef = db.prepare(`SELECT COALESCE(SUM(valor_parcela),0) as t FROM averbacoes WHERE funcionario_id=? AND tipo='BENEFICIO' AND status IN ('RESERVADA','APROVADA')`).get(func.id).t;
    margem = {
      competencia: comp,
      salario_bruto: func.salario_bruto,
      salario_liquido: func.salario_liquido,
      margem_total_emprestimo: margens.margemEmprestimo,
      margem_total_cartao: margens.margemCartao,
      margem_total_beneficio: margens.margemBeneficio,
      margem_usada_emprestimo: comprometidoEmp,
      margem_usada_cartao: comprometidoCart,
      margem_usada_beneficio: comprometidoBenef,
      margem_disponivel_emprestimo: Math.max(0, margens.margemEmprestimo - comprometidoEmp),
      margem_disponivel_cartao: Math.max(0, margens.margemCartao - comprometidoCart),
      margem_disponivel_beneficio: Math.max(0, margens.margemBeneficio - comprometidoBenef),
      _calculada_dinamicamente: true
    };
  }

  const averbacoes = db.prepare(`
    SELECT a.*, b.nome as banco_nome FROM averbacoes a
    LEFT JOIN bancos b ON b.id = a.banco_id
    WHERE a.funcionario_id = ? AND a.status IN ('RESERVADA','APROVADA')
    ORDER BY a.criado_em DESC
  `).all(func.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip: obterIP(req), acao: 'CONSULTAR_MARGEM', modulo: 'MARGENS', entidade_tipo: 'funcionario', entidade_id: func.id, resultado: 'SUCESSO' });

  res.json({
    funcionario: {
      id: func.id, nome: func.nome, matricula: func.matricula,
      cpf: mascaraCPF(func.cpf), convenio: func.convenio_nome,
      situacao: func.situacao, salario_bruto: func.salario_bruto, salario_liquido: func.salario_liquido
    },
    competencia: comp,
    margem: margem || null,
    averbacoes_ativas: averbacoes,
    bloqueado: ['DEMITIDO', 'LICENCIADO', 'INATIVO'].includes(func.situacao),
    motivo_bloqueio: ['DEMITIDO', 'LICENCIADO', 'INATIVO'].includes(func.situacao)
      ? `Funcionário com situação ${func.situacao}. Novas averbações não permitidas.` : null
  });
});

// =====================================================================
// GET /api/funcionarios/:id/historico — Histórico de contratos
// =====================================================================
router.get('/:id/historico', autenticar, (req, res) => {
  const func = db.prepare('SELECT id, nome, cpf, situacao FROM funcionarios WHERE id = ?').get(req.params.id);
  if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado' });

  if (req.usuario.perfil === 'FUNCIONARIO' && req.usuario.id !== func.id) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  const historico = db.prepare(`
    SELECT a.*, b.nome as banco_nome, c.nome as convenio_nome
    FROM averbacoes a
    LEFT JOIN bancos b ON b.id = a.banco_id
    LEFT JOIN convenios c ON c.id = a.convenio_id
    WHERE a.funcionario_id = ?
    ORDER BY a.criado_em DESC
  `).all(func.id);

  res.json({ funcionario: { ...func, cpf: mascaraCPF(func.cpf) }, historico });
});

module.exports = router;
