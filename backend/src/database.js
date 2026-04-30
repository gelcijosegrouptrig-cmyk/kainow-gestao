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
      situacao TEXT NOT NULL DEFAULT 'ATIVO' CHECK(situacao IN ('ATIVO','INATIVO','AFASTADO','APOSENTADO','DEMITIDO','LICENCIADO')),
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
    -- TABELA: certificados_digitais (e-CPF / e-CNPJ)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS certificados_digitais (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      usuario_id TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('eCPF','eCNPJ','SSL','TIMESTAMP')),
      titular_nome TEXT NOT NULL,
      titular_cpf_cnpj TEXT NOT NULL,
      serial_number TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'ATIVO' CHECK(status IN ('ATIVO','REVOGADO','EXPIRADO')),
      valido_desde TEXT NOT NULL DEFAULT (datetime('now')),
      valido_ate TEXT NOT NULL,
      certificado_pem TEXT,
      chave_privada_enc TEXT,
      algoritmo TEXT DEFAULT 'RSA-2048',
      motivo_revogacao TEXT,
      revogado_em TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );

    -- ===================================================
    -- TABELA: itens_importacao_folha (linhas do arquivo)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS itens_importacao_folha (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      importacao_id TEXT NOT NULL,
      cpf TEXT,
      matricula TEXT,
      nome TEXT,
      salario_bruto REAL,
      salario_liquido REAL,
      situacao TEXT,
      cargo TEXT,
      lotacao TEXT,
      linha_original TEXT,
      status_processamento TEXT DEFAULT 'PENDENTE',
      erro_processamento TEXT,
      funcionario_id TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (importacao_id) REFERENCES importacoes_folha(id)
    );

    -- ===================================================
    -- TABELA: oauth2_clients (Credenciais dos Bancos)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS oauth2_clients (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      client_id TEXT NOT NULL UNIQUE,
      client_secret_hash TEXT NOT NULL,
      banco_id TEXT REFERENCES bancos(id),
      nome TEXT NOT NULL,
      escopo TEXT NOT NULL DEFAULT 'margem:consultar reserva:criar averbacao:efetivar',
      ativo INTEGER NOT NULL DEFAULT 1,
      ip_whitelist TEXT,
      ultimo_acesso TEXT,
      total_requisicoes INTEGER DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: oauth2_tokens (Tokens ativos dos Bancos)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS oauth2_tokens (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      client_id TEXT NOT NULL REFERENCES oauth2_clients(id),
      access_token TEXT NOT NULL UNIQUE,
      token_type TEXT NOT NULL DEFAULT 'Bearer',
      escopo TEXT NOT NULL,
      expira_em TEXT NOT NULL,
      revogado INTEGER DEFAULT 0,
      ip_origem TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: reservas_margem (Bloqueios Temporários)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS reservas_margem (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      id_reserva TEXT NOT NULL UNIQUE,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      cpf TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('EMPRESTIMO','CARTAO','BENEFICIO')),
      valor_parcela REAL NOT NULL,
      prazo_meses INTEGER NOT NULL,
      valor_total REAL NOT NULL,
      taxa_juros REAL,
      status TEXT NOT NULL DEFAULT 'RESERVADO' CHECK(status IN ('RESERVADO','EFETIVADO','CANCELADO','EXPIRADO')),
      expira_em TEXT NOT NULL,
      averbacao_id TEXT REFERENCES averbacoes(id),
      client_id TEXT REFERENCES oauth2_clients(id),
      ip_origem TEXT,
      motivo_cancelamento TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: bilhetes_averbacao (Comprovantes Digitais)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS bilhetes_averbacao (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      numero_bilhete TEXT NOT NULL UNIQUE,
      averbacao_id TEXT NOT NULL REFERENCES averbacoes(id),
      reserva_id TEXT REFERENCES reservas_margem(id),
      funcionario_cpf TEXT NOT NULL,
      funcionario_nome TEXT NOT NULL,
      banco_nome TEXT NOT NULL,
      banco_codigo TEXT,
      tipo TEXT NOT NULL,
      valor_parcela REAL NOT NULL,
      prazo_meses INTEGER NOT NULL,
      valor_total REAL NOT NULL,
      taxa_juros REAL,
      competencia_inicio TEXT,
      numero_contrato TEXT,
      hash_integridade TEXT NOT NULL,
      assinatura_digital TEXT,
      status TEXT NOT NULL DEFAULT 'VALIDO' CHECK(status IN ('VALIDO','CANCELADO')),
      emitido_em TEXT NOT NULL DEFAULT (datetime('now')),
      cancelado_em TEXT,
      dados_json TEXT
    );

    -- ===================================================
    -- TABELA: webhooks_config (Endpoints dos Parceiros)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS webhooks_config (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      banco_id TEXT REFERENCES bancos(id),
      convenio_id TEXT REFERENCES convenios(id),
      url TEXT NOT NULL,
      eventos TEXT NOT NULL,
      secret TEXT NOT NULL,
      ativo INTEGER DEFAULT 1,
      tentativas_max INTEGER DEFAULT 5,
      timeout_ms INTEGER DEFAULT 10000,
      ultimo_sucesso TEXT,
      ultimo_erro TEXT,
      total_enviados INTEGER DEFAULT 0,
      total_falhas INTEGER DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: webhooks_log (Histórico de Disparos)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS webhooks_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      webhook_id TEXT NOT NULL REFERENCES webhooks_config(id),
      evento TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','ENVIADO','FALHA','EXPIRADO')),
      tentativa INTEGER DEFAULT 1,
      http_status INTEGER,
      resposta TEXT,
      erro TEXT,
      proxima_tentativa TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      enviado_em TEXT
    );

    -- ===================================================
    -- TABELA: sincronizacoes_folha (RH-Side sync log)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS sincronizacoes_folha (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      competencia TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA','SAIDA')),
      formato TEXT NOT NULL DEFAULT 'JSON',
      total_registros INTEGER DEFAULT 0,
      processados INTEGER DEFAULT 0,
      novos INTEGER DEFAULT 0,
      atualizados INTEGER DEFAULT 0,
      erros INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PROCESSANDO',
      arquivo_url TEXT,
      solicitado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      concluido_em TEXT
    );

    -- ===================================================
    -- ÍNDICES para performance
    -- ===================================================
    -- ===================================================
    -- TABELA: banco_convenios (Credenciamento Banco × Convênio)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS banco_convenios (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      ativo INTEGER NOT NULL DEFAULT 1,
      taxa_negociada REAL,
      limite_operacoes INTEGER DEFAULT 0,
      data_inicio TEXT NOT NULL DEFAULT (date('now')),
      data_fim TEXT,
      aprovado_por TEXT,
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(banco_id, convenio_id)
    );

    -- ===================================================
    -- TABELA: esocial_eventos (Integração eSocial)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS esocial_eventos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      funcionario_id TEXT REFERENCES funcionarios(id),
      tipo_evento TEXT NOT NULL,
      numero_recibo TEXT,
      xml_enviado TEXT,
      xml_retorno TEXT,
      status TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK(status IN ('PENDENTE','ENVIADO','PROCESSADO','ERRO','REJEITADO')),
      data_envio TEXT,
      data_processamento TEXT,
      codigo_erro TEXT,
      mensagem_erro TEXT,
      ambiente TEXT NOT NULL DEFAULT 'PRODUCAO'
        CHECK(ambiente IN ('PRODUCAO','HOMOLOGACAO')),
      versao_layout TEXT DEFAULT 'S-1.1',
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: portabilidades (Portabilidade Automática)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS portabilidades (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      averbacao_origem_id TEXT NOT NULL REFERENCES averbacoes(id),
      banco_origem_id TEXT NOT NULL REFERENCES bancos(id),
      banco_destino_id TEXT NOT NULL REFERENCES bancos(id),
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      valor_parcela_origem REAL NOT NULL,
      valor_parcela_destino REAL NOT NULL,
      taxa_origem REAL,
      taxa_destino REAL,
      prazo_restante INTEGER,
      saldo_devedor REAL,
      status TEXT NOT NULL DEFAULT 'SOLICITADA'
        CHECK(status IN ('SOLICITADA','ANALISE','APROVADA','RECUSADA','EFETIVADA','CANCELADA')),
      motivo_recusa TEXT,
      averbacao_nova_id TEXT REFERENCES averbacoes(id),
      solicitado_por TEXT,
      aprovado_por TEXT,
      data_aprovacao TEXT,
      data_efetivacao TEXT,
      codigo_portabilidade TEXT UNIQUE,
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
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
    CREATE INDEX IF NOT EXISTS idx_banco_convenios_banco ON banco_convenios(banco_id);
    CREATE INDEX IF NOT EXISTS idx_banco_convenios_convenio ON banco_convenios(convenio_id);
    CREATE INDEX IF NOT EXISTS idx_portabilidades_func ON portabilidades(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_esocial_convenio ON esocial_eventos(convenio_id);

    -- ===================================================
    -- TABELA: tarifas_banco_convenio (Tarifas Negociadas por Banco × Convênio)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS tarifas_banco_convenio (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      convenio_id TEXT,
      nome_tarifa TEXT NOT NULL,
      valor_tarifa REAL NOT NULL DEFAULT 20.00,
      modelo_cobranca TEXT NOT NULL DEFAULT 'POS_PAGO'
        CHECK(modelo_cobranca IN ('POS_PAGO','PRE_PAGO')),
      vencimento_dia INTEGER NOT NULL DEFAULT 5,
      ativo INTEGER NOT NULL DEFAULT 1,
      observacoes TEXT,
      criado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: faturamento_ciclos (Fechamento Mensal por Banco)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS faturamento_ciclos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      competencia TEXT NOT NULL,
      mes INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      modelo_cobranca TEXT NOT NULL DEFAULT 'POS_PAGO'
        CHECK(modelo_cobranca IN ('POS_PAGO','PRE_PAGO')),
      status TEXT NOT NULL DEFAULT 'ABERTO'
        CHECK(status IN ('ABERTO','FECHADO','FATURADO','PAGO','CANCELADO')),
      total_averbacoes INTEGER DEFAULT 0,
      valor_total REAL DEFAULT 0,
      valor_taxa_media REAL DEFAULT 0,
      data_vencimento TEXT,
      data_fechamento TEXT,
      data_pagamento TEXT,
      faturado_por TEXT,
      numero_fatura TEXT UNIQUE,
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(banco_id, competencia)
    );

    -- ===================================================
    -- TABELA: faturamento_itens (Averbações por Ciclo)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS faturamento_itens (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      ciclo_id TEXT NOT NULL REFERENCES faturamento_ciclos(id),
      averbacao_id TEXT NOT NULL REFERENCES averbacoes(id),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      codigo_averbacao TEXT NOT NULL,
      tipo_averbacao TEXT NOT NULL,
      valor_parcela REAL NOT NULL,
      valor_tarifa REAL NOT NULL,
      hash_comprovante TEXT NOT NULL,
      data_averbacao TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: faturamento_creditos (Créditos Pré-Pagos)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS faturamento_creditos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      tipo TEXT NOT NULL DEFAULT 'CREDITO'
        CHECK(tipo IN ('CREDITO','DEBITO','ESTORNO','BONUS')),
      valor REAL NOT NULL,
      saldo_antes REAL NOT NULL DEFAULT 0,
      saldo_depois REAL NOT NULL DEFAULT 0,
      descricao TEXT NOT NULL,
      referencia_id TEXT,
      referencia_tipo TEXT,
      criado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: faturamento_comprovantes (Comprovantes com Hash)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS faturamento_comprovantes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      averbacao_id TEXT NOT NULL REFERENCES averbacoes(id),
      ciclo_id TEXT REFERENCES faturamento_ciclos(id),
      numero_comprovante TEXT NOT NULL UNIQUE,
      hash_sha256 TEXT NOT NULL,
      timestamp_emissao TEXT NOT NULL DEFAULT (datetime('now')),
      dados_json TEXT NOT NULL,
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      valor_tarifa REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'VALIDO'
        CHECK(status IN ('VALIDO','CANCELADO')),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- ÍNDICES BILLING
    -- ===================================================
    CREATE INDEX IF NOT EXISTS idx_fat_ciclos_banco ON faturamento_ciclos(banco_id);
    CREATE INDEX IF NOT EXISTS idx_fat_ciclos_comp ON faturamento_ciclos(competencia);
    CREATE INDEX IF NOT EXISTS idx_fat_itens_ciclo ON faturamento_itens(ciclo_id);
    CREATE INDEX IF NOT EXISTS idx_fat_itens_averb ON faturamento_itens(averbacao_id);
    CREATE INDEX IF NOT EXISTS idx_fat_creditos_banco ON faturamento_creditos(banco_id);
    CREATE INDEX IF NOT EXISTS idx_fat_comprov_averb ON faturamento_comprovantes(averbacao_id);
    CREATE INDEX IF NOT EXISTS idx_tarifas_banco ON tarifas_banco_convenio(banco_id);

    -- ===================================================
    -- TABELA: seguradoras (Empresas de Seguro / Associações)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS seguradoras (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nome TEXT NOT NULL,
      cnpj TEXT UNIQUE NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'SEGURADORA'
        CHECK(tipo IN ('SEGURADORA','ASSOCIACAO','SINDICATO','PLANO_SAUDE','FARMACIA','OUTRO')),
      responsavel TEXT,
      email TEXT,
      telefone TEXT,
      webhook_url TEXT,
      webhook_secret TEXT,
      taxa_manutencao REAL NOT NULL DEFAULT 2.00,
      modelo_cobranca TEXT NOT NULL DEFAULT 'POS_PAGO'
        CHECK(modelo_cobranca IN ('POS_PAGO','PRE_PAGO')),
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: produtos_seguro (Catálogo de Produtos)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS produtos_seguro (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      seguradora_id TEXT NOT NULL REFERENCES seguradoras(id),
      nome TEXT NOT NULL,
      codigo TEXT NOT NULL,
      descricao TEXT,
      tipo TEXT NOT NULL DEFAULT 'VIDA'
        CHECK(tipo IN ('VIDA','SAUDE','ODONTOLOGICO','FARMACIA','ASSOCIACAO','SINDICATO','OUTRO')),
      valor_premio_minimo REAL NOT NULL DEFAULT 0,
      valor_premio_maximo REAL,
      percentual_margem TEXT NOT NULL DEFAULT 'FACULTATIVO',
      taxa_averbacao_ativacao REAL NOT NULL DEFAULT 5.00,
      taxa_manutencao_mensal REAL NOT NULL DEFAULT 2.00,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: seguros_facultativos (Consignações de Seguros)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS seguros_facultativos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      codigo_seguro TEXT NOT NULL UNIQUE,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      seguradora_id TEXT NOT NULL REFERENCES seguradoras(id),
      produto_id TEXT REFERENCES produtos_seguro(id),
      tipo_produto TEXT NOT NULL
        CHECK(tipo_produto IN ('VIDA','SAUDE','ODONTOLOGICO','FARMACIA','ASSOCIACAO','SINDICATO','OUTRO')),
      valor_premio REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ATIVO'
        CHECK(status IN ('PENDENTE','ATIVO','SUSPENSO','CANCELADO','ENCERRADO')),
      data_inicio TEXT NOT NULL DEFAULT (date('now')),
      data_fim TEXT,
      motivo_cancelamento TEXT,
      cancelado_por TEXT,
      cancelado_em TEXT,
      numero_apolice TEXT,
      observacoes TEXT,
      prioridade INTEGER NOT NULL DEFAULT 99,
      taxa_averbacao_cobrada REAL NOT NULL DEFAULT 5.00,
      taxa_manutencao_mensal REAL NOT NULL DEFAULT 2.00,
      solicitado_por TEXT,
      aprovado_por TEXT,
      data_aprovacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: seguros_lancamentos (Lançamentos Mensais)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS seguros_lancamentos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      seguro_id TEXT NOT NULL REFERENCES seguros_facultativos(id),
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      seguradora_id TEXT NOT NULL REFERENCES seguradoras(id),
      competencia TEXT NOT NULL,
      valor_premio REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK(status IN ('PENDENTE','PROCESSADO','REJEITADO','CANCELADO')),
      motivo_rejeicao TEXT,
      processado_em TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: seguros_importacoes (Upload em Lote da Seguradora)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS seguros_importacoes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      seguradora_id TEXT NOT NULL REFERENCES seguradoras(id),
      convenio_id TEXT REFERENCES convenios(id),
      competencia TEXT NOT NULL,
      total_registros INTEGER DEFAULT 0,
      processados INTEGER DEFAULT 0,
      novos INTEGER DEFAULT 0,
      atualizados INTEGER DEFAULT 0,
      erros INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PROCESSANDO'
        CHECK(status IN ('PROCESSANDO','CONCLUIDO','ERRO')),
      importado_por TEXT,
      arquivo_nome TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      concluido_em TEXT
    );

    -- ===================================================
    -- TABELA: cartoes_consignados (RMC/RCC por Funcionário)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS cartoes_consignados (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      codigo_cartao TEXT NOT NULL UNIQUE,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      convenio_id TEXT NOT NULL REFERENCES convenios(id),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      tipo TEXT NOT NULL DEFAULT 'RMC'
        CHECK(tipo IN ('RMC','RCC')),
      status TEXT NOT NULL DEFAULT 'SOLICITADO'
        CHECK(status IN ('SOLICITADO','ATIVO','BLOQUEADO','CANCELADO','ENCERRADO')),
      margem_reservada REAL NOT NULL,
      limite_total REAL NOT NULL DEFAULT 0,
      saldo_limite_atual REAL NOT NULL DEFAULT 0,
      percentual_margem REAL NOT NULL DEFAULT 5.0,
      data_ativacao TEXT,
      data_cancelamento TEXT,
      motivo_cancelamento TEXT,
      motivo_bloqueio TEXT,
      bloqueado_em TEXT,
      bloqueado_por TEXT,
      numero_cartao_mascarado TEXT,
      numero_contrato_banco TEXT,
      taxa_averbacao_cobrada REAL NOT NULL DEFAULT 15.00,
      taxa_manutencao_mensal REAL NOT NULL DEFAULT 1.00,
      solicitado_por TEXT,
      aprovado_por TEXT,
      data_aprovacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: cartoes_faturas (Gastos Mensais do Cartão)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS cartoes_faturas (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      cartao_id TEXT NOT NULL REFERENCES cartoes_consignados(id),
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      banco_id TEXT NOT NULL REFERENCES bancos(id),
      competencia TEXT NOT NULL,
      valor_gasto REAL NOT NULL DEFAULT 0,
      valor_saque REAL NOT NULL DEFAULT 0,
      valor_total_desconto REAL NOT NULL DEFAULT 0,
      margem_reservada REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK(status IN ('PENDENTE','VALIDADO','REJEITADO','DESCONTADO')),
      motivo_rejeicao TEXT,
      enviado_rh INTEGER DEFAULT 0,
      enviado_rh_em TEXT,
      validado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(cartao_id, competencia)
    );

    -- ===================================================
    -- TABELA: faturamento_recorrente (Cobranças Mensais)
    -- Seguros: R$2/mês/linha | Cartão: R$1/mês/cartão ativo
    -- ===================================================
    CREATE TABLE IF NOT EXISTS faturamento_recorrente (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      competencia TEXT NOT NULL,
      mes INTEGER NOT NULL,
      ano INTEGER NOT NULL,
      tipo_cobranca TEXT NOT NULL
        CHECK(tipo_cobranca IN ('SEGURO_MANUTENCAO','CARTAO_MANUTENCAO','CARTAO_ATIVACAO','SEGURO_ATIVACAO')),
      entidade_tipo TEXT NOT NULL
        CHECK(entidade_tipo IN ('SEGURADORA','BANCO')),
      entidade_id TEXT NOT NULL,
      entidade_nome TEXT,
      referencia_id TEXT NOT NULL,
      referencia_tipo TEXT NOT NULL,
      funcionario_id TEXT NOT NULL REFERENCES funcionarios(id),
      valor_unitario REAL NOT NULL DEFAULT 2.00,
      status TEXT NOT NULL DEFAULT 'PENDENTE'
        CHECK(status IN ('PENDENTE','FATURADO','PAGO','CANCELADO')),
      numero_fatura TEXT,
      data_vencimento TEXT,
      data_pagamento TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===================================================
    -- TABELA: faturamento_recorrente_ciclos (Ciclos Mensais)
    -- ===================================================
    CREATE TABLE IF NOT EXISTS faturamento_recorrente_ciclos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      competencia TEXT NOT NULL,
      entidade_tipo TEXT NOT NULL,
      entidade_id TEXT NOT NULL,
      entidade_nome TEXT,
      tipo_cobranca TEXT NOT NULL,
      total_linhas INTEGER DEFAULT 0,
      valor_unitario REAL DEFAULT 0,
      valor_total REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ABERTO'
        CHECK(status IN ('ABERTO','FECHADO','FATURADO','PAGO')),
      numero_fatura TEXT UNIQUE,
      data_vencimento TEXT,
      data_pagamento TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(competencia, entidade_id, tipo_cobranca)
    );

    -- ===================================================
    -- ÍNDICES SEGUROS E CARTÃO
    -- ===================================================
    CREATE INDEX IF NOT EXISTS idx_seg_func ON seguros_facultativos(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_seg_seguradora ON seguros_facultativos(seguradora_id);
    CREATE INDEX IF NOT EXISTS idx_seg_status ON seguros_facultativos(status);
    CREATE INDEX IF NOT EXISTS idx_seg_lanc_seguro ON seguros_lancamentos(seguro_id);
    CREATE INDEX IF NOT EXISTS idx_seg_lanc_comp ON seguros_lancamentos(competencia);
    CREATE INDEX IF NOT EXISTS idx_cartao_func ON cartoes_consignados(funcionario_id);
    CREATE INDEX IF NOT EXISTS idx_cartao_banco ON cartoes_consignados(banco_id);
    CREATE INDEX IF NOT EXISTS idx_cartao_status ON cartoes_consignados(status);
    CREATE INDEX IF NOT EXISTS idx_cartao_fat_comp ON cartoes_faturas(competencia);
    CREATE INDEX IF NOT EXISTS idx_rec_comp ON faturamento_recorrente(competencia);
    CREATE INDEX IF NOT EXISTS idx_rec_entidade ON faturamento_recorrente(entidade_id);
  `);

  console.log('✅ Banco de dados inicializado com sucesso');
}

module.exports = { db, initializeDatabase };
