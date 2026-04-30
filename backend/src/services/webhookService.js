/**
 * Serviço de Webhooks — AverbaTech
 * Dispara notificações HTTP em tempo real com retry automático
 * Eventos: margem.reservada, averbacao.efetivada, averbacao.cancelada,
 *          funcionario.demitido, folha.sincronizada, margem.atualizada
 */

const http  = require('http');
const https = require('https');
const crypto = require('crypto');
const { db } = require('../database');

// ── Assinar payload com HMAC-SHA256 ──────────────────────────────────────────
function assinarPayload(secret, payload) {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex');
}

// ── Enviar HTTP request (sem axios) ──────────────────────────────────────────
function enviarHTTP(url, payload, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body  = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      },
      timeout: timeoutMs || 10000
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end',  ()    => resolve({ status: res.statusCode, body: data.slice(0, 500) }));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error',   (e) => reject(e));
    req.write(body);
    req.end();
  });
}

// ── Disparar webhook (enqueue + try imediato) ─────────────────────────────────
async function dispararWebhook(convenioId, bancoId, evento, dados) {
  // Buscar webhooks configurados para este evento
  const webhooks = db.prepare(`
    SELECT * FROM webhooks_config
    WHERE ativo = 1
      AND (convenio_id = ? OR banco_id = ? OR (convenio_id IS NULL AND banco_id IS NULL))
      AND (eventos = '*' OR eventos LIKE ?)
  `).all(convenioId || null, bancoId || null, `%${evento}%`);

  if (!webhooks.length) return;

  for (const wh of webhooks) {
    const payload = {
      evento,
      timestamp: new Date().toISOString(),
      dados,
      webhook_id: wh.id
    };

    const assinatura = assinarPayload(wh.secret, payload);

    // Enqueue no banco
    const logId = db.prepare(`
      INSERT INTO webhooks_log
        (id, webhook_id, evento, payload, status, tentativa, proxima_tentativa, criado_em)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, 'PENDENTE', 1, datetime('now'), datetime('now'))
      RETURNING id
    `).get(wh.id, evento, JSON.stringify(payload));

    // Tentar envio imediato (assíncrono, não bloqueia)
    tentarEnvio(logId.id, wh, payload, assinatura, 1).catch(() => {});
  }
}

// ── Tentar envio com retry exponencial ───────────────────────────────────────
async function tentarEnvio(logId, webhook, payload, assinatura, tentativa) {
  try {
    const resultado = await enviarHTTP(
      webhook.url,
      payload,
      {
        'X-AverbaTech-Signature': assinatura,
        'X-AverbaTech-Event':     payload.evento,
        'X-AverbaTech-Delivery':  logId,
        'User-Agent':            'AverbaTech-Webhook/1.0'
      },
      webhook.timeout_ms || 10000
    );

    const sucesso = resultado.status >= 200 && resultado.status < 300;

    if (sucesso) {
      db.prepare(`
        UPDATE webhooks_log
        SET status = 'ENVIADO', http_status = ?, resposta = ?, enviado_em = datetime('now')
        WHERE id = ?
      `).run(resultado.status, resultado.body, logId);

      db.prepare(`
        UPDATE webhooks_config
        SET ultimo_sucesso = datetime('now'), total_enviados = total_enviados + 1
        WHERE id = ?
      `).run(webhook.id);
    } else {
      agendarRetry(logId, webhook, payload, assinatura, tentativa, `HTTP ${resultado.status}`);
      db.prepare(`
        UPDATE webhooks_config SET ultimo_erro = datetime('now'), total_falhas = total_falhas + 1
        WHERE id = ?
      `).run(webhook.id);
    }
  } catch (err) {
    agendarRetry(logId, webhook, payload, assinatura, tentativa, err.message);
    db.prepare(`
      UPDATE webhooks_config SET ultimo_erro = datetime('now'), total_falhas = total_falhas + 1
      WHERE id = ?
    `).run(webhook.id);
  }
}

// ── Agendar retry com backoff exponencial ────────────────────────────────────
function agendarRetry(logId, webhook, payload, assinatura, tentativa, erro) {
  const maxTentativas = webhook.tentativas_max || 5;

  if (tentativa >= maxTentativas) {
    db.prepare(`
      UPDATE webhooks_log SET status = 'EXPIRADO', erro = ?, tentativa = ? WHERE id = ?
    `).run(`Max tentativas atingido. Último erro: ${erro}`, tentativa, logId);
    return;
  }

  // Backoff: 1min, 5min, 15min, 1h, 6h
  const delays = [60, 300, 900, 3600, 21600];
  const delaySegundos = delays[tentativa - 1] || 3600;
  const proximaTentativa = new Date(Date.now() + delaySegundos * 1000).toISOString();

  db.prepare(`
    UPDATE webhooks_log
    SET status = 'FALHA', erro = ?, tentativa = ?, proxima_tentativa = ?
    WHERE id = ?
  `).run(erro, tentativa, proximaTentativa, logId);

  // Agendar próxima tentativa
  setTimeout(() => {
    const log = db.prepare(`SELECT * FROM webhooks_log WHERE id = ?`).get(logId);
    if (log && log.status === 'FALHA') {
      tentarEnvio(logId, webhook, payload, assinatura, tentativa + 1).catch(() => {});
    }
  }, delaySegundos * 1000);
}

