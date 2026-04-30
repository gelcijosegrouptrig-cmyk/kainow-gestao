/**
 * API Bank-Side v1 — AverbaTech Averbadora
 * 
 * Fluxo completo:
 *   1. POST /v1/oauth/token          → Autenticação OAuth2
 *   2. POST /v1/margem/consultar     → Consulta margem disponível
 *   3. POST /v1/reserva              → Reserva margem (bloqueia)
 *   4. GET  /v1/reserva/:id          → Status da reserva
 *   5. POST /v1/averbar              → Efetivar averbação (gera bilhete)
 *   6. POST /v1/cancelar             → Cancelar/quitar
 *   7. GET  /v1/bilhete/:numero      → Consultar bilhete
 *   8. GET  /v1/extrato/:cpf         → Extrato de contratos ativos
 */

const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../database');
const { autenticarOAuth2, emitirToken } = require('../middleware/oauth2');
const { dispararWebhook } = require('../services/webhookService');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function limparCPF(cpf) {
  return (cpf || '').replace(/\D/g, '');
}

function gerarIdReserva() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `RSV-${ts}-${rnd}`;
}

function gerarNumeroBilhete() {
  const ano = new Date().getFullYear();
  const seq = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `MPR-${ano}-${seq}`;
}

function calcularMargemDisponivel(funcionario, convenio) {
  const salarioBase = funcionario.salario_liquido > 0
    ? funcionario.salario_liquido
    : funcionario.salario_bruto;

  const limiteEmp   = salarioBase * ((convenio.percentual_emprestimo  || 35) / 100);
  const limiteCart  = salarioBase * ((convenio.percentual_cartao      ||  5) / 100);
  const limiteBenef = salarioBase * ((convenio.percentual_beneficio   ||  5) / 100);

  // Somar comprometido (averbações ativas + reservas vigentes)
  const comprometidoEmp = db.prepare(`
    SELECT COALESCE(SUM(valor_parcela),0) as total
    FROM averbacoes
    WHERE funcionario_id = ? AND tipo = 'EMPRESTIMO' AND status IN ('APROVADA','PENDENTE','RESERVADA')
  `).get(funcionario.id).total;

  const comprometidoCart = db.prepare(`
    SELECT COALESCE(SUM(valor_parcela),0) as total
    FROM averbacoes
    WHERE funcionario_id = ? AND tipo = 'CARTAO' AND status IN ('APROVADA','PENDENTE','RESERVADA')
  `).get(funcionario.id).total;

  const comprometidoBenef = db.prepare(`
    SELECT COALESCE(SUM(valor_parcela),0) as total
    FROM averbacoes
    WHERE funcionario_id = ? AND tipo = 'BENEFICIO' AND status IN ('APROVADA','PENDENTE','RESERVADA')
  `).get(funcionario.id).total;

  // Reservas temporárias não expiradas
  const reservasEmp = db.prepare(`
    SELECT COALESCE(SUM(valor_parcela),0) as total
    FROM reservas_margem
    WHERE funcionario_id = ? AND tipo = 'EMPRESTIMO' AND status = 'RESERVADO'
      AND expira_em > datetime('now')
  `).get(funcionario.id).total;

  const reservasCart = db.prepare(`
    SELECT COALESCE(SUM(valor_parcela),0) as total
    FROM reservas_margem
    WHERE funcionario_id = ? AND tipo = 'CARTAO' AND status = 'RESERVADO'
      AND expira_em > datetime('now')
  `).get(funcionario.id).total;

  return {
    salario_base:       salarioBase,
    emprestimo: {
      limite:           limiteEmp,
      comprometido:     comprometidoEmp + reservasEmp,
      disponivel:       Math.max(0, limiteEmp - comprometidoEmp - reservasEmp),
      percentual:       convenio.percentual_emprestimo || 35
    },
    cartao: {
      limite:           limiteCart,
      comprometido:     comprometidoCart + reservasCart,
      disponivel:       Math.max(0, limiteCart - comprometidoCart - reservasCart),
      percentual:       convenio.percentual_cartao || 5
    },
    beneficio: {
      limite:           limiteBenef,
      comprometido:     comprometidoBenef,
      disponivel:       Math.max(0, limiteBenef - comprometidoBenef),
      percentual:       convenio.percentual_beneficio || 5
    },
    total_disponivel: Math.max(0, limiteEmp - comprometidoEmp - reservasEmp)
                    + Math.max(0, limiteCart - comprometidoCart - reservasCart)
                    + Math.max(0, limiteBenef - comprometidoBenef)
  };
}

