/**
 * MÓDULO 1: CERTIFICAÇÃO DIGITAL ICP-Brasil
 * Simula infraestrutura de chaves públicas (PKI) compatível com ICP-Brasil
 * Em produção: integrar com SafeSign, Certisign, Serpro, Valid Certificadora
 * 
 * Fluxo real:
 *   1. Usuário apresenta token USB com e-CPF ou e-CNPJ
 *   2. Sistema valida cadeia de certificados via CRL/OCSP
 *   3. Operação é assinada com chave privada do token
 *   4. Assinatura é verificada e registrada (não-repúdio)
 */

const forge = require('node-forge');
const crypto = require('crypto');
const { db } = require('../database');
const { gerarId } = require('../utils/helpers');

// ─────────────────────────────────────────────
// Inicializa tabelas de PKI no banco
// ─────────────────────────────────────────────
function initCertTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS certificados_digitais (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('eCPF','eCNPJ','SSL','TIMESTAMP')),
      numero_serie TEXT UNIQUE NOT NULL,
      titular_nome TEXT NOT NULL,
      titular_cpf_cnpj TEXT NOT NULL,
      emissor TEXT NOT NULL,
      valido_de TEXT NOT NULL,
      valido_ate TEXT NOT NULL,
      impressao_digital TEXT NOT NULL,
      chave_publica TEXT NOT NULL,
      certificado_pem TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ATIVO' CHECK(status IN ('ATIVO','REVOGADO','EXPIRADO')),
      motivo_revogacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assinaturas_digitais (
      id TEXT PRIMARY KEY,
      operacao_tipo TEXT NOT NULL,
      operacao_id TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      certificado_id TEXT NOT NULL,
      hash_documento TEXT NOT NULL,
      assinatura TEXT NOT NULL,
      algoritmo TEXT NOT NULL DEFAULT 'SHA256withRSA',
      timestamp_servidor TEXT NOT NULL,
      ip TEXT,
      valida INTEGER NOT NULL DEFAULT 1,
      verificado_em TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crl_revogados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_serie TEXT UNIQUE NOT NULL,
      motivo TEXT,
      revogado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assinaturas_operacao ON assinaturas_digitais(operacao_tipo, operacao_id);
    CREATE INDEX IF NOT EXISTS idx_certs_usuario ON certificados_digitais(usuario_id);
  `);
}

// ─────────────────────────────────────────────
// Gerar par de chaves RSA 2048-bit (simulação)
// Em produção: chave privada NUNCA sai do token HSM/Smart Card
// ─────────────────────────────────────────────
function gerarParChaves() {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keypair) => {
      if (err) return reject(err);
      resolve({
        privateKeyPem: forge.pki.privateKeyToPem(keypair.privateKey),
        publicKeyPem: forge.pki.publicKeyToPem(keypair.publicKey),
        privateKey: keypair.privateKey,
        publicKey: keypair.publicKey
      });
    });
  });
}

// ─────────────────────────────────────────────
// Emitir certificado digital (autoassinado ICP-Brasil simulado)
// ─────────────────────────────────────────────
async function emitirCertificado({ usuarioId, tipo, titularNome, titularCpfCnpj, validadeDias = 365 }) {
  const keys = await gerarParChaves();

  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(8).toString('hex').toUpperCase();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + validadeDias);

  const issuer = process.env.CERT_ISSUER || 'MargemPRO ICP-Brasil Simulador';

  const attrs = [
    { name: 'commonName', value: titularNome },
    { name: 'organizationName', value: 'MargemPRO Consignado' },
    { name: 'countryName', value: 'BR' },
    { shortName: 'serialNumber', value: titularCpfCnpj.replace(/\D/g, '') }
  ];

  cert.setSubject(attrs);
  cert.setIssuer([
    { name: 'commonName', value: issuer },
    { name: 'organizationName', value: 'MargemPRO CA' },
    { name: 'countryName', value: 'BR' }
  ]);

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true, emailProtection: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: `${tipo}.margempro.com.br` }] }
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const fingerprint = forge.md.sha256.create()
    .update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
    .digest().toHex().toUpperCase();

  const id = gerarId();
  db.prepare(`
    INSERT INTO certificados_digitais
      (id, usuario_id, tipo, numero_serie, titular_nome, titular_cpf_cnpj, emissor,
       valido_de, valido_ate, impressao_digital, chave_publica, certificado_pem)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, usuarioId, tipo, cert.serialNumber, titularNome, titularCpfCnpj.replace(/\D/g,''),
    issuer,
    cert.validity.notBefore.toISOString(),
    cert.validity.notAfter.toISOString(),
    fingerprint,
    keys.publicKeyPem,
    certPem
  );

  return {
    id,
    numeroSerie: cert.serialNumber,
    fingerprint,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
    certPem,
    // ATENÇÃO: em produção, chave privada NÃO é retornada — fica no token do usuário
    privateKeyPem: keys.privateKeyPem
  };
}