// ── Processar fila de pendentes (na inicialização) ────────────────────────────
async function processarFilaPendente() {
  const pendentes = db.prepare(`
    SELECT wl.*, wc.url, wc.secret, wc.timeout_ms, wc.tentativas_max
    FROM webhooks_log wl
    JOIN webhooks_config wc ON wc.id = wl.webhook_id
    WHERE wl.status IN ('PENDENTE','FALHA')
      AND wl.proxima_tentativa <= datetime('now')
    LIMIT 50
  `).all();

  for (const item of pendentes) {
    const payload = JSON.parse(item.payload);
    const assinatura = assinarPayload(item.secret, payload);
    await tentarEnvio(item.id, item, payload, assinatura, item.tentativa).catch(() => {});
  }

  if (pendentes.length > 0) {
    console.log(`📡 Webhooks: ${pendentes.length} itens processados da fila`);
  }
}

// ── API de gerenciamento (admin) ──────────────────────────────────────────────
const express = require('express');
const { autenticar, autorizar } = require('../middleware/auth');
const router = express.Router();

// Listar webhooks configurados
router.get('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const webhooks = db.prepare(`
    SELECT wc.*, b.nome as banco_nome, c.nome as convenio_nome
    FROM webhooks_config wc
    LEFT JOIN bancos b ON b.id = wc.banco_id
    LEFT JOIN convenios c ON c.id = wc.convenio_id
    ORDER BY wc.criado_em DESC
  `).all();
  res.json(webhooks.map(w => ({ ...w, secret: '***' })));
});

// Criar webhook
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { banco_id, convenio_id, url, eventos, tentativas_max, timeout_ms } = req.body;
  if (!url || !eventos) {
    return res.status(400).json({ erro: 'url e eventos são obrigatórios' });
  }
  try { new URL(url); } catch { return res.status(400).json({ erro: 'URL inválida' }); }

  const secret = crypto.randomBytes(32).toString('hex');
  const wh = db.prepare(`
    INSERT INTO webhooks_config
      (id, banco_id, convenio_id, url, eventos, secret, tentativas_max, timeout_ms, criado_em)
    VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    RETURNING *
  `).get(banco_id || null, convenio_id || null, url, eventos, secret,
    tentativas_max || 5, timeout_ms || 10000);

  res.status(201).json({ ...wh, secret });
});

// Deletar webhook
router.delete('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  db.prepare(`UPDATE webhooks_config SET ativo = 0 WHERE id = ?`).run(req.params.id);
  res.json({ sucesso: true });
});

// Histórico de disparos
router.get('/:id/logs', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM webhooks_log WHERE webhook_id = ?
    ORDER BY criado_em DESC LIMIT 100
  `).all(req.params.id);
  res.json(logs);
});

// Teste de webhook
router.post('/:id/testar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), async (req, res) => {
  const wh = db.prepare(`SELECT * FROM webhooks_config WHERE id = ?`).get(req.params.id);
  if (!wh) return res.status(404).json({ erro: 'Webhook não encontrado' });

  const payload = {
    evento: 'webhook.teste',
    timestamp: new Date().toISOString(),
    dados: { mensagem: 'Teste de conectividade AverbaTech', sistema: 'AverbaTech v1.0' }
  };
  const assinatura = assinarPayload(wh.secret, payload);

  try {
    const r = await enviarHTTP(wh.url, payload, {
      'X-AverbaTech-Signature': assinatura,
      'X-AverbaTech-Event': 'webhook.teste'
    }, 8000);
    res.json({ sucesso: r.status >= 200 && r.status < 300, http_status: r.status, resposta: r.body });
  } catch (e) {
    res.json({ sucesso: false, erro: e.message });
  }
});

// Estatísticas
router.get('/stats/resumo', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_webhooks,
      SUM(CASE WHEN ativo = 1 THEN 1 ELSE 0 END) as ativos,
      SUM(total_enviados) as total_enviados,
      SUM(total_falhas) as total_falhas
    FROM webhooks_config
  `).get();
  const fila = db.prepare(`
    SELECT status, COUNT(*) as qtd FROM webhooks_log
    WHERE criado_em >= datetime('now', '-24 hours')
    GROUP BY status
  `).all();
  res.json({ webhooks: stats, fila_24h: fila });
});

module.exports = { router, dispararWebhook, processarFilaPendente };
