require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { initializeDatabase } = require('./database');
const { seedDatabase } = require('./seed');

// Routes
const authRoutes = require('./routes/auth');
const conveniosRoutes = require('./routes/convenios');
const bancosRoutes = require('./routes/bancos');
const funcionariosRoutes = require('./routes/funcionarios');
const averba_coesRoutes = require('./routes/averbacoes');
const auditoriaRoutes = require('./routes/auditoria');
const dashboardRoutes = require('./routes/dashboard');
const usuariosRoutes = require('./routes/usuarios');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: false }));

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { erro: 'Muitas requisições.' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { erro: 'Muitas tentativas de login.' } });
app.use(limiter);
app.use('/api/auth/login', loginLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

app.use('/api/auth', authRoutes);
app.use('/api/convenios', conveniosRoutes);
app.use('/api/bancos', bancosRoutes);
app.use('/api/funcionarios', funcionariosRoutes);
app.use('/api/averbacoes', averba_coesRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/usuarios', usuariosRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    sistema: 'MargemPRO - Sistema de Gestão de Margem Consignável',
    versao: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ erro: 'Erro interno do servidor', detalhe: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

initializeDatabase();
seedDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 MargemPRO API rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV}`);
  console.log(`✅ Banco de dados: SQLite (WAL mode)\n`);
  console.log(`👤 Login: admin@margempro.com.br / Admin@2024\n`);
});

module.exports = app;
