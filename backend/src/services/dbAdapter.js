/**
 * MÓDULO 3: ADAPTADOR POSTGRESQL
 * Suporte dual: SQLite (desenvolvimento) ↔ PostgreSQL (produção)
 * 
 * Em produção: configurar variáveis PG_* no .env
 * Migration automática: tabelas criadas no primeiro start
 */

const { db: sqliteDb } = require('../database');
require('dotenv').config();

let pgPool = null;
const USE_PG = process.env.DATABASE_URL || (process.env.PG_HOST && process.env.PG_HOST !== 'localhost');

// ─────────────────────────────────────────────
// Inicializar conexão PostgreSQL se configurado
// ─────────────────────────────────────────────
async function initPostgres() {
  if (!USE_PG) {
    console.log('📦 Banco: SQLite (desenvolvimento)');
    return false;
  }
  try {
    const { Pool } = require('pg');
    pgPool = new Pool(process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
      : {
          host: process.env.PG_HOST,
          port: parseInt(process.env.PG_PORT) || 5432,
          database: process.env.PG_DATABASE,
          user: process.env.PG_USER,
          password: process.env.PG_PASSWORD,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000
        }
    );
    await pgPool.query('SELECT 1');
    console.log('🐘 Banco: PostgreSQL conectado');
    await criarTabelasPG();
    return true;
  } catch (err) {
    console.error('⚠️  PostgreSQL indisponível, usando SQLite:', err.message);
    pgPool = null;
    return false;
  }
}

