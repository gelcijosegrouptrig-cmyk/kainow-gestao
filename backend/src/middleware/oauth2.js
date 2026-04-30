/**
 * Middleware OAuth2 Client Credentials
 * Autentica bancos e parceiros via access_token
 */
const crypto = require('crypto');
const { db } = require('../database');

// ── Gerar token seguro ────────────────────────────────────────────────────────
function gerarAccessToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

// ── POST /v1/oauth/token  (client_credentials) ────────────────────────────────
async function emitirToken(req, res) {
  const { client_id, client_secret, grant_type, scope } = req.body;

  if (grant_type !== 'client_credentials') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Apenas client_credentials é suportado'
    });
  }
  if (!client_id || !client_secret) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'client_id e client_secret são obrigatórios'
    });
  }

  const client = db.prepare(
    `SELECT oc.*, b.nome as banco_nome FROM oauth2_clients oc
     LEFT JOIN bancos b ON b.id = oc.banco_id
     WHERE oc.client_id = ? AND oc.ativo = 1`
  ).get(client_id);

  if (!client || client.client_secret_hash !== hashSecret(client_secret)) {
    // Registrar tentativa falha
    db.prepare(
      `INSERT INTO logs_auditoria (id, usuario_email, perfil, ip, acao, modulo, resultado, detalhe, criado_em)
       VALUES (NULL, ?, 'BANCO', ?, 'OAUTH2_FALHA', 'oauth2', 'FALHA', ?, datetime('now'))`
    ).run(client_id, req.ip, `client_id inválido ou secret incorreto`);

    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Credenciais inválidas'
    });
  }

  // Verificar IP whitelist
  if (client.ip_whitelist) {
    const ips = client.ip_whitelist.split(',').map(s => s.trim());
    const clientIP = req.ip.replace('::ffff:', '');
    if (!ips.includes(clientIP) && !ips.includes('*')) {
      return res.status(403).json({
        error: 'access_denied',
        error_description: `IP ${clientIP} não autorizado`
      });
    }
  }

  // Revogar tokens anteriores do cliente
  db.prepare(
    `UPDATE oauth2_tokens SET revogado = 1 WHERE client_id = ? AND revogado = 0`
  ).run(client.id);

  // Calcular escopo
  const escopoSolicitado = scope || client.escopo;
  const escoposPermitidos = client.escopo.split(' ');
  const escopoFinal = escopoSolicitado.split(' ')
    .filter(s => escoposPermitidos.includes(s))
    .join(' ') || client.escopo;

  const accessToken = gerarAccessToken();
  const expiresIn = 3600; // 1 hora
  const expiraEm = new Date(Date.now() + expiresIn * 1000).toISOString();

  db.prepare(
    `INSERT INTO oauth2_tokens (id, client_id, access_token, escopo, expira_em, ip_origem, criado_em)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, datetime('now'))`
  ).run(client.id, accessToken, escopoFinal, expiraEm, req.ip);

  // Atualizar estatísticas
  db.prepare(
    `UPDATE oauth2_clients SET ultimo_acesso = datetime('now'), total_requisicoes = total_requisicoes + 1 WHERE id = ?`
  ).run(client.id);

  // Log de sucesso
  db.prepare(
    `INSERT INTO logs_auditoria (id, usuario_email, perfil, ip, acao, modulo, resultado, detalhe, criado_em)
     VALUES (NULL, ?, 'BANCO', ?, 'OAUTH2_TOKEN', 'oauth2', 'SUCESSO', ?, datetime('now'))`
  ).run(client_id, req.ip, `Token emitido para ${client.banco_nome || client_id}`);

  return res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: escopoFinal,
    banco: client.banco_nome || client_id
  });
}

// ── Middleware: autenticar token Bearer ──────────────────────────────────────
function autenticarOAuth2(escopoRequerido) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Authorization Bearer token requerido'
      });
    }

    const token = authHeader.slice(7);
    const registro = db.prepare(
      `SELECT t.*, c.nome as client_nome, c.banco_id, b.nome as banco_nome, b.codigo_bacen
       FROM oauth2_tokens t
       JOIN oauth2_clients c ON c.id = t.client_id
       LEFT JOIN bancos b ON b.id = c.banco_id
       WHERE t.access_token = ? AND t.revogado = 0`
    ).get(token);

    if (!registro) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token inválido ou revogado'
      });
    }

    if (new Date(registro.expira_em) < new Date()) {
      db.prepare(`UPDATE oauth2_tokens SET revogado = 1 WHERE access_token = ?`).run(token);
      return res.status(401).json({
        error: 'token_expired',
        error_description: 'Token expirado. Solicite um novo via /v1/oauth/token'
      });
    }

    if (escopoRequerido) {
      const escopos = registro.escopo.split(' ');
      if (!escopos.includes(escopoRequerido)) {
        return res.status(403).json({
          error: 'insufficient_scope',
          error_description: `Escopo '${escopoRequerido}' requerido`
        });
      }
    }

    // Atualizar contador
    db.prepare(
      `UPDATE oauth2_clients SET total_requisicoes = total_requisicoes + 1, ultimo_acesso = datetime('now') WHERE id = ?`
    ).run(registro.client_id);

    req.oauth = {
      clientId: registro.client_id,  // UUID interno (PK de oauth2_clients)
      clientNome: registro.client_nome,
      bancoId: registro.banco_id,
      bancoNome: registro.banco_nome,
      codigoBacen: registro.codigo_bacen,
      escopo: registro.escopo
    };
    next();
  };
}

// ── Criar client (admin) ──────────────────────────────────────────────────────
function criarClient(nome, bancoId, escopos) {
  const clientId = `mpr_${crypto.randomBytes(12).toString('hex')}`;
  const clientSecret = crypto.randomBytes(32).toString('hex');

  // Normalizar escopos: aceita array ou string
  let escopoStr;
  if (Array.isArray(escopos)) {
    escopoStr = escopos.join(' ');
  } else if (typeof escopos === 'string' && escopos.trim()) {
    escopoStr = escopos.trim();
  } else {
    escopoStr = 'margem:consultar reserva:criar averbacao:efetivar averbacao:cancelar';
  }

  db.prepare(
    `INSERT INTO oauth2_clients (id, client_id, client_secret_hash, banco_id, nome, escopo, criado_em)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, datetime('now'))`
  ).run(clientId, hashSecret(clientSecret), bancoId || null, nome, escopoStr);

  return { client_id: clientId, client_secret: clientSecret };
}

module.exports = { emitirToken, autenticarOAuth2, criarClient, hashSecret };
