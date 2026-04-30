const bcrypt = require('bcryptjs');
const { db } = require('./database');
const { gerarId, gerarCodigoAverbacao } = require('./utils/helpers');
const { calcularMargens, gerarCompetencia } = require('./services/margemEngine');

function seedDatabase() {
  const existe = db.prepare("SELECT COUNT(*) as c FROM usuarios").get();
  if (existe.c > 0) return;

  console.log('🌱 Populando banco de dados com dados iniciais...');

  const adminId = gerarId();
  const adminRHId = gerarId();
  const bancoUserId = gerarId();

  // =================== USUÁRIO SUPER ADMIN ===================
  db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil) VALUES (?,?,?,?,?)`)
    .run(adminId, 'Administrador AverbaTech', 'admin@averba.tech',
      bcrypt.hashSync('Admin@2024', 12), 'SUPER_ADMIN');

  // =================== CONVÊNIOS ===================
  const convPrefId = gerarId();
  const convEmpId = gerarId();

  db.prepare(`INSERT INTO convenios (id, nome, cnpj, tipo, sistema_folha, percentual_emprestimo, percentual_cartao, percentual_beneficio, responsavel, telefone)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(convPrefId, 'Prefeitura Municipal de São Paulo', '46395000000139', 'PUBLICO', 'TOTVS', 35.0, 5.0, 5.0, 'João Silva', '(11) 3333-4444');

  db.prepare(`INSERT INTO convenios (id, nome, cnpj, tipo, sistema_folha, percentual_emprestimo, percentual_cartao, percentual_beneficio, responsavel, telefone)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(convEmpId, 'Empresa Comércio Ltda', '12345678000195', 'PRIVADO', 'SAP', 30.0, 5.0, 5.0, 'Maria Santos', '(11) 9999-8888');

  // =================== BANCOS ===================
  const bancoBBId = gerarId();
  const bancoCaixaId = gerarId();
  const bancoDayId = gerarId();

  db.prepare(`INSERT INTO bancos (id, nome, codigo_bacen, cnpj, taxa_averbacao, contato_responsavel, email_operacional)
    VALUES (?,?,?,?,?,?,?)`)
    .run(bancoBBId, 'Banco do Brasil', '001', '00000000000191', 18.00, 'Carlos BB', 'consignado@bb.com.br');

  db.prepare(`INSERT INTO bancos (id, nome, codigo_bacen, cnpj, taxa_averbacao, contato_responsavel, email_operacional)
    VALUES (?,?,?,?,?,?,?)`)
    .run(bancoCaixaId, 'Caixa Econômica Federal', '104', '00360305000104', 15.00, 'Ana CEF', 'consignado@caixa.gov.br');

  db.prepare(`INSERT INTO bancos (id, nome, codigo_bacen, cnpj, taxa_averbacao, contato_responsavel, email_operacional)
    VALUES (?,?,?,?,?,?,?)`)
    .run(bancoDayId, 'Daycoval', '707', '62232889000190', 12.00, 'Roberto Day', 'consignado@daycoval.com.br');

  // =================== USUÁRIOS RH / BANCO ===================
  db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil, convenio_id) VALUES (?,?,?,?,?,?)`)
    .run(adminRHId, 'Operador RH Prefeitura', 'rh@prefeitura.sp.gov.br',
      bcrypt.hashSync('RH@12345', 12), 'RH', convPrefId);

  db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil, banco_id) VALUES (?,?,?,?,?,?)`)
    .run(bancoUserId, 'Operador Banco do Brasil', 'operador@bb.com.br',
      bcrypt.hashSync('Banco@123', 12), 'BANCO', bancoBBId);

  // =================== FUNCIONÁRIOS ===================
  const funcionarios = [
    { mat: 'MAT001', nome: 'Ana Paula Ferreira', cpf: '12345678901', cargo: 'Analista', lotacao: 'Secretaria de Finanças', bruto: 5800.00, liq: 4200.00 },
    { mat: 'MAT002', nome: 'Carlos Eduardo Lima', cpf: '23456789012', cargo: 'Assistente', lotacao: 'Secretaria de Saúde', bruto: 3200.00, liq: 2600.00 },
    { mat: 'MAT003', nome: 'Mariana Costa Souza', cpf: '34567890123', cargo: 'Coordenador', lotacao: 'Secretaria de Educação', bruto: 7500.00, liq: 5800.00 },
    { mat: 'MAT004', nome: 'Roberto Alves Pereira', cpf: '45678901234', cargo: 'Técnico', lotacao: 'Secretaria de Obras', bruto: 4100.00, liq: 3200.00 },
    { mat: 'MAT005', nome: 'Fernanda Oliveira', cpf: '56789012345', cargo: 'Gerente', lotacao: 'Secretaria de RH', bruto: 9200.00, liq: 7100.00 },
  ];

  const comp = gerarCompetencia();
  const funcIds = [];

  for (const f of funcionarios) {
    const fId = gerarId();
    funcIds.push(fId);
    db.prepare(`INSERT INTO funcionarios (id, matricula, nome, cpf, convenio_id, cargo, lotacao, salario_bruto, salario_liquido, data_admissao)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(fId, f.mat, f.nome, f.cpf, convPrefId, f.cargo, f.lotacao, f.bruto, f.liq, '2020-03-01');

    const margens = calcularMargens(f.bruto, f.liq, { emprestimo: 35, cartao: 5, beneficio: 5 });
    const mId = gerarId();
    db.prepare(`INSERT INTO margens (id, funcionario_id, convenio_id, competencia, salario_bruto, salario_liquido,
      margem_total_emprestimo, margem_total_cartao, margem_total_beneficio,
      margem_usada_emprestimo, margem_usada_cartao,
      margem_disponivel_emprestimo, margem_disponivel_cartao, margem_disponivel_beneficio)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(mId, fId, convPrefId, comp, f.bruto, f.liq,
        margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio,
        0, 0,
        margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio);
  }

  // =================== AVERBAÇÕES DE EXEMPLO ===================
  const averbacaoId1 = gerarId();
  const cod1 = gerarCodigoAverbacao('PRE');
  db.prepare(`INSERT INTO averbacoes (id, codigo_averbacao, funcionario_id, convenio_id, banco_id, tipo, status,
    valor_parcela, prazo_meses, valor_total, taxa_juros, competencia_inicio, competencia_fim,
    numero_contrato_banco, taxa_averbacao_cobrada)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(averbacaoId1, cod1, funcIds[0], convPrefId, bancoBBId, 'EMPRESTIMO', 'APROVADA',
      850.00, 36, 30600.00, 1.89, comp, '2027-04', 'BB-2024-001', 18.00);

  // Debitar da margem do primeiro funcionário
  db.prepare(`UPDATE margens SET margem_usada_emprestimo = 850.00, margem_disponivel_emprestimo = margem_disponivel_emprestimo - 850.00
    WHERE funcionario_id = ? AND competencia = ?`).run(funcIds[0], comp);

  const averbacaoId2 = gerarId();
  const cod2 = gerarCodigoAverbacao('PRE');
  db.prepare(`INSERT INTO averbacoes (id, codigo_averbacao, funcionario_id, convenio_id, banco_id, tipo, status,
    valor_parcela, prazo_meses, valor_total, taxa_juros, competencia_inicio, competencia_fim,
    numero_contrato_banco, taxa_averbacao_cobrada)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(averbacaoId2, cod2, funcIds[2], convPrefId, bancoCaixaId, 'CARTAO', 'RESERVADA',
      290.00, 12, 3480.00, 3.5, comp, '2025-04', 'CEF-2024-042', 15.00);

  db.prepare(`UPDATE margens SET margem_usada_cartao = 290.00, margem_disponivel_cartao = margem_disponivel_cartao - 290.00
    WHERE funcionario_id = ? AND competencia = ?`).run(funcIds[2], comp);

  console.log('✅ Dados iniciais inseridos com sucesso!');
  console.log('\n📋 CREDENCIAIS DE ACESSO:');
  console.log('   👑 Super Admin: admin@averba.tech / Admin@2024');
  console.log('   🏛️  RH Prefeitura: rh@prefeitura.sp.gov.br / RH@12345');
  console.log('   🏦 Banco do Brasil: operador@bb.com.br / Banco@123\n');
}

module.exports = { seedDatabase };
