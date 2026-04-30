/**
 * Integração eSocial — AverbaTech
 * Gerencia envio de eventos S-2200, S-2205, S-2299 (admissão, alteração, desligamento)
 */
const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { obterIP } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');

const router = express.Router();

// ─── Helper: gerar XML simplificado do eSocial ───────────────────────────────
function gerarXMLeSocial(evento, dados, ambiente = 'PRODUCAO') {
  const ts = new Date().toISOString();
  const ambCod = ambiente === 'HOMOLOGACAO' ? '2' : '1';
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/${evento}/v_S_01_01_00"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <evtTabRubrica Id="ID_${crypto.randomBytes(6).toString('hex').toUpperCase()}">
    <ideEvento>
      <indRetif>1</indRetif>
      <tpAmb>${ambCod}</tpAmb>
      <appCod>AVERBA_TECH</appCod>
      <verAplic>2.0</verAplic>
    </ideEvento>
    <ideEmpregador>
      <tpInsc>1</tpInsc>
      <nrInsc>${(dados.cnpj || '').replace(/\D/g,'')}</nrInsc>
    </ideEmpregador>
    <ideVinculo>
      <cpfTrab>${(dados.cpf || '').replace(/\D/g,'')}</cpfTrab>
      <matricula>${dados.matricula || ''}</matricula>
    </ideVinculo>
    <infoEvento>
      <dtAlteracao>${ts.slice(0,10)}</dtAlteracao>
      <novoSalario>${(dados.salario_bruto || 0).toFixed(2)}</novoSalario>
      <codMotivoDesligamento>${dados.motivo_desligamento || ''}</codMotivoDesligamento>
      <dtDesligamento>${dados.data_desligamento || ''}</dtDesligamento>
    </infoEvento>
  </evtTabRubrica>
</eSocial>`;
}

// ─── Helper: simular resposta do eSocial ─────────────────────────────────────
function simularEnvioeSocial(xml) {
  // Em produção real, aqui seria o webservice do eSocial (SOAP/REST)
  const sucesso = Math.random() > 0.05; // 95% taxa de sucesso simulada
  const recibo = `REQ-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  return {
    sucesso,
    numero_recibo: sucesso ? recibo : null,
    codigo_erro: !sucesso ? 'EST001' : null,
    mensagem: sucesso ? 'Evento processado com sucesso' : 'Erro no processamento do evento',
    data_processamento: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/esocial/dashboard — Dashboard de eventos
// ─────────────────────────────────────────────────────────────────────────────
router.get('/dashboard', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { convenio_id } = req.query;
  let where = '1=1';
  const params = [];
  if (convenio_id) { where += ' AND ee.convenio_id = ?'; params.push(convenio_id); }

  const totais = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='PROCESSADO' THEN 1 ELSE 0 END) as processados,
      SUM(CASE WHEN status='PENDENTE' THEN 1 ELSE 0 END) as pendentes,
      SUM(CASE WHEN status='ERRO' OR status='REJEITADO' THEN 1 ELSE 0 END) as erros,
      SUM(CASE WHEN status='ENVIADO' THEN 1 ELSE 0 END) as enviados
    FROM esocial_eventos ee
    WHERE ${where}
  `).get(...params);

  const ultimos = db.prepare(`
    SELECT ee.*, c.nome as convenio_nome, f.nome as funcionario_nome
    FROM esocial_eventos ee
    LEFT JOIN convenios c ON c.id = ee.convenio_id
    LEFT JOIN funcionarios f ON f.id = ee.funcionario_id
    WHERE ${where}
    ORDER BY ee.criado_em DESC LIMIT 20
  `).all(...params);

  const porTipo = db.prepare(`
    SELECT tipo_evento, COUNT(*) as total,
      SUM(CASE WHEN status='PROCESSADO' THEN 1 ELSE 0 END) as processados
    FROM esocial_eventos ee
    WHERE ${where}
    GROUP BY tipo_evento
    ORDER BY total DESC
  `).all(...params);

  res.json({ totais, ultimos, por_tipo: porTipo });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/esocial/eventos — Listar eventos
// ─────────────────────────────────────────────────────────────────────────────
router.get('/eventos', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const { convenio_id, status, tipo_evento, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = '1=1';
  const params = [];

  if (req.usuario.perfil === 'RH' && req.usuario.convenio_id) {
    where += ' AND ee.convenio_id = ?'; params.push(req.usuario.convenio_id);
  } else if (convenio_id) { where += ' AND ee.convenio_id = ?'; params.push(convenio_id); }
  if (status) { where += ' AND ee.status = ?'; params.push(status); }
  if (tipo_evento) { where += ' AND ee.tipo_evento = ?'; params.push(tipo_evento); }

  const total = db.prepare(`SELECT COUNT(*) as t FROM esocial_eventos ee WHERE ${where}`).get(...params).t;
  const rows = db.prepare(`
    SELECT ee.*, c.nome as convenio_nome, f.nome as funcionario_nome, f.cpf as funcionario_cpf
    FROM esocial_eventos ee
    LEFT JOIN convenios c ON c.id = ee.convenio_id
    LEFT JOIN funcionarios f ON f.id = ee.funcionario_id
    WHERE ${where}
    ORDER BY ee.criado_em DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/esocial/enviar — Enviar evento individual
// ─────────────────────────────────────────────────────────────────────────────
router.post('/enviar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), async (req, res) => {
  const { convenio_id, funcionario_id, tipo_evento, ambiente = 'PRODUCAO', dados_extras } = req.body;
  const ip = obterIP(req);

  if (!convenio_id || !tipo_evento) {
    return res.status(400).json({ erro: 'convenio_id e tipo_evento são obrigatórios' });
  }

  const TIPOS_VALIDOS = ['S-2200', 'S-2205', 'S-2206', 'S-2230', 'S-2240', 'S-2299', 'S-2300'];
  if (!TIPOS_VALIDOS.includes(tipo_evento)) {
    return res.status(400).json({ erro: `Tipo de evento inválido. Use: ${TIPOS_VALIDOS.join(', ')}` });
  }

  const convenio = db.prepare('SELECT * FROM convenios WHERE id = ?').get(convenio_id);
  if (!convenio) return res.status(404).json({ erro: 'Convênio não encontrado' });

  let funcionario = null;
  let dadosXML = { cnpj: convenio.cnpj, ...(dados_extras || {}) };
  if (funcionario_id) {
    funcionario = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(funcionario_id);
    if (!funcionario) return res.status(404).json({ erro: 'Funcionário não encontrado' });
    dadosXML = { ...dadosXML, cpf: funcionario.cpf, matricula: funcionario.matricula, salario_bruto: funcionario.salario_bruto };
  }

  const xmlEnviado = gerarXMLeSocial(tipo_evento, dadosXML, ambiente);
  const retorno = simularEnvioeSocial(xmlEnviado);

  const eventoId = db.prepare(`
    INSERT INTO esocial_eventos
      (convenio_id, funcionario_id, tipo_evento, xml_enviado, numero_recibo, xml_retorno,
       status, data_envio, data_processamento, codigo_erro, mensagem_erro, ambiente)
    VALUES (?,?,?,?,?,?,?,datetime('now'),?,?,?,?)
    RETURNING id
  `).get(
    convenio_id, funcionario_id || null, tipo_evento, xmlEnviado,
    retorno.numero_recibo, JSON.stringify(retorno),
    retorno.sucesso ? 'PROCESSADO' : 'ERRO',
    retorno.sucesso ? new Date().toISOString() : null,
    retorno.codigo_erro, retorno.mensagem,
    ambiente
  );

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip,
    acao: 'ENVIAR_ESOCIAL', modulo: 'ESOCIAL',
    entidade_tipo: 'esocial_evento', entidade_id: eventoId.id,
    resultado: retorno.sucesso ? 'SUCESSO' : 'FALHA',
    dados_depois: { tipo_evento, convenio: convenio.nome, numero_recibo: retorno.numero_recibo }
  });

  res.status(retorno.sucesso ? 201 : 422).json({
    id: eventoId.id,
    sucesso: retorno.sucesso,
    tipo_evento,
    numero_recibo: retorno.numero_recibo,
    status: retorno.sucesso ? 'PROCESSADO' : 'ERRO',
    mensagem: retorno.mensagem,
    data_processamento: retorno.data_processamento,
    codigo_erro: retorno.codigo_erro
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/esocial/reenviar/:id — Reenviar evento com erro
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reenviar/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const evento = db.prepare('SELECT * FROM esocial_eventos WHERE id = ?').get(req.params.id);
  if (!evento) return res.status(404).json({ erro: 'Evento não encontrado' });
  if (evento.status === 'PROCESSADO') return res.status(422).json({ erro: 'Evento já processado com sucesso' });

  const retorno = simularEnvioeSocial(evento.xml_enviado);
  db.prepare(`
    UPDATE esocial_eventos SET
      status=?, numero_recibo=?, xml_retorno=?,
      data_envio=datetime('now'), data_processamento=?,
      codigo_erro=?, mensagem_erro=?, atualizado_em=datetime('now')
    WHERE id=?
  `).run(
    retorno.sucesso ? 'PROCESSADO' : 'ERRO',
    retorno.numero_recibo, JSON.stringify(retorno),
    retorno.sucesso ? new Date().toISOString() : null,
    retorno.codigo_erro, retorno.mensagem, req.params.id
  );

  res.json({ sucesso: retorno.sucesso, numero_recibo: retorno.numero_recibo, mensagem: retorno.mensagem });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/esocial/lote — Enviar lote de eventos para um convênio
// ─────────────────────────────────────────────────────────────────────────────
router.post('/lote', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), async (req, res) => {
  const { convenio_id, tipo_evento, ambiente = 'PRODUCAO' } = req.body;
  if (!convenio_id || !tipo_evento) {
    return res.status(400).json({ erro: 'convenio_id e tipo_evento são obrigatórios' });
  }

  const convenio = db.prepare('SELECT * FROM convenios WHERE id = ?').get(convenio_id);
  if (!convenio) return res.status(404).json({ erro: 'Convênio não encontrado' });

  // Buscar funcionários ativos para gerar eventos em lote
  const funcionarios = db.prepare('SELECT * FROM funcionarios WHERE convenio_id = ? AND situacao = ? LIMIT 100').all(convenio_id, 'ATIVO');
  if (!funcionarios.length) return res.status(404).json({ erro: 'Nenhum funcionário ativo neste convênio' });

  let processados = 0, erros = 0;
  for (const func of funcionarios) {
    const dadosXML = { cnpj: convenio.cnpj, cpf: func.cpf, matricula: func.matricula, salario_bruto: func.salario_bruto };
    const xml = gerarXMLeSocial(tipo_evento, dadosXML, ambiente);
    const retorno = simularEnvioeSocial(xml);
    db.prepare(`
      INSERT INTO esocial_eventos (convenio_id, funcionario_id, tipo_evento, xml_enviado, numero_recibo, status, data_envio, ambiente)
      VALUES (?,?,?,?,?,?,datetime('now'),?)
    `).run(convenio_id, func.id, tipo_evento, xml, retorno.numero_recibo, retorno.sucesso ? 'PROCESSADO' : 'ERRO', ambiente);
    retorno.sucesso ? processados++ : erros++;
  }

  res.json({ total: funcionarios.length, processados, erros, tipo_evento, convenio: convenio.nome });
});

module.exports = router;
