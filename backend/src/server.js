require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { initializeDatabase } = require('./database');
const { seedDatabase } = require('./seed');

// ── Rotas existentes ──────────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const conveniosRoutes   = require('./routes/convenios');
const bancosRoutes      = require('./routes/bancos');
const funcionariosRoutes= require('./routes/funcionarios');
const averba_coesRoutes = require('./routes/averbacoes');
const auditoriaRoutes   = require('./routes/auditoria');
const dashboardRoutes   = require('./routes/dashboard');
const usuariosRoutes    = require('./routes/usuarios');
const certificadosRoutes= require('./routes/certificados');
const importacoesRoutes = require('./routes/importacoes');
const iso27001Routes    = require('./routes/iso27001');
const faturamentoRoutes = require('./routes/faturamento');

// ── Novas rotas bancárias ────────────────────────────────────────────────────
const bankApiRoutes       = require('./routes/bankApi');
const rhApiRoutes         = require('./routes/rhApi');
const oauth2AdminRoutes   = require('./routes/oauth2Admin');
const bancoConveniosRoutes= require('./routes/bancoConvenios');
const esocialRoutes       = require('./routes/esocial');
const portabilidadeRoutes = require('./routes/portabilidade');
const { router: webhookRoutes, processarFilaPendente } = require('./services/webhookService');
const segurosRoutes       = require('./routes/seguros');
const cartaoRoutes        = require('./routes/cartao');
const onboardingRoutes    = require('./routes/onboarding');
const payrollRoutes       = require('./routes/payroll');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Trust proxy (Railway / Cloudflare) ───────────────────────────────────────
app.set('trust proxy', 1);

// ── Segurança ─────────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));

// ── CORS manual — força headers mesmo atrás do proxy do sandbox ───────────────
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const limiter      = rateLimit({ windowMs: 15*60*1000, max: 500,  message: { erro: 'Muitas requisições.' } });
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 20,   message: { erro: 'Muitas tentativas.' } });
const bankLimiter  = rateLimit({ windowMs:  1*60*1000, max: 120,  message: { error: 'Rate limit exceeded.' },
  keyGenerator: (req) => req.headers.authorization || req.ip });
const oauthLimiter = rateLimit({ windowMs:  5*60*1000, max: 30,   message: { error: 'Too many token requests.' } });

app.use(limiter);
app.use('/api/auth/login',  loginLimiter);
app.use('/v1/oauth/token',  oauthLimiter);
app.use('/v1/',             bankLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// ── Rotas da Aplicação (JWT) ──────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/convenios',   conveniosRoutes);
app.use('/api/bancos',      bancosRoutes);
app.use('/api/funcionarios',funcionariosRoutes);
app.use('/api/averbacoes',  averba_coesRoutes);
app.use('/api/auditoria',   auditoriaRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/usuarios',    usuariosRoutes);
app.use('/api/certificados',certificadosRoutes);
app.use('/api/importacoes', importacoesRoutes);
app.use('/api/iso27001',    iso27001Routes);
app.use('/api/faturamento', faturamentoRoutes);

// ── Rotas Bancárias (OAuth2) ──────────────────────────────────────────────────
app.use('/v1',                   bankApiRoutes);        // Bank-Side API
app.use('/api/rh',               rhApiRoutes);          // RH-Side API
app.use('/api/oauth2',           oauth2AdminRoutes);    // Gestão de clients
app.use('/api/webhooks',         webhookRoutes);        // Webhooks admin
app.use('/api/banco-convenios',  bancoConveniosRoutes); // Credenciamento Banco×Convênio
app.use('/api/esocial',          esocialRoutes);        // eSocial
app.use('/api/portabilidade',    portabilidadeRoutes);  // Portabilidade
app.use('/api/seguros',          segurosRoutes);         // Seguros Facultativos
app.use('/api/cartao',           cartaoRoutes);          // Cartão Consignado (RMC/RCC)
app.use('/api/onboarding',       onboardingRoutes);      // Onboarding Digital (RH/Banco/Func)
app.use('/api/payroll',          payrollRoutes);         // Motor de Folha (Escrow/Split/Pix)

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'online',
    sistema:   'AverbaTech - Plataforma de Consignado Inteligente',
    versao:    '2.0.0',
    timestamp: new Date().toISOString(),
    apis: {
      admin:  '/api/*  (JWT)',
      banco:  '/v1/*   (OAuth2 client_credentials)',
      rh:     '/api/rh/* (JWT ou OAuth2)',
      docs:   '/api/docs'
    }
  });
});

