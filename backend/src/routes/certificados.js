const express = require('express');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { obterIP } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');
const {
  emitirCertificado,
  assinarOperacao,
  verificarAssinatura,
  revogarCertificado
} = require('../services/certificacaoDigital');

const router = express.Router();

// GET /api/certificados - Listar certificados do usuário ou todos (admin)
router.get('/', autenticar, (req, res) => {
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(req.usuario.perfil);
  const certs = isAdmin
    ? db.prepare(`
        SELECT c.*, u.nome as usuario_nome, u.email as usuario_email
        FROM certificados_digitais c
        LEFT JOIN usuarios u ON u.id = c.usuario_id
        ORDER BY c.criado_em DESC
      `).all()
    : db.prepare(`
        SELECT * FROM certificados_digitais WHERE usuario_id = ? ORDER BY criado_em DESC
      `).all(req.usuario.id);

  res.json(certs.map(c => ({ ...c, certificado_pem: undefined })));
});

// POST /api/certificados/emitir - Emitir novo certificado
router.post('/emitir', autenticar, async (req, res) => {
  const { tipo, titular_nome, titular_cpf_cnpj, validade_dias } = req.body;
  const ip = obterIP(req);

  if (!tipo || !titular_nome || !titular_cpf_cnpj) {
    return res.status(400).json({ erro: 'tipo, titular_nome e titular_cpf_cnpj são obrigatórios' });
  }
  if (!['eCPF', 'eCNPJ', 'SSL', 'TIMESTAMP'].includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo inválido. Use: eCPF, eCNPJ, SSL, TIMESTAMP' });
  }

  // Verificar se já tem certificado ativo do mesmo tipo
  const existente = db.prepare(`
    SELECT id FROM certificados_digitais
    WHERE usuario_id = ? AND tipo = ? AND status = 'ATIVO' AND valido_ate > datetime('now')
  `).get(req.usuario.id, tipo);

  if (existente) {
    return res.status(409).json({
      erro: `Já existe um certificado ${tipo} ativo para este usuário`,
      certificado_id: existente.id
    });
  }

  try {
    const resultado = await emitirCertificado({
      usuarioId: req.usuario.id,
      tipo,
      titularNome: titular_nome,
      titularCpfCnpj: titular_cpf_cnpj,
      validadeDias: parseInt(validade_dias) || 365
    });

    registrarLog({
      usuario_id: req.usuario.id, usuario_email: req.usuario.email,
      perfil: req.usuario.perfil, ip,
      acao: 'EMITIR_CERTIFICADO', modulo: 'CERTIFICADOS',
      entidade_tipo: 'certificado', entidade_id: resultado.id,
      dados_depois: { tipo, titular_nome, numero_serie: resultado.numeroSerie },
      resultado: 'SUCESSO'
    });

    res.status(201).json({
      id: resultado.id,
      numero_serie: resultado.numeroSerie,
      impressao_digital: resultado.fingerprint,
      valido_de: resultado.validoDe,
      valido_ate: resultado.validoAte,
      tipo,
      // ATENÇÃO PRODUÇÃO: remover private_key — aqui apenas para demonstração
      private_key_demo: resultado.privateKeyPem,
      cert_pem: resultado.certPem,
      aviso: 'DEMO: Em produção a chave privada fica exclusivamente no token HSM/Smart Card do titular',
      mensagem: `Certificado ${tipo} emitido com sucesso!`
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao emitir certificado', detalhe: err.message });
  }
});

// POST /api/certificados/assinar - Assinar operação digitalmente
router.post('/assinar', autenticar, async (req, res) => {
  const { operacao_tipo, operacao_id, certificado_id, private_key_pem, dados_operacao } = req.body;
  const ip = obterIP(req);

  if (!operacao_tipo || !operacao_id || !certificado_id || !private_key_pem) {
    return res.status(400).json({ erro: 'operacao_tipo, operacao_id, certificado_id e private_key_pem são obrigatórios' });
  }

  const cert = db.prepare(`
    SELECT * FROM certificados_digitais
    WHERE id = ? AND usuario_id = ? AND status = 'ATIVO'
  `).get(certificado_id, req.usuario.id);

  if (!cert) {
    return res.status(404).json({ erro: 'Certificado não encontrado, inativo ou não pertence ao usuário' });
  }
  if (new Date(cert.valido_ate) < new Date()) {
    return res.status(422).json({ erro: 'Certificado expirado em ' + cert.valido_ate });
  }

  try {
    const assinatura = assinarOperacao({
      operacaoTipo: operacao_tipo,
      operacaoId: operacao_id,
      usuarioId: req.usuario.id,
      certificadoId: cert.id,
      dadosOperacao: dados_operacao || {},
      privateKeyPem: private_key_pem,
      ip
    });

    registrarLog({
      usuario_id: req.usuario.id, usuario_email: req.usuario.email,
      perfil: req.usuario.perfil, ip,
      acao: 'ASSINAR_OPERACAO', modulo: 'CERTIFICADOS',
      entidade_tipo: operacao_tipo, entidade_id: operacao_id,
      dados_depois: { assinatura_id: assinatura.id, hash: assinatura.hashDocumento },
      resultado: 'SUCESSO'
    });

    res.json({
      id: assinatura.id,
      hash_documento: assinatura.hashDocumento,
      assinatura_base64: assinatura.assinatura,
      algoritmo: 'SHA256withRSA',
      timestamp_servidor: assinatura.timestampServidor,
      certificado: { id: cert.id, numero_serie: cert.numero_serie, titular: cert.titular_nome, tipo: cert.tipo },
      mensagem: 'Operação assinada digitalmente com sucesso. Assinatura tem validade jurídica.'
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao assinar', detalhe: err.message });
  }
});

// GET /api/certificados/verificar/:id - Verificar validade de assinatura
router.get('/verificar/:id', autenticar, (req, res) => {
  const resultado = verificarAssinatura(req.params.id);
  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email,
    perfil: req.usuario.perfil, ip: obterIP(req),
    acao: 'VERIFICAR_ASSINATURA', modulo: 'CERTIFICADOS',
    entidade_tipo: 'assinatura', entidade_id: req.params.id,
    resultado: resultado.valida ? 'SUCESSO' : 'FALHA',
    detalhe: resultado.motivo
  });
  res.json(resultado);
});

// GET /api/certificados/assinaturas - Listar assinaturas
router.get('/assinaturas', autenticar, (req, res) => {
  const { operacao_tipo, operacao_id } = req.query;
  let where = '1=1';
  const params = [];
  if (operacao_tipo) { where += ' AND a.operacao_tipo = ?'; params.push(operacao_tipo); }
  if (operacao_id) { where += ' AND a.operacao_id = ?'; params.push(operacao_id); }

  const assinaturas = db.prepare(`
    SELECT a.id, a.operacao_tipo, a.operacao_id, a.algoritmo,
           a.hash_documento, a.timestamp_servidor, a.valida, a.ip, a.criado_em,
           c.tipo as cert_tipo, c.titular_nome, c.numero_serie,
           u.nome as usuario_nome, u.email as usuario_email
    FROM assinaturas_digitais a
    LEFT JOIN certificados_digitais c ON c.id = a.certificado_id
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    WHERE ${where}
    ORDER BY a.criado_em DESC LIMIT 100
  `).all(...params);

  res.json(assinaturas);
});

// PATCH /api/certificados/:id/revogar - Revogar certificado
router.patch('/:id/revogar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { motivo } = req.body;
  if (!motivo) return res.status(400).json({ erro: 'Motivo de revogação obrigatório' });
  try {
    revogarCertificado(req.params.id, motivo);
    registrarLog({
      usuario_id: req.usuario.id, usuario_email: req.usuario.email,
      perfil: req.usuario.perfil, ip: obterIP(req),
      acao: 'REVOGAR_CERTIFICADO', modulo: 'CERTIFICADOS',
      entidade_tipo: 'certificado', entidade_id: req.params.id,
      dados_depois: { motivo }, resultado: 'SUCESSO'
    });
    res.json({ mensagem: 'Certificado revogado e adicionado à CRL' });
  } catch (err) {
    res.status(404).json({ erro: err.message });
  }
});

// GET /api/certificados/crl - Lista de certificados revogados (CRL pública)
router.get('/crl', (req, res) => {
  const crl = db.prepare('SELECT * FROM crl_revogados ORDER BY revogado_em DESC').all();
  res.json({ total: crl.length, revogados: crl, gerado_em: new Date().toISOString() });
});

module.exports = router;