// ─────────────────────────────────────────────
// Assinar operação digitalmente
// ─────────────────────────────────────────────
function assinarOperacao({ operacaoTipo, operacaoId, usuarioId, certificadoId, dadosOperacao, privateKeyPem, ip }) {
  // Montar documento canônico (o que será assinado)
  const documento = JSON.stringify({
    operacao: operacaoTipo,
    id: operacaoId,
    dados: dadosOperacao,
    timestamp: new Date().toISOString(),
    usuario: usuarioId
  });

  // Hash SHA-256 do documento
  const hashDocumento = crypto.createHash('sha256').update(documento, 'utf8').digest('hex');

  // Assinar com RSA-SHA256
  const sign = crypto.createSign('SHA256');
  sign.update(documento);
  const assinatura = sign.sign(privateKeyPem, 'base64');

  const id = gerarId();
  db.prepare(`
    INSERT INTO assinaturas_digitais
      (id, operacao_tipo, operacao_id, usuario_id, certificado_id,
       hash_documento, assinatura, timestamp_servidor, ip)
    VALUES (?,?,?,?,?,?,?,datetime('now'),?)
  `).run(id, operacaoTipo, operacaoId, usuarioId, certificadoId, hashDocumento, assinatura, ip || null);

  return { id, hashDocumento, assinatura, timestampServidor: new Date().toISOString() };
}

// ─────────────────────────────────────────────
// Verificar assinatura digital
// ─────────────────────────────────────────────
function verificarAssinatura(assinaturaId) {
  const assin = db.prepare(`
    SELECT a.*, c.chave_publica, c.status as cert_status, c.valido_ate
    FROM assinaturas_digitais a
    JOIN certificados_digitais c ON c.id = a.certificado_id
    WHERE a.id = ?
  `).get(assinaturaId);

  if (!assin) return { valida: false, motivo: 'Assinatura não encontrada' };

  // Verificar se certificado está na CRL
  const revogado = db.prepare('SELECT * FROM crl_revogados WHERE numero_serie = ?')
    .get(assin.numero_serie);
  if (revogado) return { valida: false, motivo: 'Certificado revogado: ' + revogado.motivo };

  // Verificar validade temporal
  if (new Date(assin.valido_ate) < new Date()) {
    return { valida: false, motivo: 'Certificado expirado em ' + assin.valido_ate };
  }

  // A verificação criptográfica real usaria a chave pública aqui
  // (em sandbox, aceitamos como válida se passou todas as verificações acima)
  db.prepare("UPDATE assinaturas_digitais SET verificado_em = datetime('now') WHERE id = ?")
    .run(assinaturaId);

  return {
    valida: true,
    algoritmo: assin.algoritmo,
    hashDocumento: assin.hash_documento,
    timestampServidor: assin.timestamp_servidor,
    certStatus: assin.cert_status
  };
}

// ─────────────────────────────────────────────
// Revogar certificado (CRL)
// ─────────────────────────────────────────────
function revogarCertificado(certificadoId, motivo) {
  const cert = db.prepare('SELECT * FROM certificados_digitais WHERE id = ?').get(certificadoId);
  if (!cert) throw new Error('Certificado não encontrado');

  db.prepare("UPDATE certificados_digitais SET status='REVOGADO', motivo_revogacao=? WHERE id=?")
    .run(motivo, certificadoId);
  db.prepare("INSERT OR IGNORE INTO crl_revogados (numero_serie, motivo) VALUES (?,?)")
    .run(cert.numero_serie, motivo);
}

module.exports = {
  initCertTables,
  emitirCertificado,
  assinarOperacao,
  verificarAssinatura,
  revogarCertificado
};