// ── Documentação rápida ───────────────────────────────────────────────────────
app.get('/api/docs', (req, res) => {
  res.json({
    title:   'AverbaTech API v2.0',
    versao:  '2.0.0',
    autenticacao: {
      admin: 'POST /api/auth/login → { email, senha } → Bearer JWT',
      banco: 'POST /v1/oauth/token → { grant_type, client_id, client_secret } → Bearer token'
    },
    endpoints: {
      'Bank-Side (OAuth2)': {
        'POST /v1/oauth/token':           'Obter access token',
        'POST /v1/margem/consultar':      'Consultar margem disponível (CPF)',
        'POST /v1/reserva':               'Reservar margem (bloquear 30min)',
        'GET  /v1/reserva/:id':           'Status da reserva',
        'POST /v1/averbar':               'Efetivar averbação + gerar bilhete',
        'POST /v1/cancelar':              'Cancelar/quitar averbação',
        'GET  /v1/bilhete/:numero':       'Consultar bilhete de averbação',
        'GET  /v1/extrato/:cpf':          'Extrato completo de contratos'
      },
      'RH-Side': {
        'POST /api/rh/sincronizar':       'Sincronizar folha de pagamento',
        'GET  /api/rh/exportar-descontos':'Exportar descontos (JSON/CSV/CNAB240/TXT)',
        'GET  /api/rh/sincronizacoes':    'Histórico de sincronizações',
        'POST /api/rh/notificar-demissao':'Notificar demissão (cancela contratos)',
        'GET  /api/rh/relatorio-margem':  'Relatório de margem por convênio'
      },
      'OAuth2 Admin': {
        'GET  /api/oauth2/clients':       'Listar clientes',
        'POST /api/oauth2/clients':       'Criar novo client (banco)',
        'PUT  /api/oauth2/clients/:id':   'Atualizar/revogar client',
        'POST /api/oauth2/clients/:id/rotacionar-secret': 'Rotacionar secret',
        'GET  /api/oauth2/stats':         'Estatísticas de uso'
      },
      'Webhooks': {
        'GET  /api/webhooks':             'Listar webhooks',
        'POST /api/webhooks':             'Criar webhook',
        'POST /api/webhooks/:id/testar':  'Testar conectividade',
        'GET  /api/webhooks/:id/logs':    'Histórico de disparos',
        'GET  /api/webhooks/stats/resumo':'Estatísticas'
      }
    }
  });
});

// ── Servir Frontend Estático ──────────────────────────────────────────────────
const path = require('path');
const fs   = require('fs');
const FRONTEND = path.resolve(__dirname, '../../frontend/public');

if (fs.existsSync(FRONTEND)) {
  // Servir arquivos estáticos (CSS, JS, imagens) com cache normal
  app.use(express.static(FRONTEND, {
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        // HTML nunca em cache — sempre servir versão mais recente
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
  // SPA fallback — sempre sem cache
  const noCache = (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };
  app.get('/dashboard', (req, res) => {
    noCache(res);
    res.sendFile(path.join(FRONTEND, 'dashboard.html'));
  });
  app.get('/dashboard/', (req, res) => {
    noCache(res);
    res.sendFile(path.join(FRONTEND, 'dashboard', 'index.html'));
  });
  app.get('/dashboard/index.html', (req, res) => {
    noCache(res);
    res.sendFile(path.join(FRONTEND, 'dashboard', 'index.html'));
  });
  app.get('/dashboard.html', (req, res) => {
    noCache(res);
    res.sendFile(path.join(FRONTEND, 'dashboard.html'));
  });
  app.get('/', (req, res) => {
    noCache(res);
    res.sendFile(path.join(FRONTEND, 'index.html'));
  });
}

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({
    erro:    'Erro interno do servidor',
    detalhe: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ── Inicializar ───────────────────────────────────────────────────────────────
initializeDatabase();
seedDatabase();

// Processar webhooks pendentes na inicialização
setTimeout(() => processarFilaPendente().catch(() => {}), 5000);
// Reprocessar a cada 5 minutos
setInterval(() => processarFilaPendente().catch(() => {}), 5 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 AverbaTech API v2.0 rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Banco de dados: SQLite (WAL mode)`);
  console.log(`🏦 Bank-Side API: /v1/* (OAuth2 client_credentials)`);
  console.log(`👥 RH-Side API:   /api/rh/* (JWT ou OAuth2)`);
  console.log(`📡 Webhooks:      /api/webhooks/*`);
  console.log(`📖 Documentação:  /api/docs\n`);
  console.log(`👤 Login: admin@averba.tech / Admin@2024\n`);
});

module.exports = app;
