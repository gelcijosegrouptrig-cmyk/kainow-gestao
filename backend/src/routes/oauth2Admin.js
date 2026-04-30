/**
 * Gestão de Clientes OAuth2 (Admin)
 * Cria/revoga credenciais para bancos parceiros
 */

const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../database');
const { autenticar, autorizar } = require('../middleware/auth');
const { criarClient, hashSecret } = require('../middleware/oauth2');
const { registrarLog } = require('../utils/auditoria');
const { obterIP }      = require('../utils/helpers');

const router = express.Router();

// GET /api/oauth2/clients — listar todos
router.get('/clients', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const clients = db.prepare(`
    SELECT oc.id, oc.client_id, oc.nome, oc.escopo, oc.ativo,
           oc.ip_whitelist, oc.ultimo_acesso, oc.total_requisicoes, oc.criado_em,
           b.nome as banco_nome, b.codigo_bacen
    FROM oauth2_clients oc
    LEFT JOIN bancos b ON b.id = oc.banco_id
    ORDER BY oc.criado_em DESC
  `).all();
  res.json(clients);
});

// POST /api/oauth2/clients — criar novo client para banco
router.post('/clients', autenticar, autorizar('SUPER_ADMIN'), (req, res) => {
  const ip = obterIP(req);
  const { banco_id, nome, escopos, ip_whitelist } = req.body;

  if (!nome) {
    return res.status(400).json({ erro: 'nome é obrigatório' });
  }

  // Verificar banco
  if (banco_id) {
    const banco = db.prepare(`SELECT id FROM bancos WHERE id = ?`).get(banco_id);
    if (!banco) return res.status(404).json({ erro: 'Banco não encontrado' });
  }

  const { client_id, client_secret } = criarClient(nome, banco_id, escopos);

  // Salvar IP whitelist se informado
  if (ip_whitelist) {
    db.prepare(`UPDATE oauth2_clients SET ip_whitelist = ? WHERE client_id = ?`)
      .run(ip_whitelist, client_id);
  }

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email,
    perfil: req.usuario.perfil, ip,
    acao: 'CRIAR_OAUTH_CLIENT', modulo: 'oauth2',
    entidade_tipo: 'oauth2_client', entidade_id: client_id,
    resultado: 'SUCESSO',
    dados_depois: { nome, banco_id, client_id }
  });

  return res.status(201).json({
    aviso: '⚠️ GUARDE o client_secret agora! Ele NÃO será exibido novamente.',
    client_id,
    client_secret,
    nome,
    escopos: escopos || 'margem:consultar reserva:criar averbacao:efetivar averbacao:cancelar',
    grant_type: 'client_credentials',
    token_url: '/v1/oauth/token',
    instrucoes: {
      passo1: `POST /v1/oauth/token`,
      body: { grant_type: 'client_credentials', client_id, client_secret: '***' },
      passo2: `Use o access_token retornado no header: Authorization: Bearer <token>`
    }
  });
});

// PUT /api/oauth2/clients/:id — atualizar (ativar/desativar, IP whitelist)
router.put('/clients/:id', autenticar, autorizar('SUPER_ADMIN'), (req, res) => {
  const ip = obterIP(req);
  const { ativo, ip_whitelist, escopos } = req.body;

  const client = db.prepare(`SELECT * FROM oauth2_clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ erro: 'Client não encontrado' });

  db.prepare(`
    UPDATE oauth2_clients SET
      ativo         = COALESCE(?, ativo),
      ip_whitelist  = COALESCE(?, ip_whitelist),
      escopo        = COALESCE(?, escopo),
      atualizado_em = datetime('now')
    WHERE id = ?
  `).run(
    ativo != null ? (ativo ? 1 : 0) : null,
    ip_whitelist || null,
    escopos || null,
    req.params.id
  );

  if (ativo === false) {
    // Revogar todos os tokens ativos
    db.prepare(`UPDATE oauth2_tokens SET revogado = 1 WHERE client_id = ?`).run(req.params.id);
  }

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email,
    perfil: req.usuario.perfil, ip,
    acao: ativo === false ? 'REVOGAR_OAUTH_CLIENT' : 'ATUALIZAR_OAUTH_CLIENT',
    modulo: 'oauth2', resultado: 'SUCESSO',
    dados_depois: { id: req.params.id, ativo, ip_whitelist }
  });

  res.json({ sucesso: true, mensagem: ativo === false ? 'Client revogado' : 'Client atualizado' });
});

// DELETE /api/oauth2/clients/:id — revogar permanentemente
router.delete('/clients/:id', autenticar, autorizar('SUPER_ADMIN'), (req, res) => {
  const ip = obterIP(req);
  db.prepare(`UPDATE oauth2_clients SET ativo = 0, atualizado_em = datetime('now') WHERE id = ?`)
    .run(req.params.id);
  db.prepare(`UPDATE oauth2_tokens SET revogado = 1 WHERE client_id = ?`).run(req.params.id);

  registrarLog({
    usuario_id: req.usuario.id, usuario_email: req.usuario.email,
    perfil: req.usuario.perfil, ip,
    acao: 'DELETAR_OAUTH_CLIENT', modulo: 'oauth2', resultado: 'SUCESSO',
    dados_depois: { id: req.params.id }
  });
  res.json({ sucesso: true });
});

// POST /api/oauth2/clients/:id/rotacionar-secret — gerar novo secret
router.post('/clients/:id/rotacionar-secret', autenticar, autorizar('SUPER_ADMIN'), (req, res) => {
  const client = db.prepare(`SELECT * FROM oauth2_clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ erro: 'Client não encontrado' });

  const novoSecret = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    UPDATE oauth2_clients SET client_secret_hash = ?, atualizado_em = datetime('now') WHERE id = ?
  `).run(hashSecret(novoSecret), req.params.id);

  // Revogar todos os tokens anteriores
  db.prepare(`UPDATE oauth2_tokens SET revogado = 1 WHERE client_id = ?`).run(req.params.id);

  res.json({
    aviso: '⚠️ GUARDE o novo client_secret! O anterior foi invalidado.',
    client_id:     client.client_id,
    client_secret: novoSecret
  });
});

// GET /api/oauth2/clients/:id/tokens — tokens ativos
router.get('/clients/:id/tokens', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const tokens = db.prepare(`
    SELECT id, token_type, escopo, expira_em, ip_origem, criado_em,
           CASE WHEN revogado = 1 THEN 'REVOGADO'
                WHEN expira_em < datetime('now') THEN 'EXPIRADO'
                ELSE 'ATIVO' END as status
    FROM oauth2_tokens
    WHERE client_id = ?
    ORDER BY criado_em DESC LIMIT 20
  `).all(req.params.id);
  res.json(tokens);
});

// GET /api/oauth2/stats — estatísticas gerais
router.get('/stats', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_clients,
      SUM(CASE WHEN ativo = 1 THEN 1 ELSE 0 END) as ativos,
      SUM(total_requisicoes) as total_requisicoes,
      MAX(ultimo_acesso) as ultimo_acesso
    FROM oauth2_clients
  `).get();

  const tokensAtivos = db.prepare(`
    SELECT COUNT(*) as count FROM oauth2_tokens
    WHERE revogado = 0 AND expira_em > datetime('now')
  `).get();

  const acessos24h = db.prepare(`
    SELECT COUNT(*) as count FROM logs_auditoria
    WHERE modulo = 'bank_api' AND criado_em >= datetime('now', '-24 hours')
  `).get();

  res.json({
    clients: stats,
    tokens_ativos: tokensAtivos.count,
    acessos_24h:   acessos24h.count
  });
});

module.exports = router;
