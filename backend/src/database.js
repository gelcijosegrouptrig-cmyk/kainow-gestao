const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './database.sqlite';
const db = new Database(path.resolve(DB_PATH));

// Habilitar WAL para melhor performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  db.exec(`
    -- ===================================================
    -- TABELA: usuarios (Admins, Operadores, Bancos, RH)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      perfil TEXT NOT NULL CHECK(perfil IN ('SUPER_ADMIN','ADMIN','RH','BANCO','FUNCIONARIO')),
      ativo INTEGER NOT NULL DEFAULT 1,
      convenio_id TEXT,
      banco_id TEXT,
      ultimo_login TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: convenios (Prefeituras, Empresas, Órgãos)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS convenios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      cnpj TEXT UNIQUE NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('PUBLICO','PRIVADO','MILITAR')),
      sistema_folha TEXT DEFAULT 'MANUAL',
      percentual_emprestimo REAL NOT NULL DEFAULT 35.0,
      percentual_cartao REAL NOT NULL DEFAULT 5.0,
      percentual_beneficio REAL NOT NULL DEFAULT 5.0,
      ativo INTEGER NOT NULL DEFAULT 1,
      responsavel TEXT,
      telefone TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: bancos (Instituições Financeiras parceiras)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS bancos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      codigo_bacen TEXT UNIQUE NOT NULL,
      cnpj TEXT UNIQUE NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      taxa_averbacao REAL NOT NULL DEFAULT 15.00,
      contato_responsavel TEXT,
      email_operacional TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: funcionarios (Servidores / Empregados)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS funcionarios (
      id TEXT PRIMARY KEY,
      matricula TEXT NOT NULL,
      nome TEXT NOT NULL,
      cpf TEXT UNIQUE NOT NULL,
      data_nascimento TEXT,
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      cargo TEXT,
      lotacao TEXT,
      salario_bruto REAL NOT NULL DEFAULT 0,
      salario_liquido REAL NOT NULL DEFAULT 0,
      data_admissao TEXT,
      situacao TEXT NOT NULL DEFAULT 'ATIVO' CHECK(situacao IN ('ATIVO','INATIVO','AFASTADO','APOSENTADO')),
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(matricula, convenio_id)
    );

    -- ===================================================
    -- TABELA: margens (Controle de Margem por Funcionário)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS margens (
      id TEXT PRIMARY KEY,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      competencia TEXT NOT NULL,
      salario_bruto REAL NOT NULL DEFAULT 0,
      salario_liquido REAL NOT NULL DEFAULT 0,
      margem_total_emprestimo REAL NOT NULL DEFAULT 0,
      margem_total_cartao REAL NOT NULL DEFAULT 0,
      margem_total_beneficio REAL NOT NULL DEFAULT 0,
      margem_usada_emprestimo REAL NOT NULL DEFAULT 0,
      margem_usada_cartao REAL NOT NULL DEFAULT 0,
      margem_usada_beneficio REAL NOT NULL DEFAULT 0,
      margem_disponivel_emprestimo REAL NOT NULL DEFAULT 0,
      margem_disponivel_cartao REAL NOT NULL DEFAULT 0,
      margem_disponivel_beneficio REAL NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(funcionario_id, competencia)
    );

    -- ===================================================
    -- TABELA: averbacoes (Contratos / Reservas de Margem)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS averbacoes (
      id TEXT PRIMARY KEY,
      codigo_averbacao TEXT UNIQUE NOT NULL,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('EMPRESTIMO','CARTAO','BENEFICIO','REFINANCIAMENTO')),
      status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','RESERVADA','APROVADA','CANCELADA','EXPIRADA')),
      valor_parcela REAL NOT NULL,
      prazo_meses INTEGER NOT NULL DEFAULT 1,
      valor_total REAL NOT NULL DEFAULT 0,
      taxa_juros REAL DEFAULT 0,
      competencia_inicio TEXT NOT NULL,
      competencia_fim TEXT,
      numero_contrato_banco TEXT,
      solicitado_por TEXT,
      aprovado_por TEXT,
      data_aprovacao TEXT,
      motivo_cancelamento TEXT,
      observacoes TEXT,
      taxa_averbacao_cobrada REAL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: logs_auditoria (Rastreabilidade LGPD)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS logs_auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id TEXT,
      usuario_email TEXT,
      perfil TEXT,
      ip TEXT,
      acao TEXT NOT NULL,
      modulo TEXT NOT NULL,
      entidade_tipo TEXT,
      entidade_id TEXT,
      dados_antes TEXT,
      dados_depois TEXT,
      resultado TEXT NOT NULL DEFAULT 'SUCESSO' CHECK(resultado IN ('SUCESSO','FALHA','TENTATIVA')),
      detalhe TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: importacoes_folha (Histórico de importação)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS importacoes_folha (
      id TEXT PRIMARY KEY,
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      competencia TEXT NOT NULL,
      sistema_origem TEXT NOT NULL,
      nome_arquivo TEXT,
      total_registros INTEGER DEFAULT 0,
      processados INTEGER DEFAULT 0,
      erros INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PROCESSANDO' CHECK(status IN ('PROCESSANDO','CONCLUIDO','ERRO')),
      importado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- ÍNDICES para performance
    -- ===================================================
    CREATE INDEX IF NOT EXISTS idx_averbacoes_funcionario ON averbacoes(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_averbacoes_banco ON averbacoes(banco_id);
    CREATE INDEX IF NOT EXISTS idx_averbacoes_status ON averbacoes(status);
    CREATE INDEX IF NOT EXISTS idx_averbacoes_codigo ON averbacoes(codigo_averbacao);
    CREATE INDEX IF NOT EXISTS idx_funcionarios_cpf ON funcionarios(cpf);
    CREATE INDEX IF NOT EXISTS idx_funcionarios_convenio ON funcionarios(convenio_id);
    CREATE INDEX IF NOT EXISTS idx_margens_funcionario ON margens(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_logs_usuario ON logs_auditoria(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_logs_criado ON logs_auditoria(criado_em);
  `);

  console.log('✅ Banco de dados inicializado com sucesso');
}

module.exports = { db, initializeDatabase };
