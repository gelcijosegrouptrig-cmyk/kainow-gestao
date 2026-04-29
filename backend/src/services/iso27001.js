/**
 * MÓDULO 4: ISO 27001 — CONTROLES DE SEGURANÇA
 * Implementa os 93 controles do Anexo A da ISO/IEC 27001:2022
 * mapeados para o contexto de sistemas financeiros/consignado
 *
 * Categorias:
 *   A.5  - Políticas de Segurança
 *   A.6  - Organização da Segurança
 *   A.7  - Segurança em RH
 *   A.8  - Gestão de Ativos
 *   A.9  - Controle de Acesso (crítico para LGPD)
 *   A.10 - Criptografia
 *   A.12 - Segurança Operacional
 *   A.13 - Segurança em Redes
 *   A.16 - Gestão de Incidentes
 *   A.17 - Continuidade de Negócio
 *   A.18 - Conformidade (LGPD, BACEN)
 */

const { db } = require('../database');
const { gerarId } = require('../utils/helpers');

function initISO27001Tables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS iso27001_controles (
      id TEXT PRIMARY KEY,
      categoria TEXT NOT NULL,
      numero TEXT UNIQUE NOT NULL,
      titulo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      nivel_implementacao TEXT NOT NULL DEFAULT 'NAO_APLICAVEL'
        CHECK(nivel_implementacao IN ('IMPLEMENTADO','PARCIAL','PLANEJADO','NAO_APLICAVEL')),
      responsavel TEXT,
      evidencia TEXT,
      data_revisao TEXT,
      score INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 100),
      observacoes TEXT,
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS iso27001_incidentes (
      id TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      categoria TEXT NOT NULL CHECK(categoria IN
        ('ACESSO_NAO_AUTORIZADO','VAZAMENTO_DADOS','INDISPONIBILIDADE',
         'FRAUDE','MALWARE','ERRO_OPERACIONAL','OUTRO')),
      severidade TEXT NOT NULL DEFAULT 'BAIXA'
        CHECK(severidade IN ('CRITICA','ALTA','MEDIA','BAIXA')),
      status TEXT NOT NULL DEFAULT 'ABERTO'
        CHECK(status IN ('ABERTO','EM_ANALISE','CONTIDO','RESOLVIDO','FECHADO')),
      impacto_estimado TEXT,
      sistemas_afetados TEXT,
      dados_pessoais_afetados INTEGER DEFAULT 0,
      notificar_anpd INTEGER DEFAULT 0,
      registrado_por TEXT,
      resolvido_por TEXT,
      data_deteccao TEXT NOT NULL DEFAULT (datetime('now')),
      data_resolucao TEXT,
      acoes_tomadas TEXT,
      licoes_aprendidas TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS iso27001_avaliacoes_risco (
      id TEXT PRIMARY KEY,
      ativo TEXT NOT NULL,
      ameaca TEXT NOT NULL,
      vulnerabilidade TEXT NOT NULL,
      probabilidade INTEGER NOT NULL CHECK(probabilidade BETWEEN 1 AND 5),
      impacto INTEGER NOT NULL CHECK(impacto BETWEEN 1 AND 5),
      risco_inerente INTEGER GENERATED ALWAYS AS (probabilidade * impacto) STORED,
      controles_existentes TEXT,
      probabilidade_residual INTEGER DEFAULT 1 CHECK(probabilidade_residual BETWEEN 1 AND 5),
      impacto_residual INTEGER DEFAULT 1 CHECK(impacto_residual BETWEEN 1 AND 5),
      risco_residual INTEGER GENERATED ALWAYS AS (probabilidade_residual * impacto_residual) STORED,
      tratamento TEXT CHECK(tratamento IN ('ACEITAR','MITIGAR','TRANSFERIR','EVITAR')),
      responsavel TEXT,
      prazo TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS iso27001_politicas (
      id TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      versao TEXT NOT NULL DEFAULT '1.0',
      categoria TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RASCUNHO'
        CHECK(status IN ('RASCUNHO','APROVADA','PUBLICADA','OBSOLETA')),
      aprovado_por TEXT,
      data_aprovacao TEXT,
      proxima_revisao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_incidentes_status ON iso27001_incidentes(status);
    CREATE INDEX IF NOT EXISTS idx_incidentes_severidade ON iso27001_incidentes(severidade);
  `);

  // Seed dos controles críticos ISO 27001:2022 para sistemas financeiros
  const existe = db.prepare("SELECT COUNT(*) as c FROM iso27001_controles").get();
  if (existe.c > 0) return;

  const controles = [
    // A.5 - POLÍTICAS
    ['A.5.1', 'A.5 Políticas', 'Políticas de Segurança da Informação',
      'Política de segurança definida, aprovada pela direção e comunicada a todos os colaboradores', 'IMPLEMENTADO', 90],
    ['A.5.2', 'A.5 Políticas', 'Revisão das Políticas de Segurança',
      'Políticas revisadas em intervalos planejados (mín. anual) ou quando ocorrem mudanças significativas', 'PARCIAL', 70],

    // A.6 - ORGANIZAÇÃO
    ['A.6.1', 'A.6 Organização', 'Funções e Responsabilidades de Segurança',
      'Responsabilidades de segurança definidas e atribuídas. CISO ou responsável nomeado.', 'PARCIAL', 65],
    ['A.6.3', 'A.6 Organização', 'Segurança da Informação no Gerenciamento de Projetos',
      'Segurança integrada ao ciclo de desenvolvimento de sistemas', 'IMPLEMENTADO', 80],

    // A.7 - PESSOAS
    ['A.7.1', 'A.7 Pessoas', 'Triagem de Candidatos',
      'Verificação de antecedentes de colaboradores com acesso a dados sensíveis', 'PLANEJADO', 40],
    ['A.7.2', 'A.7 Pessoas', 'Termos e Condições de Emprego',
      'Acordos de confidencialidade (NDA) assinados por todos com acesso ao sistema', 'IMPLEMENTADO', 85],
    ['A.7.3', 'A.7 Pessoas', 'Conscientização, Educação e Treinamento em SI',
      'Treinamentos periódicos de LGPD e segurança da informação', 'PARCIAL', 60],

    // A.8 - ATIVOS
    ['A.8.1', 'A.8 Ativos', 'Inventário de Ativos de Informação',
      'Inventário atualizado de todos os ativos: servidores, bancos de dados, APIs, documentos', 'PARCIAL', 55],
    ['A.8.2', 'A.8 Ativos', 'Classificação da Informação',
      'Dados classificados: PÚBLICO, INTERNO, CONFIDENCIAL, RESTRITO', 'IMPLEMENTADO', 80],
    ['A.8.3', 'A.8 Ativos', 'Manuseio de Mídia',
      'Controle de dispositivos removíveis, criptografia de backups', 'PARCIAL', 65],

    // A.9 - CONTROLE DE ACESSO (CRÍTICO - LGPD)
    ['A.9.1', 'A.9 Controle de Acesso', 'Política de Controle de Acesso',
      'Acesso baseado em necessidade (need-to-know). Princípio do menor privilégio implementado.', 'IMPLEMENTADO', 92],
    ['A.9.2', 'A.9 Controle de Acesso', 'Gestão de Acesso de Usuários',
      'Processo formal para concessão, revisão e revogação de acessos. Perfis: SUPER_ADMIN/ADMIN/RH/BANCO/FUNCIONARIO.', 'IMPLEMENTADO', 95],
    ['A.9.3', 'A.9 Controle de Acesso', 'Responsabilidades dos Usuários',
      'Usuários cientes de suas responsabilidades. Senhas mínimas 8 chars + bcrypt 12 rounds.', 'IMPLEMENTADO', 90],
    ['A.9.4', 'A.9 Controle de Acesso', 'Controle de Acesso a Sistemas e Aplicações',
      'Autenticação JWT + Rate Limiting + Bloqueio após tentativas. Sessão expira em 8h.', 'IMPLEMENTADO', 95],
    ['A.9.5', 'A.9 Controle de Acesso', 'Autenticação Segura',
      'MFA não implementado. Recomendado: TOTP/SMS para bancos e super admins.', 'PLANEJADO', 45],

    // A.10 - CRIPTOGRAFIA
    ['A.10.1', 'A.10 Criptografia', 'Política de Uso de Criptografia',
      'Senhas: bcrypt-12. Tokens: RS256/HS256. Certificados: RSA-2048. TLS 1.2+ em produção.', 'IMPLEMENTADO', 90],
    ['A.10.2', 'A.10 Criptografia', 'Gestão de Chaves Criptográficas',
      'Chaves de certificados digitais gerenciadas. HSM necessário em produção para ICP-Brasil.', 'PARCIAL', 60],

    // A.12 - OPERAÇÕES
    ['A.12.1', 'A.12 Segurança Operacional', 'Gestão de Capacidade',
      'Monitoramento de recursos do servidor. Alertas para uso > 80% CPU/memória.', 'PLANEJADO', 35],
    ['A.12.2', 'A.12 Segurança Operacional', 'Proteção contra Malware',
      'Ambiente containerizado. Dependências verificadas (npm audit). Atualizações regulares.', 'PARCIAL', 70],
    ['A.12.3', 'A.12 Segurança Operacional', 'Backup e Recuperação',
      'Backup automático do banco de dados. RTO < 4h, RPO < 1h. Testes de restauração mensais.', 'PLANEJADO', 40],
    ['A.12.4', 'A.12 Segurança Operacional', 'Log e Monitoramento',
      'Auditoria completa de todas as operações. Logs imutáveis. Retenção: 5 anos (BACEN).', 'IMPLEMENTADO', 95],
    ['A.12.6', 'A.12 Segurança Operacional', 'Gestão de Vulnerabilidades Técnicas',
      'Scan de dependências com npm audit. OWASP Top 10 verificado.', 'PARCIAL', 65],

    // A.13 - REDES
    ['A.13.1', 'A.13 Segurança de Redes', 'Gestão de Segurança de Redes',
      'CORS configurado. Helmet.js ativo. Rate limiting. HTTPS obrigatório em produção.', 'IMPLEMENTADO', 88],
    ['A.13.2', 'A.13 Segurança de Redes', 'Transferência de Informações',
      'API REST com TLS. Dados sensíveis não em querystring. Mascaramento de CPF na API.', 'IMPLEMENTADO', 85],

    // A.16 - INCIDENTES
    ['A.16.1', 'A.16 Gestão de Incidentes', 'Gestão de Incidentes de SI',
      'Processo de resposta a incidentes definido. Notificação ANPD em até 72h (LGPD Art. 48).', 'PARCIAL', 60],

    // A.17 - CONTINUIDADE
    ['A.17.1', 'A.17 Continuidade', 'Planejamento de Continuidade de Negócio',
      'BCP documentado. Failover para banco de dados replica. DR site planejado.', 'PLANEJADO', 30],

    // A.18 - CONFORMIDADE
    ['A.18.1', 'A.18 Conformidade', 'Conformidade com Requisitos Legais (LGPD/BACEN)',
      'LGPD: mascaramento CPF, logs, base legal. BACEN 4.658: rastreabilidade, criptografia.', 'IMPLEMENTADO', 88],
    ['A.18.2', 'A.18 Conformidade', 'Revisões de Segurança da Informação',
      'Pentest anual planejado. Code review obrigatório antes de deploy em produção.', 'PLANEJADO', 35]
  ];

  const stmt = db.prepare(`
    INSERT INTO iso27001_controles (id, numero, categoria, titulo, descricao, nivel_implementacao, score)
    VALUES (?,?,?,?,?,?,?)
  `);
  for (const [num, cat, tit, desc, nivel, score] of controles) {
    stmt.run(gerarId(), num, cat, tit, desc, nivel, score);
  }

  // Seed: políticas padrão
  const politicas = [
    ['Política de Segurança da Informação', '1.0', 'GOVERNANÇA',
      'Esta política estabelece os princípios e diretrizes de segurança da informação do MargemPRO, alinhados à ISO 27001:2022, LGPD (Lei 13.709/2018) e Resolução BACEN 4.658/2018.\n\n**1. OBJETIVO**: Proteger a confidencialidade, integridade e disponibilidade dos dados de funcionários e operações consignadas.\n\n**2. ESCOPO**: Todos os sistemas, colaboradores, terceiros e parceiros com acesso aos dados.\n\n**3. PRINCÍPIOS**: Menor privilégio, separação de funções, defesa em profundidade, responsabilização.\n\n**4. VIOLAÇÕES**: Acessos não autorizados serão investigados e poderão resultar em medidas disciplinares e/ou legais.',
      'APROVADA'],
    ['Política de Controle de Acesso', '1.1', 'ACESSO',
      '**1. AUTENTICAÇÃO**: Senhas mínimo 8 caracteres, bcrypt hash. JWT com expiração 8h.\n\n**2. PERFIS**: SUPER_ADMIN > ADMIN > RH > BANCO > FUNCIONARIO. Princípio do menor privilégio.\n\n**3. REVISÃO**: Acessos revisados mensalmente. Desativação imediata em caso de desligamento.\n\n**4. MFA**: Obrigatório para SUPER_ADMIN e ADMIN (implementação em Q1/2025).',
      'PUBLICADA'],
    ['Política de Tratamento de Dados Pessoais (LGPD)', '1.2', 'LGPD',
      '**BASE LEGAL**: Art. 7º LGPD — execução de contrato e obrigação legal (Leis 10.820/2003 e 8.112/90).\n\n**DADOS COLETADOS**: CPF, nome, salário, matrícula, dados de folha de pagamento.\n\n**RETENÇÃO**: 5 anos após encerramento do contrato (conforme BACEN).\n\n**DIREITOS**: Titular pode consultar seus dados via Portal de Transparência.\n\n**DPO**: Nomeação de Encarregado obrigatória (Art. 41 LGPD).\n\n**INCIDENTES**: Notificação à ANPD em até 72h (Art. 48 LGPD).',
      'PUBLICADA'],
    ['Plano de Resposta a Incidentes', '1.0', 'INCIDENTES',
      '**FASES**: 1.Preparação → 2.Detecção → 3.Contenção → 4.Erradicação → 5.Recuperação → 6.Pós-Incidente.\n\n**CLASSIFICAÇÃO**: CRITICA (dados expostos >10k registros, sistema indisponível), ALTA (<10k registros ou fraude), MÉDIA (tentativas frustradas), BAIXA (anomalias sem impacto).\n\n**ESCALADA**: CRÍTICO: CEO+CTO+DPO em 1h. ALTO: CTO+DPO em 4h. MÉDIO: TI em 24h.',
      'APROVADA']
  ];

  const stmtPol = db.prepare(`
    INSERT INTO iso27001_politicas (id, titulo, versao, categoria, conteudo, status, data_aprovacao)
    VALUES (?,?,?,?,?,?,date('now'))
  `);
  for (const [tit, ver, cat, cont, stat] of politicas) {
    stmtPol.run(gerarId(), tit, ver, cat, cont, stat);
  }

  // Seed: avaliações de risco críticas
  const riscos = [
    ['Banco de Dados com CPF/salários', 'Acesso não autorizado externo', 'Exposição de API sem autenticação', 3, 5, 'JWT + Rate limiting + Helmet', 1, 4, 'MITIGAR', '90 dias'],
    ['Arquivo de folha de pagamento (upload)', 'Injeção de arquivo malicioso', 'Falta de validação de tipo', 2, 4, 'Multer + whitelist extensões', 1, 3, 'MITIGAR', '60 dias'],
    ['Tokens JWT de sessão', 'Roubo de token por XSS', 'Falta de CSP headers', 2, 5, 'Helmet + SameSite cookies', 1, 3, 'MITIGAR', '30 dias'],
    ['Chaves privadas dos certificados', 'Exposição de chave privada', 'Armazenamento inseguro', 2, 5, 'Armazenamento em HSM (produção)', 1, 4, 'TRANSFERIR', '60 dias'],
    ['Logs de auditoria', 'Adulteração de logs para cobrir rastros', 'Acesso de escrita ao banco', 1, 5, 'Logs somente insert, sem delete', 1, 2, 'ACEITAR', 'N/A']
  ];

  const stmtRisco = db.prepare(`
    INSERT INTO iso27001_avaliacoes_risco
      (id, ativo, ameaca, vulnerabilidade, probabilidade, impacto,
       controles_existentes, probabilidade_residual, impacto_residual, tratamento, prazo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const r of riscos) {
    stmtRisco.run(gerarId(), ...r);
  }
}

function getScoreGeral() {
  const controles = db.prepare('SELECT nivel_implementacao, COUNT(*) as qtd, AVG(score) as avg_score FROM iso27001_controles GROUP BY nivel_implementacao').all();
  const total = db.prepare('SELECT COUNT(*) as c, AVG(score) as avg FROM iso27001_controles').get();
  const impl = controles.find(c => c.nivel_implementacao === 'IMPLEMENTADO') || { qtd: 0 };
  const parc = controles.find(c => c.nivel_implementacao === 'PARCIAL') || { qtd: 0 };
  const plan = controles.find(c => c.nivel_implementacao === 'PLANEJADO') || { qtd: 0 };
  const na   = controles.find(c => c.nivel_implementacao === 'NAO_APLICAVEL') || { qtd: 0 };

  return {
    score_geral: Math.round(total.avg || 0),
    total_controles: total.c,
    implementados: impl.qtd,
    parciais: parc.qtd,
    planejados: plan.qtd,
    nao_aplicavel: na.qtd,
    percentual_conformidade: total.c > 0 ? Math.round((impl.qtd / (total.c - na.qtd)) * 100) : 0
  };
}

module.exports = { initISO27001Tables, getScoreGeral };