// ─────────────────────────────────────────────
// DDL PostgreSQL (equivalente ao SQLite do database.js)
// Diferenças: UUID nativo, SERIAL, TEXT[] para arrays
// ─────────────────────────────────────────────
async function criarTabelasPG() {
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        perfil TEXT NOT NULL CHECK(perfil IN ('SUPER_ADMIN','ADMIN','RH','BANCO','FUNCIONARIO')),
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        convenio_id UUID,
        banco_id UUID,
        ultimo_login TIMESTAMPTZ,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS convenios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        cnpj TEXT UNIQUE NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('PUBLICO','PRIVADO','MILITAR')),
        sistema_folha TEXT DEFAULT 'MANUAL',
        percentual_emprestimo NUMERIC(5,2) NOT NULL DEFAULT 35.0,
        percentual_cartao NUMERIC(5,2) NOT NULL DEFAULT 5.0,
        percentual_beneficio NUMERIC(5,2) NOT NULL DEFAULT 5.0,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        responsavel TEXT,
        telefone TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bancos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        codigo_bacen TEXT UNIQUE NOT NULL,
        cnpj TEXT UNIQUE NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        taxa_averbacao NUMERIC(10,2) NOT NULL DEFAULT 15.00,
        contato_responsavel TEXT,
        email_operacional TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS funcionarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        matricula TEXT NOT NULL,
        nome TEXT NOT NULL,
        cpf TEXT UNIQUE NOT NULL,
        data_nascimento DATE,
        convenio_id UUID NOT NULL,
        cargo TEXT,
        lotacao TEXT,
        salario_bruto NUMERIC(12,2) NOT NULL DEFAULT 0,
        salario_liquido NUMERIC(12,2) NOT NULL DEFAULT 0,
        data_admissao DATE,
        situacao TEXT NOT NULL DEFAULT 'ATIVO' CHECK(situacao IN ('ATIVO','INATIVO','AFASTADO','APOSENTADO')),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(matricula, convenio_id)
      );

      CREATE TABLE IF NOT EXISTS margens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        funcionario_id UUID NOT NULL,
        convenio_id UUID NOT NULL,
        competencia CHAR(7) NOT NULL,
        salario_bruto NUMERIC(12,2) NOT NULL DEFAULT 0,
        salario_liquido NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_total_emprestimo NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_total_cartao NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_total_beneficio NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_usada_emprestimo NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_usada_cartao NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_usada_beneficio NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_disponivel_emprestimo NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_disponivel_cartao NUMERIC(12,2) NOT NULL DEFAULT 0,
        margem_disponivel_beneficio NUMERIC(12,2) NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(funcionario_id, competencia)
      );

      CREATE TABLE IF NOT EXISTS averbacoes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo_averbacao TEXT UNIQUE NOT NULL,
        funcionario_id UUID NOT NULL,
        convenio_id UUID NOT NULL,
        banco_id UUID NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('EMPRESTIMO','CARTAO','BENEFICIO','REFINANCIAMENTO')),
        status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','RESERVADA','APROVADA','CANCELADA','EXPIRADA')),
        valor_parcela NUMERIC(12,2) NOT NULL,
        prazo_meses INTEGER NOT NULL DEFAULT 1,
        valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        taxa_juros NUMERIC(6,4) DEFAULT 0,
        competencia_inicio CHAR(7) NOT NULL,
        competencia_fim CHAR(7),
        numero_contrato_banco TEXT,
        solicitado_por UUID,
        aprovado_por UUID,
        data_aprovacao TIMESTAMPTZ,
        motivo_cancelamento TEXT,
        observacoes TEXT,
        taxa_averbacao_cobrada NUMERIC(10,2) DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS logs_auditoria (
        id BIGSERIAL PRIMARY KEY,
        usuario_id UUID,
        usuario_email TEXT,
        perfil TEXT,
        ip INET,
        acao TEXT NOT NULL,
        modulo TEXT NOT NULL,
        entidade_tipo TEXT,
        entidade_id TEXT,
        dados_antes JSONB,
        dados_depois JSONB,
        resultado TEXT NOT NULL DEFAULT 'SUCESSO' CHECK(resultado IN ('SUCESSO','FALHA','TENTATIVA')),
        detalhe TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Índices para performance máxima
      CREATE INDEX IF NOT EXISTS idx_averbacoes_funcionario ON averbacoes(funcionario_id);
      CREATE INDEX IF NOT EXISTS idx_averbacoes_banco ON averbacoes(banco_id);
      CREATE INDEX IF NOT EXISTS idx_averbacoes_status ON averbacoes(status);
      CREATE INDEX IF NOT EXISTS idx_averbacoes_codigo ON averbacoes(codigo_averbacao);
      CREATE INDEX IF NOT EXISTS idx_averbacoes_competencia ON averbacoes(competencia_inicio);
      CREATE INDEX IF NOT EXISTS idx_funcionarios_cpf ON funcionarios(cpf);
      CREATE INDEX IF NOT EXISTS idx_margens_funcionario ON margens(funcionario_id);
      CREATE INDEX IF NOT EXISTS idx_logs_criado ON logs_auditoria(criado_em DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_usuario ON logs_auditoria(usuario_id);
    `);
    console.log('✅ Tabelas PostgreSQL verificadas/criadas');
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────
// Adapter: executa query no banco correto
// ─────────────────────────────────────────────
async function query(sql, params = []) {
  if (pgPool) {
    const res = await pgPool.query(sql, params);
    return res.rows;
  }
  // SQLite — converter $1, $2 para ?, ?
  const sqliteSQL = sql.replace(/\$(\d+)/g, '?');
  return sqliteDb.prepare(sqliteSQL).all(...params);
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function execute(sql, params = []) {
  if (pgPool) {
    const res = await pgPool.query(sql, params);
    return { changes: res.rowCount, lastID: null };
  }
  const sqliteSQL = sql.replace(/\$(\d+)/g, '?');
  const stmt = sqliteDb.prepare(sqliteSQL);
  const info = stmt.run(...params);
  return { changes: info.changes, lastID: info.lastInsertRowid };
}

// ─────────────────────────────────────────────
// Informações do banco atual
// ─────────────────────────────────────────────
async function getDbInfo() {
  if (pgPool) {
    const res = await pgPool.query('SELECT version(), current_database(), pg_size_pretty(pg_database_size(current_database())) as tamanho');
    return { tipo: 'PostgreSQL', ...res.rows[0] };
  }
  const stats = sqliteDb.prepare('SELECT COUNT(*) as total FROM sqlite_master WHERE type="table"').get();
  return {
    tipo: 'SQLite',
    version: 'SQLite 3 (WAL mode)',
    current_database: 'database.sqlite',
    tamanho: 'local',
    tabelas: stats.total
  };
}

module.exports = { initPostgres, query, queryOne, execute, getDbInfo, getPool: () => pgPool };
