/**
 * API RH-Side — AverbaTech
 * Sincronização de folha de pagamento e exportação de descontos
 * 
 * Rotas:
 *   POST /api/rh/sincronizar          → Enviar lista de funcionários/salários
 *   GET  /api/rh/exportar-descontos   → Gerar arquivo de descontos (CNAB/TXT/CSV)
 *   GET  /api/rh/sincronizacoes       → Histórico de sincronizações
 *   POST /api/rh/notificar-demissao   → Notificar demissão (cancela contratos + webhook)
 *   GET  /api/rh/relatorio-margem     → Relatório de margem por convênio
 */

const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../database');
const { autenticar, autorizar } = require('../middleware/auth');
const { autenticarOAuth2 }      = require('../middleware/oauth2');
const { dispararWebhook }       = require('../services/webhookService');
const { registrarLog }          = require('../utils/auditoria');
const { obterIP }               = require('../utils/helpers');

const router = express.Router();

// ─── Middleware: aceita tanto JWT (admin) quanto OAuth2 (parceiros RH) ───────
function autRH(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer mpr_') ||
      // Tokens OAuth2 são hexadecimais de 96 chars
      (authHeader.startsWith('Bearer ') && authHeader.slice(7).length === 96)) {
    return autenticarOAuth2('folha:sincronizar')(req, res, next);
  }
  return autenticar(req, res, next);
}

// ─── Helper: gerar código de competência ─────────────────────────────────────
function competenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Helper: formatar valor monetário para CNAB (13 dígitos, sem ponto) ──────
function fmtCNAB(valor, tamanho = 13) {
  const centavos = Math.round((valor || 0) * 100);
  return String(centavos).padStart(tamanho, '0');
}