function logApi(acao, dados, req) {
  try {
    db.prepare(`
      INSERT INTO logs_auditoria
        (id, usuario_email, perfil, ip, acao, modulo, resultado, detalhe, criado_em)
      VALUES (NULL, ?, 'BANCO', ?, ?, 'bank_api', ?, ?, datetime('now'))
    `).run(
      req.oauth?.clientNome || 'BANCO',
      req.ip,
      acao,
      dados.resultado || 'SUCESSO',
      JSON.stringify(dados)
    );
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────
// 1. OAuth2 Token Endpoint
//    POST /v1/oauth/token
// ─────────────────────────────────────────────────────────────
router.post('/oauth/token', emitirToken);

// ─────────────────────────────────────────────────────────────
// 2. Consulta de Margem em Tempo Real
//    POST /v1/margem/consultar
//    Body: { cpf, convenio_id? }
// ─────────────────────────────────────────────────────────────
router.post('/margem/consultar', autenticarOAuth2('margem:consultar'), (req, res) => {
  const cpf = limparCPF(req.body.cpf);
  if (!cpf || cpf.length !== 11) {
    return res.status(400).json({ erro: 'CPF inválido', codigo: 'CPF_INVALIDO' });
  }

  const funcionario = db.prepare(`
    SELECT f.*, c.nome as convenio_nome, c.percentual_emprestimo,
           c.percentual_cartao, c.percentual_beneficio, c.id as convenio_id_real
    FROM funcionarios f
    JOIN convenios c ON c.id = f.convenio_id
    WHERE f.cpf = ? AND f.situacao = 'ATIVO'
  `).get(cpf);

  if (!funcionario) {
    logApi('CONSULTA_MARGEM', { cpf, resultado: 'FALHA', motivo: 'Funcionário não encontrado' }, req);
    return res.status(404).json({
      erro: 'Funcionário não encontrado ou inativo',
      codigo: 'FUNCIONARIO_NAO_ENCONTRADO',
      cpf
    });
  }

  const margem = calcularMargemDisponivel(funcionario, {
    percentual_emprestimo:  funcionario.percentual_emprestimo,
    percentual_cartao:      funcionario.percentual_cartao,
    percentual_beneficio:   funcionario.percentual_beneficio
  });

  logApi('CONSULTA_MARGEM', { cpf, resultado: 'SUCESSO', total_disponivel: margem.total_disponivel }, req);

  return res.json({
    cpf,
    nome:           funcionario.nome.split(' ')[0] + ' ' + funcionario.nome.split(' ').slice(-1)[0],
    matricula:      funcionario.matricula,
    convenio:       funcionario.convenio_nome,
    situacao:       funcionario.situacao,
    margem,
    consultado_em:  new Date().toISOString(),
    banco_solicitante: req.oauth.bancoNome
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Reserva de Margem (Bloqueio Temporário)
//    POST /v1/reserva
//    Body: { cpf, tipo, valor_parcela, prazo_meses, taxa_juros? }
// ─────────────────────────────────────────────────────────────
router.post('/reserva', autenticarOAuth2('reserva:criar'), (req, res) => {
  const { cpf: cpfRaw, tipo, valor_parcela, prazo_meses, taxa_juros } = req.body;
  const cpf = limparCPF(cpfRaw);

  // Validações
  if (!cpf || cpf.length !== 11) {
    return res.status(400).json({ erro: 'CPF inválido', codigo: 'CPF_INVALIDO' });
  }
  if (!['EMPRESTIMO', 'CARTAO', 'BENEFICIO'].includes(tipo)) {
    return res.status(400).json({
      erro: 'tipo deve ser EMPRESTIMO, CARTAO ou BENEFICIO',
      codigo: 'TIPO_INVALIDO'
    });
  }
  if (!valor_parcela || valor_parcela <= 0) {
    return res.status(400).json({ erro: 'valor_parcela inválido', codigo: 'VALOR_INVALIDO' });
  }
  if (!prazo_meses || prazo_meses < 1 || prazo_meses > 96) {
    return res.status(400).json({ erro: 'prazo_meses deve ser entre 1 e 96', codigo: 'PRAZO_INVALIDO' });
  }

  const funcionario = db.prepare(`
    SELECT f.*, c.percentual_emprestimo, c.percentual_cartao,
           c.percentual_beneficio, c.id as conv_id
    FROM funcionarios f
    JOIN convenios c ON c.id = f.convenio_id
    WHERE f.cpf = ? AND f.situacao = 'ATIVO'
  `).get(cpf);

  if (!funcionario) {
    return res.status(404).json({
      erro: 'Funcionário não encontrado ou inativo',
      codigo: 'FUNCIONARIO_NAO_ENCONTRADO'
    });
  }

  const margem = calcularMargemDisponivel(funcionario, {
    percentual_emprestimo:  funcionario.percentual_emprestimo,
    percentual_cartao:      funcionario.percentual_cartao,
    percentual_beneficio:   funcionario.percentual_beneficio
  });

  const tipoKey = tipo.toLowerCase();
  const margemTipo = tipoKey === 'emprestimo' ? margem.emprestimo
                   : tipoKey === 'cartao'     ? margem.cartao
                   :                            margem.beneficio;

  if (valor_parcela > margemTipo.disponivel) {
    logApi('RESERVA_MARGEM', {
      cpf, tipo, valor_parcela, disponivel: margemTipo.disponivel,
      resultado: 'FALHA', motivo: 'Margem insuficiente'
    }, req);
    return res.status(422).json({
      erro: 'Margem insuficiente',
      codigo: 'MARGEM_INSUFICIENTE',
      disponivel: margemTipo.disponivel,
      solicitado: valor_parcela,
      diferenca:  valor_parcela - margemTipo.disponivel
    });
  }

  const idReserva   = gerarIdReserva();
  const valorTotal  = valor_parcela * prazo_meses;
  const expiraEm    = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  // bancoId pode ser null quando client não está vinculado a banco específico
  const bancoIdParaReserva = req.oauth.bancoId || (
    db.prepare(`SELECT id FROM bancos WHERE ativo = 1 LIMIT 1`).get()?.id
  );

  // req.oauth.clientId já é o UUID interno da tabela oauth2_clients (validado no middleware)
  const clientIdValido = req.oauth.clientId || null;

  db.prepare(`
    INSERT INTO reservas_margem
      (id, id_reserva, funcionario_id, banco_id, convenio_id, cpf, tipo,
       valor_parcela, prazo_meses, valor_total, taxa_juros, expira_em, client_id, ip_origem, criado_em)
    VALUES
      (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    idReserva, funcionario.id, bancoIdParaReserva, funcionario.conv_id,
    cpf, tipo, valor_parcela, prazo_meses, valorTotal, taxa_juros || null,
    expiraEm, clientIdValido, req.ip
  );

  logApi('RESERVA_MARGEM', {
    cpf, tipo, valor_parcela, id_reserva: idReserva, resultado: 'SUCESSO'
  }, req);

  // Disparar webhook para o convênio
  dispararWebhook(funcionario.conv_id, null, 'margem.reservada', {
    id_reserva: idReserva, cpf, tipo, valor_parcela, banco: req.oauth.bancoNome
  });

  return res.status(201).json({
    id_reserva:     idReserva,
    status:         'RESERVADO',
    cpf,
    tipo,
    valor_parcela,
    prazo_meses,
    valor_total:    valorTotal,
    margem_restante: margemTipo.disponivel - valor_parcela,
    expira_em:      expiraEm,
    instrucoes:     'Confirme a averbação via POST /v1/averbar com este id_reserva dentro de 30 minutos'
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Status da Reserva
//    GET /v1/reserva/:id_reserva
// ─────────────────────────────────────────────────────────────
router.get('/reserva/:id_reserva', autenticarOAuth2('reserva:criar'), (req, res) => {
  const reserva = db.prepare(`
    SELECT r.*, f.nome as funcionario_nome, b.nome as banco_nome
    FROM reservas_margem r
    JOIN funcionarios f ON f.id = r.funcionario_id
    LEFT JOIN bancos b ON b.id = r.banco_id
    WHERE r.id_reserva = ?
  `).get(req.params.id_reserva);

  if (!reserva) {
    return res.status(404).json({ erro: 'Reserva não encontrada', codigo: 'RESERVA_NAO_ENCONTRADA' });
  }

  // Marcar expiradas
  if (reserva.status === 'RESERVADO' && new Date(reserva.expira_em) < new Date()) {
    db.prepare(`UPDATE reservas_margem SET status = 'EXPIRADO' WHERE id_reserva = ?`)
      .run(reserva.id_reserva);
    reserva.status = 'EXPIRADO';
  }

  return res.json({
    id_reserva:       reserva.id_reserva,
    status:           reserva.status,
    cpf:              reserva.cpf,
    tipo:             reserva.tipo,
    valor_parcela:    reserva.valor_parcela,
    prazo_meses:      reserva.prazo_meses,
    valor_total:      reserva.valor_total,
    expira_em:        reserva.expira_em,
    averbacao_id:     reserva.averbacao_id,
    criado_em:        reserva.criado_em
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Efetivar Averbação (confirma contrato assinado)
//    POST /v1/averbar
//    Body: { id_reserva, numero_contrato, competencia_inicio? }
// ─────────────────────────────────────────────────────────────
router.post('/averbar', autenticarOAuth2('averbacao:efetivar'), (req, res) => {
  const { id_reserva, numero_contrato, competencia_inicio } = req.body;

  if (!id_reserva) {
    return res.status(400).json({ erro: 'id_reserva é obrigatório', codigo: 'RESERVA_REQUERIDA' });
  }

  const reserva = db.prepare(`
    SELECT r.*, f.nome as func_nome, f.matricula, f.salario_liquido, f.salario_bruto,
           b.nome as banco_nome, b.codigo_bacen, b.taxa_averbacao,
           c.nome as convenio_nome
    FROM reservas_margem r
    JOIN funcionarios f ON f.id = r.funcionario_id
    JOIN bancos b ON b.id = r.banco_id
    JOIN convenios c ON c.id = r.convenio_id
    WHERE r.id_reserva = ?
  `).get(id_reserva);

  if (!reserva) {
    return res.status(404).json({ erro: 'Reserva não encontrada', codigo: 'RESERVA_NAO_ENCONTRADA' });
  }
  if (reserva.status !== 'RESERVADO') {
    return res.status(422).json({
      erro: `Reserva com status '${reserva.status}' não pode ser efetivada`,
      codigo: 'STATUS_INVALIDO',
      status_atual: reserva.status
    });
  }
  if (new Date(reserva.expira_em) < new Date()) {
    db.prepare(`UPDATE reservas_margem SET status = 'EXPIRADO' WHERE id_reserva = ?`).run(id_reserva);
    return res.status(422).json({
      erro: 'Reserva expirada. Faça uma nova reserva.',
      codigo: 'RESERVA_EXPIRADA'
    });
  }

  const competencia = competencia_inicio
    || `${new Date().getFullYear()}-${String(new Date().getMonth() + 2).padStart(2, '0')}`;

  // Gerar código único da averbação
  const codigo = `AVB${Date.now().toString(36).toUpperCase()}`;

  // Criar averbação oficial
  const averbacaoId = db.prepare(`
    INSERT INTO averbacoes
      (id, codigo_averbacao, funcionario_id, convenio_id, banco_id, tipo, status,
       valor_parcela, prazo_meses, valor_total, taxa_juros, competencia_inicio,
       numero_contrato_banco, solicitado_por, taxa_averbacao_cobrada, criado_em, atualizado_em)
    VALUES
      (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 'APROVADA',
       ?, ?, ?, ?, ?,
       ?, ?, ?, datetime('now'), datetime('now'))
    RETURNING id
  `).get(
    codigo, reserva.funcionario_id, reserva.convenio_id, reserva.banco_id,
    reserva.tipo, reserva.valor_parcela, reserva.prazo_meses, reserva.valor_total,
    reserva.taxa_juros, competencia, numero_contrato || null,
    req.oauth?.clientNome || 'API_BANCO',
    reserva.taxa_averbacao || 15.00
  );

  // Atualizar reserva para EFETIVADO
  db.prepare(`
    UPDATE reservas_margem SET status = 'EFETIVADO', averbacao_id = ?, atualizado_em = datetime('now')
    WHERE id_reserva = ?
  `).run(averbacaoId.id, id_reserva);

  // Gerar bilhete de averbação
  const numeroBilhete = gerarNumeroBilhete();
  const dadosBilhete  = {
    numero_bilhete:   numeroBilhete,
    averbacao_id:     averbacaoId.id,
    codigo_averbacao: codigo,
    funcionario:      { cpf: reserva.cpf, nome: reserva.func_nome, matricula: reserva.matricula },
    banco:            { nome: reserva.banco_nome, codigo: reserva.codigo_bacen },
    contrato:         {
      tipo:           reserva.tipo,
      numero:         numero_contrato || 'N/A',
      valor_parcela:  reserva.valor_parcela,
      prazo_meses:    reserva.prazo_meses,
      valor_total:    reserva.valor_total,
      taxa_juros:     reserva.taxa_juros,
      competencia:    competencia
    },
    emitido_em:       new Date().toISOString()
  };

  const hashIntegridade = crypto
    .createHash('sha256')
    .update(JSON.stringify(dadosBilhete))
    .digest('hex');

  db.prepare(`
    INSERT INTO bilhetes_averbacao
      (id, numero_bilhete, averbacao_id, reserva_id, funcionario_cpf, funcionario_nome,
       banco_nome, banco_codigo, tipo, valor_parcela, prazo_meses, valor_total,
       taxa_juros, competencia_inicio, numero_contrato, hash_integridade, dados_json, emitido_em)
    VALUES
      (lower(hex(randomblob(16))), ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    numeroBilhete, averbacaoId.id, reserva.id, reserva.cpf, reserva.func_nome,
    reserva.banco_nome, reserva.codigo_bacen, reserva.tipo,
    reserva.valor_parcela, reserva.prazo_meses, reserva.valor_total,
    reserva.taxa_juros, competencia, numero_contrato || null,
    hashIntegridade, JSON.stringify(dadosBilhete)
  );

  logApi('EFETIVAR_AVERBACAO', {
    id_reserva, averbacao_id: averbacaoId.id, numero_bilhete: numeroBilhete, resultado: 'SUCESSO'
  }, req);

  // Webhooks
  dispararWebhook(reserva.convenio_id, reserva.banco_id, 'averbacao.efetivada', {
    numero_bilhete: numeroBilhete,
    codigo_averbacao: codigo,
    cpf: reserva.cpf,
    tipo: reserva.tipo,
    valor_parcela: reserva.valor_parcela,
    banco: reserva.banco_nome
  });

  return res.status(201).json({
    sucesso:          true,
    codigo_averbacao: codigo,
    numero_bilhete:   numeroBilhete,
    averbacao_id:     averbacaoId.id,
    status:           'APROVADA',
    cpf:              reserva.cpf,
    tipo:             reserva.tipo,
    valor_parcela:    reserva.valor_parcela,
    prazo_meses:      reserva.prazo_meses,
    valor_total:      reserva.valor_total,
    competencia_inicio: competencia,
    taxa_averbacao:   reserva.taxa_averbacao || 15.00,
    hash_integridade: hashIntegridade,
    bilhete_url:      `/v1/bilhete/${numeroBilhete}`,
    efetivado_em:     new Date().toISOString()
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Cancelar / Quitar Averbação
//    POST /v1/cancelar
//    Body: { codigo_averbacao | numero_bilhete, motivo }
// ─────────────────────────────────────────────────────────────
router.post('/cancelar', autenticarOAuth2('averbacao:cancelar'), (req, res) => {
  const { codigo_averbacao, numero_bilhete, motivo } = req.body;

  if (!codigo_averbacao && !numero_bilhete) {
    return res.status(400).json({
      erro: 'Informe codigo_averbacao ou numero_bilhete',
      codigo: 'IDENTIFICADOR_REQUERIDO'
    });
  }

  let averbacao;
  if (codigo_averbacao) {
    averbacao = db.prepare(`
      SELECT a.*, b.nome as banco_nome, f.nome as func_nome, f.cpf,
             c.id as conv_id
      FROM averbacoes a
      JOIN bancos b ON b.id = a.banco_id
      JOIN funcionarios f ON f.id = a.funcionario_id
      JOIN convenios c ON c.id = a.convenio_id
      WHERE a.codigo_averbacao = ?
    `).get(codigo_averbacao);
  } else {
    const bilhete = db.prepare(`SELECT averbacao_id FROM bilhetes_averbacao WHERE numero_bilhete = ?`)
      .get(numero_bilhete);
    if (bilhete) {
      averbacao = db.prepare(`
        SELECT a.*, b.nome as banco_nome, f.nome as func_nome, f.cpf,
               c.id as conv_id
        FROM averbacoes a
        JOIN bancos b ON b.id = a.banco_id
        JOIN funcionarios f ON f.id = a.funcionario_id
        JOIN convenios c ON c.id = a.convenio_id
        WHERE a.id = ?
      `).get(bilhete.averbacao_id);
    }
  }

  if (!averbacao) {
    return res.status(404).json({ erro: 'Averbação não encontrada', codigo: 'AVERBACAO_NAO_ENCONTRADA' });
  }
  if (averbacao.status === 'CANCELADA') {
    return res.status(422).json({ erro: 'Averbação já cancelada', codigo: 'JA_CANCELADO' });
  }

  // Verificar se o banco tem permissão (só pode cancelar as próprias)
  if (req.oauth.bancoId && averbacao.banco_id !== req.oauth.bancoId) {
    return res.status(403).json({
      erro: 'Sem permissão para cancelar averbações de outro banco',
      codigo: 'PERMISSAO_NEGADA'
    });
  }

  db.prepare(`
    UPDATE averbacoes
    SET status = 'CANCELADA', motivo_cancelamento = ?, atualizado_em = datetime('now')
    WHERE id = ?
  `).run(motivo || 'Cancelado via API', averbacao.id);

  // Invalidar bilhetes
  db.prepare(`
    UPDATE bilhetes_averbacao SET status = 'CANCELADO', cancelado_em = datetime('now')
    WHERE averbacao_id = ?
  `).run(averbacao.id);

  // Liberar reserva (se houver)
  db.prepare(`
    UPDATE reservas_margem SET status = 'CANCELADO', atualizado_em = datetime('now')
    WHERE averbacao_id = ?
  `).run(averbacao.id);

  logApi('CANCELAR_AVERBACAO', {
    codigo_averbacao: averbacao.codigo_averbacao,
    motivo, resultado: 'SUCESSO'
  }, req);

  dispararWebhook(averbacao.conv_id, averbacao.banco_id, 'averbacao.cancelada', {
    codigo_averbacao: averbacao.codigo_averbacao,
    cpf:              averbacao.cpf,
    motivo,
    banco:            averbacao.banco_nome
  });

  return res.json({
    sucesso:          true,
    codigo_averbacao: averbacao.codigo_averbacao,
    status:           'CANCELADA',
    motivo:           motivo || 'Cancelado via API',
    margem_liberada:  averbacao.valor_parcela,
    cancelado_em:     new Date().toISOString()
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Consultar Bilhete de Averbação
//    GET /v1/bilhete/:numero
// ─────────────────────────────────────────────────────────────
router.get('/bilhete/:numero', autenticarOAuth2('margem:consultar'), (req, res) => {
  const bilhete = db.prepare(`
    SELECT b.*, a.codigo_averbacao, a.status as status_averbacao
    FROM bilhetes_averbacao b
    JOIN averbacoes a ON a.id = b.averbacao_id
    WHERE b.numero_bilhete = ?
  `).get(req.params.numero);

  if (!bilhete) {
    return res.status(404).json({ erro: 'Bilhete não encontrado', codigo: 'BILHETE_NAO_ENCONTRADO' });
  }

  // Verificar integridade
  const dados        = JSON.parse(bilhete.dados_json || '{}');
  const hashAtual    = crypto.createHash('sha256').update(JSON.stringify(dados)).digest('hex');
  const integroidade = hashAtual === bilhete.hash_integridade ? 'INTEGRO' : 'CORROMPIDO';

  return res.json({
    numero_bilhete:   bilhete.numero_bilhete,
    status:           bilhete.status,
    integridade:      integroidade,
    codigo_averbacao: bilhete.codigo_averbacao,
    funcionario: {
      cpf:  bilhete.funcionario_cpf,
      nome: bilhete.funcionario_nome
    },
    banco: {
      nome:   bilhete.banco_nome,
      codigo: bilhete.banco_codigo
    },
    contrato: {
      tipo:            bilhete.tipo,
      numero:          bilhete.numero_contrato,
      valor_parcela:   bilhete.valor_parcela,
      prazo_meses:     bilhete.prazo_meses,
      valor_total:     bilhete.valor_total,
      competencia:     bilhete.competencia_inicio
    },
    hash_integridade: bilhete.hash_integridade,
    emitido_em:       bilhete.emitido_em,
    cancelado_em:     bilhete.cancelado_em
  });
});

// ─────────────────────────────────────────────────────────────
// 8. Extrato de Contratos Ativos
//    GET /v1/extrato/:cpf
// ─────────────────────────────────────────────────────────────
router.get('/extrato/:cpf', autenticarOAuth2('margem:consultar'), (req, res) => {
  const cpf = limparCPF(req.params.cpf);
  if (!cpf || cpf.length !== 11) {
    return res.status(400).json({ erro: 'CPF inválido', codigo: 'CPF_INVALIDO' });
  }

  const funcionario = db.prepare(`
    SELECT f.*, c.nome as convenio_nome,
           c.percentual_emprestimo, c.percentual_cartao, c.percentual_beneficio
    FROM funcionarios f JOIN convenios c ON c.id = f.convenio_id
    WHERE f.cpf = ?
  `).get(cpf);

  if (!funcionario) {
    return res.status(404).json({ erro: 'Funcionário não encontrado', codigo: 'FUNCIONARIO_NAO_ENCONTRADO' });
  }

  const contratos = db.prepare(`
    SELECT a.codigo_averbacao, a.tipo, a.status, a.valor_parcela,
           a.prazo_meses, a.valor_total, a.competencia_inicio, a.competencia_fim,
           a.numero_contrato_banco, a.criado_em,
           b.nome as banco_nome, b.codigo_bacen,
           blt.numero_bilhete
    FROM averbacoes a
    JOIN bancos b ON b.id = a.banco_id
    LEFT JOIN bilhetes_averbacao blt ON blt.averbacao_id = a.id AND blt.status = 'VALIDO'
    WHERE a.funcionario_id = ?
    ORDER BY a.criado_em DESC
  `).all(funcionario.id);

  const margem = calcularMargemDisponivel(funcionario, {
    percentual_emprestimo:  funcionario.percentual_emprestimo,
    percentual_cartao:      funcionario.percentual_cartao,
    percentual_beneficio:   funcionario.percentual_beneficio
  });

  logApi('CONSULTA_EXTRATO', { cpf, resultado: 'SUCESSO', total_contratos: contratos.length }, req);

  return res.json({
    cpf,
    funcionario:    funcionario.nome,
    convenio:       funcionario.convenio_nome,
    margem_atual:   margem,
    contratos,
    total_contratos: contratos.length,
    ativos:         contratos.filter(c => c.status === 'APROVADA').length,
    consultado_em:  new Date().toISOString()
  });
});

module.exports = router;