function fmtStr(str, tamanho) {
  return String(str || '').padEnd(tamanho).slice(0, tamanho);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /api/rh/sincronizar
//    Recebe lista de funcionários com salários atualizados
//    Body: { convenio_id, competencia?, funcionarios: [{cpf,matricula,nome,salario_bruto,salario_liquido,...}] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sincronizar', autRH, async (req, res) => {
  const ip = obterIP(req);
  const usuarioId    = req.usuario?.id    || req.oauth?.clientId;
  const usuarioEmail = req.usuario?.email || req.oauth?.clientNome || 'API_RH';

  const { convenio_id, competencia, funcionarios, formato } = req.body;

  if (!convenio_id) {
    return res.status(400).json({ erro: 'convenio_id é obrigatório' });
  }
  if (!Array.isArray(funcionarios) || funcionarios.length === 0) {
    return res.status(400).json({ erro: 'funcionarios deve ser array não vazio' });
  }

  const convenio = db.prepare(`SELECT * FROM convenios WHERE id = ? AND ativo = 1`).get(convenio_id);
  if (!convenio) {
    return res.status(404).json({ erro: 'Convênio não encontrado ou inativo' });
  }

  const competenciaStr = competencia || competenciaAtual();
  const syncId = db.prepare(`
    INSERT INTO sincronizacoes_folha
      (id, convenio_id, competencia, tipo, formato, total_registros, status, solicitado_por, criado_em)
    VALUES (lower(hex(randomblob(16))), ?, ?, 'ENTRADA', ?, ?, 'PROCESSANDO', ?, datetime('now'))
    RETURNING id
  `).get(convenio_id, competenciaStr, formato || 'JSON', funcionarios.length, usuarioEmail);

  let processados = 0, novos = 0, atualizados = 0, erros = 0;
  const detalhes = [];

  for (const func of funcionarios) {
    try {
      const cpf = (func.cpf || '').replace(/\D/g, '');
      if (!cpf || cpf.length !== 11) {
        erros++;
        detalhes.push({ cpf: func.cpf, erro: 'CPF inválido' });
        continue;
      }

      const existente = db.prepare(`SELECT * FROM funcionarios WHERE cpf = ?`).get(cpf);

      if (existente) {
        // Verificar se salário mudou
        const salarioMudou = Math.abs((existente.salario_bruto || 0) - (func.salario_bruto || 0)) > 0.01
                          || Math.abs((existente.salario_liquido || 0) - (func.salario_liquido || 0)) > 0.01;

        db.prepare(`
          UPDATE funcionarios SET
            nome           = COALESCE(?, nome),
            matricula      = COALESCE(?, matricula),
            cargo          = COALESCE(?, cargo),
            lotacao        = COALESCE(?, lotacao),
            salario_bruto  = COALESCE(?, salario_bruto),
            salario_liquido= COALESCE(?, salario_liquido),
            situacao       = COALESCE(?, situacao),
            atualizado_em  = datetime('now')
          WHERE cpf = ?
        `).run(
          func.nome        || null,
          func.matricula   || null,
          func.cargo       || null,
          func.lotacao     || null,
          func.salario_bruto   != null ? parseFloat(func.salario_bruto)   : null,
          func.salario_liquido != null ? parseFloat(func.salario_liquido) : null,
          func.situacao    || null,
          cpf
        );

        if (salarioMudou) {
          // Recalcular e atualizar margens
          atualizarMargens(existente.id, func.salario_bruto, func.salario_liquido, convenio);

          // Webhook: margem atualizada
          dispararWebhook(convenio_id, null, 'margem.atualizada', {
            cpf, nome: func.nome || existente.nome,
            salario_anterior: existente.salario_liquido,
            salario_novo: func.salario_liquido
          });
        }
        atualizados++;
      } else {
        // Criar novo funcionário
        db.prepare(`
          INSERT INTO funcionarios
            (id, matricula, nome, cpf, convenio_id, cargo, lotacao,
             salario_bruto, salario_liquido, situacao, criado_em, atualizado_em)
          VALUES
            (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?,
             ?, ?, ?, datetime('now'), datetime('now'))
        `).run(
          func.matricula || null, func.nome || 'N/I', cpf, convenio_id,
          func.cargo || null, func.lotacao || null,
          parseFloat(func.salario_bruto || 0),
          parseFloat(func.salario_liquido || 0),
          func.situacao || 'ATIVO'
        );
        novos++;
      }
      processados++;
      detalhes.push({ cpf, status: existente ? 'ATUALIZADO' : 'CRIADO' });
    } catch (e) {
      erros++;
      detalhes.push({ cpf: func.cpf, erro: e.message });
    }
  }

  // Atualizar sync
  db.prepare(`
    UPDATE sincronizacoes_folha SET
      processados = ?, novos = ?, atualizados = ?, erros = ?,
      status = ?, concluido_em = datetime('now')
    WHERE id = ?
  `).run(processados, novos, atualizados, erros,
    erros > 0 && processados === 0 ? 'ERRO' : 'CONCLUIDO', syncId.id);

  registrarLog({
    usuario_id: usuarioId, usuario_email: usuarioEmail, perfil: req.usuario?.perfil || 'API',
    ip, acao: 'SINCRONIZAR_FOLHA', modulo: 'rh',
    entidade_tipo: 'sincronizacao', entidade_id: syncId.id,
    resultado: erros > 0 ? 'PARCIAL' : 'SUCESSO',
    dados_depois: { competencia: competenciaStr, novos, atualizados, erros }
  });

  dispararWebhook(convenio_id, null, 'folha.sincronizada', {
    competencia: competenciaStr, processados, novos, atualizados, erros
  });

  return res.status(201).json({
    sucesso:        true,
    sync_id:        syncId.id,
    competencia:    competenciaStr,
    total:          funcionarios.length,
    processados,
    novos,
    atualizados,
    erros,
    detalhes:       erros > 0 ? detalhes.filter(d => d.erro) : undefined
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /api/rh/exportar-descontos
//    Gera arquivo de descontos para o RH descontar na folha
//    Query: convenio_id, competencia?, formato (JSON|CSV|CNAB240|TXT)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/exportar-descontos', autRH, (req, res) => {
  const { convenio_id, competencia, formato = 'JSON' } = req.query;

  // convenio_id é opcional — se 'all' ou vazio, retorna todos
  const convId = (convenio_id && convenio_id !== 'all') ? convenio_id : null;

  const competenciaStr = competencia || competenciaAtual();

  let descontosQuery = `
    SELECT
      f.cpf, f.matricula, f.nome, f.cargo, f.lotacao,
      a.codigo_averbacao, a.tipo, a.valor_parcela, a.prazo_meses,
      a.numero_contrato_banco, a.competencia_inicio, a.competencia_fim,
      b.nome as banco_nome, b.codigo_bacen,
      c.nome as convenio_nome
    FROM averbacoes a
    JOIN funcionarios f ON f.id = a.funcionario_id
    JOIN bancos b ON b.id = a.banco_id
    JOIN convenios c ON c.id = a.convenio_id
    WHERE a.status IN ('ATIVO','APROVADA')
      AND (a.competencia_fim IS NULL OR a.competencia_fim >= ?)
      AND a.competencia_inicio <= ?
  `;
  const descontosParams = [competenciaStr, competenciaStr];
  if (convId) {
    descontosQuery += ` AND a.convenio_id = ?`;
    descontosParams.push(convId);
  }
  descontosQuery += ` ORDER BY f.nome, a.tipo`;

  const descontos = db.prepare(descontosQuery).all(...descontosParams);
  const convenio_id_used = convId || 'all';

  const totalDesconto = descontos.reduce((s, d) => s + d.valor_parcela, 0);

  if (formato.toUpperCase() === 'CSV') {
    const linhas = [
      'CPF;MATRICULA;NOME;CARGO;CONVENIO;BANCO;TIPO;VALOR_PARCELA;CODIGO_AVERBACAO;COMPETENCIA'
    ];
    for (const d of descontos) {
      linhas.push([
        d.cpf, d.matricula || '', d.nome, d.cargo || '',
        d.convenio_nome || '', d.banco_nome, d.tipo,
        d.valor_parcela.toFixed(2).replace('.', ','),
        d.codigo_averbacao, competenciaStr
      ].join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=descontos_${competenciaStr}.csv`);
    return res.send('\uFEFF' + linhas.join('\r\n'));
  }

  if (formato.toUpperCase() === 'CNAB240') {
    // Padrão CNAB 240 simplificado para descontos consignados
    const linhas = [];
    const dataRef = competenciaStr.replace('-', '');

    // Header do arquivo
    linhas.push(
      '0' +                              // banco (1)
      '0000' +                           // lote (5)
      '0' +                              // tipo registro (1)
      ' '.repeat(9) +                    // brancos (9)
      '2' +                              // tipo inscricao (1)
      fmtStr(convenio_id, 14) +          // CNPJ convênio (14)
      ' '.repeat(20) +                   // convenio banco (20)
      fmtStr('AVERBA_TECH', 30) +          // nome empresa (30)
      fmtStr('AVERBA_TECH AVERBADORA', 30) + // nome banco (30)
      ' '.repeat(10) +                   // brancos (10)
      '1' +                              // codigo remessa (1)
      dataRef.slice(0, 8) +              // data geração (8)
      '000000' +                         // hora geração (6)
      '000001' +                         // seq arquivo (6)
      '093' +                            // versão layout (3)
      fmtCNAB(totalDesconto, 18) +       // total geral (18)
      ' '.repeat(3) +                    // brancos (3)
      fmtStr(String(descontos.length), 6) + // qtd lotes (6)
      fmtStr(String(descontos.length + 2), 6) + // qtd registros (6)
      ' '.repeat(29)                     // brancos (29)
    );

    let seq = 1;
    for (const d of descontos) {
      linhas.push(
        '3' +                            // tipo registro detalhe (1)
        '0001' +                         // lote (4)
        '3' +                            // tipo segmento J52 (1)
        ' ' +                            // branco (1)
        String(seq).padStart(5, '0') +   // seq. registro (5)
        'J' +                            // segmento (1)
        ' ' +                            // branco (1)
        '52' +                           // tipo mov (2)
        fmtStr(d.cpf, 14) +              // CPF favorecido (14)
        fmtStr(d.matricula || '', 20) +  // matrícula (20)
        fmtStr(d.nome, 30) +             // nome (30)
        dataRef +                        // data desconto (8)
        fmtCNAB(d.valor_parcela, 15) +   // valor (15)
        fmtStr(d.codigo_averbacao, 20) + // código averbação (20)
        fmtStr(d.tipo, 10) +             // tipo (10)
        fmtStr(d.banco_nome, 30) +       // banco (30)
        ' '.repeat(29)                   // brancos (29)
      );
      seq++;
    }

    // Trailer
    linhas.push(
      '9' + '9999' + '9' + ' '.repeat(9) +
      String(descontos.length + 2).padStart(6, '0') +
      fmtCNAB(totalDesconto, 18) +
      ' '.repeat(205)
    );

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=CNAB240_${competenciaStr}.rem`);
    return res.send(linhas.join('\r\n'));
  }

  if (formato.toUpperCase() === 'TXT') {
    const linhas = descontos.map(d =>
      [
        d.cpf.padEnd(11),
        (d.matricula || '').padEnd(10),
        d.nome.padEnd(40),
        d.tipo.padEnd(10),
        fmtCNAB(d.valor_parcela, 13),
        d.codigo_averbacao.padEnd(20),
        competenciaStr.padEnd(7)
      ].join('')
    );
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=descontos_${competenciaStr}.txt`);
    return res.send(linhas.join('\r\n'));
  }

  // JSON (padrão)
  return res.json({
    convenio_id:     convenio_id_used,
    competencia:     competenciaStr,
    total_registros: descontos.length,
    total_desconto:  totalDesconto,
    gerado_em:       new Date().toISOString(),
    descontos
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /api/rh/sincronizacoes
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sincronizacoes', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { convenio_id, limit = 50 } = req.query;
  let query = `
    SELECT s.*, c.nome as convenio_nome
    FROM sincronizacoes_folha s
    JOIN convenios c ON c.id = s.convenio_id
  `;
  const params = [];
  if (convenio_id) { query += ` WHERE s.convenio_id = ?`; params.push(convenio_id); }
  query += ` ORDER BY s.criado_em DESC LIMIT ?`;
  params.push(parseInt(limit));

  res.json(db.prepare(query).all(...params));
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/rh/notificar-demissao
//    RH notifica que funcionário foi demitido → cancela contratos + webhook
//    Body: { cpf, motivo?, data_demissao? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/notificar-demissao', autRH, (req, res) => {
  const ip           = obterIP(req);
  const usuarioEmail = req.usuario?.email || req.oauth?.clientNome || 'API_RH';
  const { cpf: cpfRaw, motivo, data_demissao } = req.body;
  const cpf = (cpfRaw || '').replace(/\D/g, '');

  if (!cpf || cpf.length !== 11) {
    return res.status(400).json({ erro: 'CPF inválido' });
  }

  const funcionario = db.prepare(`
    SELECT f.*, c.id as conv_id FROM funcionarios f
    JOIN convenios c ON c.id = f.convenio_id
    WHERE f.cpf = ?
  `).get(cpf);

  if (!funcionario) {
    return res.status(404).json({ erro: 'Funcionário não encontrado' });
  }

  // Cancelar todos os contratos ativos
  const contratosAtivos = db.prepare(`
    SELECT a.*, b.nome as banco_nome, b.id as banco_id
    FROM averbacoes a
    JOIN bancos b ON b.id = a.banco_id
    WHERE a.funcionario_id = ? AND a.status IN ('ATIVO', 'PENDENTE')
  `).all(funcionario.id);

  const motivoDemissao = motivo || `Demissão em ${data_demissao || new Date().toISOString().slice(0, 10)}`;

  db.prepare(`
    UPDATE averbacoes
    SET status = 'CANCELADO', motivo_cancelamento = ?, atualizado_em = datetime('now')
    WHERE funcionario_id = ? AND status IN ('ATIVO', 'PENDENTE')
  `).run(motivoDemissao, funcionario.id);

  // Cancelar reservas ativas
  db.prepare(`
    UPDATE reservas_margem SET status = 'CANCELADO', atualizado_em = datetime('now')
    WHERE funcionario_id = ? AND status = 'RESERVADO'
  `).run(funcionario.id);

  // Atualizar situação do funcionário
  db.prepare(`
    UPDATE funcionarios SET situacao = 'INATIVO', atualizado_em = datetime('now')
    WHERE id = ?
  `).run(funcionario.id);

  // Notificar cada banco via webhook
  const bancosNotificados = [...new Set(contratosAtivos.map(c => c.banco_id))];
  for (const bancoId of bancosNotificados) {
    dispararWebhook(funcionario.conv_id, bancoId, 'funcionario.demitido', {
      cpf,
      nome:           funcionario.nome,
      data_demissao:  data_demissao || new Date().toISOString().slice(0, 10),
      contratos_cancelados: contratosAtivos
        .filter(c => c.banco_id === bancoId)
        .map(c => ({ codigo: c.codigo_averbacao, valor: c.valor_parcela, tipo: c.tipo }))
    });
  }

  registrarLog({
    usuario_email: usuarioEmail, perfil: req.usuario?.perfil || 'API', ip,
    acao: 'NOTIFICAR_DEMISSAO', modulo: 'rh',
    entidade_tipo: 'funcionario', entidade_id: funcionario.id,
    resultado: 'SUCESSO',
    dados_depois: { cpf, contratos_cancelados: contratosAtivos.length }
  });

  return res.json({
    sucesso:              true,
    cpf,
    nome:                 funcionario.nome,
    situacao:             'INATIVO',
    contratos_cancelados: contratosAtivos.length,
    bancos_notificados:   bancosNotificados.length,
    cancelados:           contratosAtivos.map(c => ({
      codigo: c.codigo_averbacao, tipo: c.tipo,
      valor: c.valor_parcela, banco: c.banco_nome
    }))
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/rh/relatorio-margem
//    Relatório consolidado de margem por convênio
// ─────────────────────────────────────────────────────────────────────────────
router.get('/relatorio-margem', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { convenio_id } = req.query;

  let whereClause = '';
  const params = [];
  if (convenio_id) { whereClause = 'WHERE f.convenio_id = ?'; params.push(convenio_id); }

  const resumo = db.prepare(`
    SELECT
      c.nome as convenio,
      COUNT(DISTINCT f.id)         as total_funcionarios,
      SUM(f.salario_bruto)         as massa_salarial_bruta,
      SUM(f.salario_liquido)       as massa_salarial_liquida,
      COUNT(DISTINCT a.id)         as total_contratos,
      COALESCE(SUM(a.valor_parcela), 0) as total_comprometido,
      AVG(CASE WHEN f.salario_liquido > 0
          THEN a.valor_parcela / f.salario_liquido * 100 END) as percentual_medio_comprometido
    FROM funcionarios f
    JOIN convenios c ON c.id = f.convenio_id
    LEFT JOIN averbacoes a ON a.funcionario_id = f.id AND a.status = 'ATIVO'
    ${whereClause}
    GROUP BY c.id, c.nome
    ORDER BY total_comprometido DESC
  `).all(...params);

  const topFuncionarios = db.prepare(`
    SELECT
      f.nome, f.cpf, f.cargo,
      c.nome as convenio,
      COALESCE(SUM(a.valor_parcela), 0) as total_comprometido,
      f.salario_liquido,
      ROUND(COALESCE(SUM(a.valor_parcela), 0) / NULLIF(f.salario_liquido, 0) * 100, 2) as pct_comprometido
    FROM funcionarios f
    JOIN convenios c ON c.id = f.convenio_id
    LEFT JOIN averbacoes a ON a.funcionario_id = f.id AND a.status = 'ATIVO'
    ${whereClause}
    GROUP BY f.id
    ORDER BY pct_comprometido DESC
    LIMIT 10
  `).all(...params);

  return res.json({
    gerado_em:   new Date().toISOString(),
    resumo_por_convenio: resumo,
    top_comprometidos:   topFuncionarios
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /api/rh/reservas
//    Lista reservas/averbações para validação RH (por convênio)
//    Query: convenio_id?, status?, page, limit
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reservas', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { convenio_id, status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // RH só vê seu convênio, admin vê todos
  const convId = (req.usuario.perfil === 'RH' && req.usuario.convenio_id)
    ? req.usuario.convenio_id
    : (convenio_id || null);

  let where = `a.status IN ('RESERVADA','PENDENTE','APROVADA')`;
  const params = [];

  if (convId) { where += ` AND a.convenio_id = ?`; params.push(convId); }
  if (status) { where += ` AND a.status = ?`; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) as t FROM averbacoes a WHERE ${where}`).get(...params).t;

  const rows = db.prepare(`
    SELECT
      a.id, a.codigo_averbacao, a.tipo, a.status,
      a.valor_parcela, a.prazo_meses, a.valor_total,
      a.competencia_inicio, a.criado_em, a.numero_contrato_banco,
      f.nome AS funcionario_nome, f.cpf, f.matricula,
      b.nome AS banco_nome,
      c.nome AS convenio_nome
    FROM averbacoes a
    JOIN funcionarios f ON f.id = a.funcionario_id
    JOIN bancos       b ON b.id = a.banco_id
    JOIN convenios    c ON c.id = a.convenio_id
    WHERE ${where}
    ORDER BY a.criado_em DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. POST /api/rh/reservas/:id/aprovar
//    RH aprova uma reserva/averbação (status RESERVADA → APROVADA)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reservas/:id/aprovar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { id } = req.params;
  const { observacoes } = req.body;
  const ip = obterIP(req);

  const averb = db.prepare(`SELECT a.*, c.nome as convenio_nome FROM averbacoes a JOIN convenios c ON c.id=a.convenio_id WHERE a.id = ?`).get(id);
  if (!averb) return res.status(404).json({ erro: 'Averbação não encontrada' });

  // Verificar se RH tem acesso ao convênio
  if (req.usuario.perfil === 'RH' && req.usuario.convenio_id && averb.convenio_id !== req.usuario.convenio_id) {
    return res.status(403).json({ erro: 'Acesso negado: convênio diferente' });
  }

  if (!['RESERVADA', 'PENDENTE'].includes(averb.status)) {
    return res.status(400).json({ erro: `Averbação com status ${averb.status} não pode ser aprovada` });
  }

  db.prepare(`
    UPDATE averbacoes SET
      status = 'APROVADA',
      aprovado_por = ?,
      data_aprovacao = datetime('now'),
      observacoes = COALESCE(?, observacoes),
      atualizado_em = datetime('now')
    WHERE id = ?
  `).run(req.usuario.email, observacoes || null, id);

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email,
    perfil: req.usuario.perfil, ip,
    acao: 'APROVAR_RESERVA_RH', modulo: 'rh',
    entidade_tipo: 'averbacao', entidade_id: id,
    resultado: 'SUCESSO',
    dados_depois: { status: 'APROVADA', aprovado_por: req.usuario.email }
  });

  dispararWebhook(averb.convenio_id, averb.banco_id, 'averbacao.aprovada_rh', {
    codigo: averb.codigo_averbacao,
    funcionario_cpf: averb.cpf,
    aprovado_por: req.usuario.email
  });

  res.json({ sucesso: true, mensagem: 'Averbação aprovada pelo RH', codigo: averb.codigo_averbacao });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. POST /api/rh/reservas/:id/cancelar
//    RH cancela uma reserva/averbação
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reservas/:id/cancelar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;
  const ip = obterIP(req);

  const averb = db.prepare(`SELECT * FROM averbacoes WHERE id = ?`).get(id);
  if (!averb) return res.status(404).json({ erro: 'Averbação não encontrada' });

  if (req.usuario.perfil === 'RH' && req.usuario.convenio_id && averb.convenio_id !== req.usuario.convenio_id) {
    return res.status(403).json({ erro: 'Acesso negado: convênio diferente' });
  }

  if (averb.status === 'CANCELADA') {
    return res.status(400).json({ erro: 'Averbação já cancelada' });
  }

  db.prepare(`
    UPDATE averbacoes SET
      status = 'CANCELADA',
      motivo_cancelamento = ?,
      atualizado_em = datetime('now')
    WHERE id = ?
  `).run(motivo || `Cancelado pelo RH em ${new Date().toISOString().slice(0,10)}`, id);

  // Devolver margem
  try {
    const campo = averb.tipo === 'CARTAO' ? 'margem_usada_cartao'
                : averb.tipo === 'BENEFICIO' ? 'margem_usada_beneficio'
                : 'margem_usada_emprestimo';
    const campoDisp = averb.tipo === 'CARTAO' ? 'margem_disponivel_cartao'
                    : averb.tipo === 'BENEFICIO' ? 'margem_disponivel_beneficio'
                    : 'margem_disponivel_emprestimo';
    db.prepare(`
      UPDATE margens SET
        ${campo} = MAX(0, ${campo} - ?),
        ${campoDisp} = ${campoDisp} + ?,
        atualizado_em = datetime('now')
      WHERE funcionario_id = ?
      ORDER BY criado_em DESC LIMIT 1
    `).run(averb.valor_parcela, averb.valor_parcela, averb.funcionario_id);
  } catch(_) {}

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email,
    perfil: req.usuario.perfil, ip,
    acao: 'CANCELAR_RESERVA_RH', modulo: 'rh',
    entidade_tipo: 'averbacao', entidade_id: id, resultado: 'SUCESSO'
  });

  res.json({ sucesso: true, mensagem: 'Averbação cancelada pelo RH', codigo: averb.codigo_averbacao });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. GET /api/rh/resumo-descontos
//    Resumo consolidado de descontos por banco e tipo (para o painel RH)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/resumo-descontos', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { convenio_id, competencia } = req.query;
  const convId = (req.usuario.perfil === 'RH' && req.usuario.convenio_id)
    ? req.usuario.convenio_id
    : (convenio_id || null);
  const comp = competencia || competenciaAtual();

  let where = `a.status IN ('APROVADA','RESERVADA')`;
  const params = [];
  if (convId) { where += ` AND a.convenio_id = ?`; params.push(convId); }

  const porBanco = db.prepare(`
    SELECT
      b.nome AS banco_nome, b.codigo_bacen,
      COUNT(*) AS total_contratos,
      SUM(a.valor_parcela) AS total_desconto,
      SUM(CASE WHEN a.tipo='EMPRESTIMO' THEN a.valor_parcela ELSE 0 END) AS emprestimo,
      SUM(CASE WHEN a.tipo='CARTAO'     THEN a.valor_parcela ELSE 0 END) AS cartao,
      SUM(CASE WHEN a.tipo='BENEFICIO'  THEN a.valor_parcela ELSE 0 END) AS beneficio
    FROM averbacoes a
    JOIN bancos b ON b.id = a.banco_id
    WHERE ${where}
    GROUP BY b.id, b.nome, b.codigo_bacen
    ORDER BY total_desconto DESC
  `).all(...params);

  const porTipo = db.prepare(`
    SELECT tipo, COUNT(*) AS total, SUM(valor_parcela) AS valor
    FROM averbacoes a
    WHERE ${where}
    GROUP BY tipo
  `).all(...params);

  const totais = db.prepare(`
    SELECT
      COUNT(*) AS total_contratos,
      COUNT(DISTINCT a.funcionario_id) AS total_funcionarios,
      SUM(a.valor_parcela) AS total_desconto
    FROM averbacoes a
    WHERE ${where}
  `).get(...params);

  res.json({
    competencia: comp,
    totais,
    por_banco: porBanco,
    por_tipo: porTipo,
    gerado_em: new Date().toISOString()
  });
});

// ─── Helper: recalcular margem após mudança de salário ───────────────────────
function atualizarMargens(funcionarioId, salarioBruto, salarioLiquido, convenio) {
  try {
    const base = salarioLiquido > 0 ? salarioLiquido : salarioBruto;
    const comp  = competenciaAtual();
    const existente = db.prepare(`
      SELECT id FROM margens WHERE funcionario_id = ? AND competencia = ?
    `).get(funcionarioId, comp);

    const pEmp  = (convenio.percentual_emprestimo  || 35) / 100;
    const pCart = (convenio.percentual_cartao       || 5)  / 100;
    const pBen  = (convenio.percentual_beneficio    || 5)  / 100;
    const limEmp  = parseFloat((base * pEmp ).toFixed(2));
    const limCart = parseFloat((base * pCart).toFixed(2));
    const limBen  = parseFloat((base * pBen ).toFixed(2));

    // Calcular quanto já está comprometido
    const usado = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='EMPRESTIMO' THEN valor_parcela ELSE 0 END),0) AS emp,
        COALESCE(SUM(CASE WHEN tipo='CARTAO'     THEN valor_parcela ELSE 0 END),0) AS cart,
        COALESCE(SUM(CASE WHEN tipo='BENEFICIO'  THEN valor_parcela ELSE 0 END),0) AS ben
      FROM averbacoes
      WHERE funcionario_id = ? AND status IN ('APROVADA','RESERVADA')
    `).get(funcionarioId);

    if (existente) {
      db.prepare(`
        UPDATE margens SET
          salario_bruto = ?, salario_liquido = ?,
          margem_total_emprestimo = ?, margem_total_cartao = ?, margem_total_beneficio = ?,
          margem_usada_emprestimo = ?, margem_usada_cartao = ?, margem_usada_beneficio = ?,
          margem_disponivel_emprestimo = ?, margem_disponivel_cartao = ?, margem_disponivel_beneficio = ?,
          atualizado_em = datetime('now')
        WHERE id = ?
      `).run(
        salarioBruto, base,
        limEmp, limCart, limBen,
        usado.emp, usado.cart, usado.ben,
        Math.max(0, limEmp - usado.emp), Math.max(0, limCart - usado.cart), Math.max(0, limBen - usado.ben),
        existente.id
      );
    } else {
      db.prepare(`
        INSERT INTO margens
          (id, funcionario_id, convenio_id, competencia,
           salario_bruto, salario_liquido,
           margem_total_emprestimo, margem_total_cartao, margem_total_beneficio,
           margem_usada_emprestimo, margem_usada_cartao, margem_usada_beneficio,
           margem_disponivel_emprestimo, margem_disponivel_cartao, margem_disponivel_beneficio,
           criado_em, atualizado_em)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                datetime('now'), datetime('now'))
      `).run(
        funcionarioId, convenio.id, comp,
        salarioBruto, base,
        limEmp, limCart, limBen,
        usado.emp, usado.cart, usado.ben,
        Math.max(0, limEmp - usado.emp), Math.max(0, limCart - usado.cart), Math.max(0, limBen - usado.ben)
      );
    }
  } catch (e) { console.error('atualizarMargens:', e.message); }
}

// ─── ALIAS: GET /api/rh/historico-sincronizacoes → mesma lógica de /sincronizacoes ──────
router.get('/historico-sincronizacoes', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { convenio_id, limit = 50 } = req.query;
  let query = `
    SELECT s.*, c.nome as convenio_nome
    FROM sincronizacoes_folha s
    JOIN convenios c ON c.id = s.convenio_id
  `;
  const params = [];
  if (convenio_id) { query += ` WHERE s.convenio_id = ?`; params.push(convenio_id); }
  query += ` ORDER BY s.criado_em DESC LIMIT ?`;
  params.push(parseInt(limit));
  res.json(db.prepare(query).all(...params));
});

module.exports = router;
