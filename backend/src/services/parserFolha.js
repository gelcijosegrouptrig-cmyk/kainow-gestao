/**
 * MÓDULO 2: PARSER DE ARQUIVOS DE FOLHA DE PAGAMENTO
 * Suporte: TOTVS (RM/Protheus), SAP, Senior, CNAB 240, CNAB 400, CSV genérico
 *
 * Fluxo real:
 *   1. Convênio gera arquivo de retorno no sistema de RH (TOTVS, SAP, etc.)
 *   2. Operador RH faz upload aqui
 *   3. Sistema lê, valida, e atualiza margens automaticamente
 *   4. Erros são reportados linha a linha
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { db } = require('../database');
const { gerarId } = require('../utils/helpers');
const { calcularMargens, gerarCompetencia } = require('./margemEngine');

// ─────────────────────────────────────────────
// Parser TOTVS RM / Protheus (layout fixo .txt)
// Exemplo de linha: "MAT001  ANA PAULA FERREIRA          005800.00004200.00"
// ─────────────────────────────────────────────
function parseTOTVS(conteudo) {
  const linhas = conteudo.split('\n').filter(l => l.trim().length > 0);
  const registros = [];
  const erros = [];

  linhas.forEach((linha, idx) => {
    try {
      // Ignorar cabeçalho e rodapé TOTVS
      if (linha.startsWith('HDR') || linha.startsWith('TRL') || linha.startsWith('//')) return;

      // Layout TOTVS RM: pos 0-9 matrícula, 10-49 nome, 50-61 sal.bruto, 62-73 sal.líquido
      if (linha.length < 50) { erros.push({ linha: idx + 1, erro: 'Linha muito curta', conteudo: linha.substring(0, 50) }); return; }

      const matricula = linha.substring(0, 10).trim();
      const nome = linha.substring(10, 50).trim();
      const brutoStr = linha.substring(50, 62).trim().replace(',', '.');
      const liquidoStr = linha.substring(62, 74).trim().replace(',', '.') || brutoStr;

      if (!matricula) { erros.push({ linha: idx + 1, erro: 'Matrícula vazia' }); return; }

      const salarioBruto = parseFloat(brutoStr);
      const salarioLiquido = parseFloat(liquidoStr) || salarioBruto * 0.8;

      if (isNaN(salarioBruto) || salarioBruto <= 0) {
        erros.push({ linha: idx + 1, erro: `Salário inválido: "${brutoStr}"`, matricula }); return;
      }

      registros.push({ matricula, nome, salarioBruto, salarioLiquido, origem: 'TOTVS' });
    } catch (e) {
      erros.push({ linha: idx + 1, erro: e.message });
    }
  });

  return { registros, erros, formato: 'TOTVS' };
}

// ─────────────────────────────────────────────
// Parser SAP (CSV com ; separador, encoding ISO-8859-1)
// Layout: PERNR;ENAME;GROSS;NET;COMPANY
// ─────────────────────────────────────────────
function parseSAP(conteudo) {
  const registros = [];
  const erros = [];

  try {
    const rows = parse(conteudo, {
      delimiter: ';',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });

    rows.forEach((row, idx) => {
      try {
        // Mapear colunas SAP (PERNR=matrícula, ENAME=nome, GROSS=bruto, NET=líquido)
        const matricula = String(row.PERNR || row.MATRICULA || row.ID || '').trim();
        const nome = String(row.ENAME || row.NOME || row.NAME || '').trim();
        const brutoStr = String(row.GROSS || row.SALARIO_BRUTO || row.BRUTO || '0').replace(/[R$\s.]/g, '').replace(',', '.');
        const liquidoStr = String(row.NET || row.SALARIO_LIQUIDO || row.LIQUIDO || '0').replace(/[R$\s.]/g, '').replace(',', '.');

        if (!matricula) { erros.push({ linha: idx + 2, erro: 'Matrícula vazia', row }); return; }

        const salarioBruto = parseFloat(brutoStr);
        const salarioLiquido = parseFloat(liquidoStr) || salarioBruto * 0.8;

        if (isNaN(salarioBruto) || salarioBruto <= 0) {
          erros.push({ linha: idx + 2, erro: `Salário bruto inválido: "${brutoStr}"`, matricula }); return;
        }

        registros.push({ matricula, nome, salarioBruto, salarioLiquido, origem: 'SAP' });
      } catch (e) {
        erros.push({ linha: idx + 2, erro: e.message });
      }
    });
  } catch (e) {
    erros.push({ linha: 0, erro: 'Erro ao parsear CSV SAP: ' + e.message });
  }

  return { registros, erros, formato: 'SAP' };
}

// ─────────────────────────────────────────────
// Parser Senior (layout CSV com , separador)
// Layout: CODIGO;NOME;EMPRESA;COMPETENCIA;SALARIO_BRUTO;SALARIO_LIQUIDO
// ─────────────────────────────────────────────
function parseSenior(conteudo) {
  const registros = [];
  const erros = [];

  try {
    const rows = parse(conteudo, {
      delimiter: ',',
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });

    rows.forEach((row, idx) => {
      try {
        const matricula = String(row.CODIGO || row.MATRICULA || '').trim();
        const nome = String(row.NOME || row.FUNCIONARIO || '').trim();
        const brutoStr = String(row.SALARIO_BRUTO || row.BRUTO || row.VLR_BRUTO || '0')
          .replace(/[R$\s]/g, '').replace('.', '').replace(',', '.');
        const liquidoStr = String(row.SALARIO_LIQUIDO || row.LIQUIDO || row.VLR_LIQUIDO || '0')
          .replace(/[R$\s]/g, '').replace('.', '').replace(',', '.');

        if (!matricula) { erros.push({ linha: idx + 2, erro: 'Código vazio', row }); return; }

        const salarioBruto = parseFloat(brutoStr);
        const salarioLiquido = parseFloat(liquidoStr) || salarioBruto * 0.8;

        if (isNaN(salarioBruto) || salarioBruto <= 0) {
          erros.push({ linha: idx + 2, erro: `Salário inválido`, matricula }); return;
        }

        registros.push({ matricula, nome, salarioBruto, salarioLiquido, origem: 'SENIOR' });
      } catch (e) {
        erros.push({ linha: idx + 2, erro: e.message });
      }
    });
  } catch (e) {
    erros.push({ linha: 0, erro: 'Erro ao parsear CSV Senior: ' + e.message });
  }

  return { registros, erros, formato: 'SENIOR' };
}

// ─────────────────────────────────────────────
// Parser CNAB 240 - Layout de crédito em conta (FEBRABAN)
// Posição: 0-2 banco, 3-6 lote, 7 tipo, 17-28 matrícula, 33-72 nome, 119-131 valor
// ─────────────────────────────────────────────
function parseCNAB240(conteudo) {
  const linhas = conteudo.split('\n').filter(l => l.length >= 240);
  const registros = [];
  const erros = [];

  linhas.forEach((linha, idx) => {
    const tipoSegmento = linha.charAt(7);
    // Segmento A = dados principais do funcionário
    if (tipoSegmento !== 'A' && tipoSegmento !== '3') return;

    try {
      const matricula = linha.substring(17, 29).trim();
      const nome = linha.substring(33, 73).trim();
      const valorStr = linha.substring(119, 132).trim();

      if (!matricula || !nome) return;

      const valor = parseFloat(valorStr) / 100; // CNAB usa centavos
      if (isNaN(valor) || valor <= 0) { erros.push({ linha: idx + 1, erro: 'Valor inválido', matricula }); return; }

      registros.push({ matricula, nome, salarioBruto: valor, salarioLiquido: valor * 0.8, origem: 'CNAB240' });
    } catch (e) {
      erros.push({ linha: idx + 1, erro: e.message });
    }
  });

  return { registros, erros, formato: 'CNAB240' };
}

// ─────────────────────────────────────────────
// Parser CNAB 400 - Retorno bancário (FEBRABAN)
// ─────────────────────────────────────────────
function parseCNAB400(conteudo) {
  const linhas = conteudo.split('\n').filter(l => l.length >= 400);
  const registros = [];
  const erros = [];

  linhas.forEach((linha, idx) => {
    const tipoRegistro = linha.charAt(0);
    if (tipoRegistro !== '1') return; // Apenas registros de detalhe

    try {
      const matricula = linha.substring(62, 74).trim();
      const nome = linha.substring(74, 109).trim();
      const valorStr = linha.substring(152, 165).trim();

      if (!matricula) return;

      const valor = parseFloat(valorStr) / 100;
      if (isNaN(valor) || valor <= 0) { erros.push({ linha: idx + 1, erro: 'Valor inválido', matricula }); return; }

      registros.push({ matricula, nome, salarioBruto: valor, salarioLiquido: valor * 0.8, origem: 'CNAB400' });
    } catch (e) {
      erros.push({ linha: idx + 1, erro: e.message });
    }
  });

  return { registros, erros, formato: 'CNAB400' };
}

// ─────────────────────────────────────────────
// Parser CSV Genérico / XLSX
// ─────────────────────────────────────────────
function parseCSVGenerico(conteudo) {
  const registros = [];
  const erros = [];

  try {
    // Detectar delimitador automaticamente
    const primLinha = conteudo.split('\n')[0];
    const delim = primLinha.includes(';') ? ';' : primLinha.includes('\t') ? '\t' : ',';

    const rows = parse(conteudo, {
      delimiter: delim,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });

    rows.forEach((row, idx) => {
      try {
        // Tentativa de mapeamento flexível de colunas
        const keys = Object.keys(row).map(k => k.toUpperCase());
        const get = (...names) => {
          for (const n of names) {
            const key = Object.keys(row).find(k => k.toUpperCase().includes(n.toUpperCase()));
            if (key && row[key]) return String(row[key]).trim();
          }
          return '';
        };

        const matricula = get('MAT', 'CODIGO', 'ID', 'PERNR', 'CHAPA', 'RE');
        const nome = get('NOME', 'NAME', 'ENAME', 'FUNCIONARIO', 'COLABORADOR');
        const brutoStr = get('BRUTO', 'GROSS', 'SAL_BRUTO', 'SALARIO_B', 'SALBRUTO').replace(/[R$.\s]/g, '').replace(',', '.');
        const liquidoStr = get('LIQUIDO', 'NET', 'SAL_LIQ', 'SALARIO_L', 'SALLIQUIDO').replace(/[R$.\s]/g, '').replace(',', '.');

        if (!matricula) return;

        const salarioBruto = parseFloat(brutoStr);
        const salarioLiquido = parseFloat(liquidoStr) || salarioBruto * 0.8;

        if (isNaN(salarioBruto) || salarioBruto <= 0) {
          erros.push({ linha: idx + 2, erro: `Salário inválido`, matricula }); return;
        }

        registros.push({ matricula, nome, salarioBruto, salarioLiquido, origem: 'CSV' });
      } catch (e) {
        erros.push({ linha: idx + 2, erro: e.message });
      }
    });
  } catch (e) {
    erros.push({ linha: 0, erro: 'Erro ao parsear CSV: ' + e.message });
  }

  return { registros, erros, formato: 'CSV' };
}

// ─────────────────────────────────────────────
// Parser XLSX / Excel
// ─────────────────────────────────────────────
function parseXLSX(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const csv = XLSX.utils.sheet_to_csv(ws);
  const resultado = parseCSVGenerico(csv);
  resultado.formato = 'XLSX';
  return resultado;
}

// ─────────────────────────────────────────────
// Detectar formato automaticamente
// ─────────────────────────────────────────────
function detectarFormato(nomeArquivo, conteudo) {
  const ext = path.extname(nomeArquivo).toLowerCase();
  const primLinha = (conteudo || '').substring(0, 200).toUpperCase();

  if (['.xlsx', '.xls'].includes(ext)) return 'XLSX';
  if (primLinha.includes('TOTVS') || primLinha.includes('HDR') || primLinha.startsWith('001')) return 'TOTVS';
  if (primLinha.includes('PERNR') || primLinha.includes('GROSS') || primLinha.includes('ENAME')) return 'SAP';
  if (primLinha.includes('CODIGO') || primLinha.includes('VLR_BRUTO') || primLinha.includes('VLR_LIQUIDO')) return 'SENIOR';
  if (conteudo && conteudo.split('\n').some(l => l.length >= 240 && l.length <= 244)) return 'CNAB240';
  if (conteudo && conteudo.split('\n').some(l => l.length >= 400 && l.length <= 404)) return 'CNAB400';
  return 'CSV';
}

// ─────────────────────────────────────────────
// Processar importação e atualizar banco de dados
// ─────────────────────────────────────────────
function processarImportacao({ importacaoId, convenioId, competencia, registros, sistema }) {
  const conv = db.prepare('SELECT * FROM convenios WHERE id = ?').get(convenioId);
  if (!conv) throw new Error('Convênio não encontrado');

  let processados = 0;
  let erros = 0;
  const detalhes = [];

  for (const reg of registros) {
    try {
      // Buscar funcionário pela matrícula no convênio
      const func = db.prepare(
        'SELECT * FROM funcionarios WHERE matricula = ? AND convenio_id = ?'
      ).get(reg.matricula, convenioId);

      if (!func) {
        detalhes.push({ matricula: reg.matricula, status: 'NAO_ENCONTRADO', erro: 'Matrícula não cadastrada' });
        erros++;
        continue;
      }

      // Atualizar salário do funcionário
      db.prepare(`
        UPDATE funcionarios
        SET salario_bruto = ?, salario_liquido = ?, atualizado_em = datetime('now')
        WHERE id = ?
      `).run(reg.salarioBruto, reg.salarioLiquido, func.id);

      // Calcular novas margens
      const margens = calcularMargens(reg.salarioBruto, reg.salarioLiquido, {
        emprestimo: conv.percentual_emprestimo,
        cartao: conv.percentual_cartao,
        beneficio: conv.percentual_beneficio
      });

      // Buscar averbações ativas para calcular comprometimento
      const averbsAtivas = db.prepare(`
        SELECT tipo, SUM(valor_parcela) as total
        FROM averbacoes
        WHERE funcionario_id = ? AND status IN ('APROVADA','RESERVADA')
        GROUP BY tipo
      `).all(func.id);

      const comprEmp = averbsAtivas.find(a => a.tipo === 'EMPRESTIMO' || a.tipo === 'REFINANCIAMENTO')?.total || 0;
      const comprCart = averbsAtivas.find(a => a.tipo === 'CARTAO')?.total || 0;
      const comprBenef = averbsAtivas.find(a => a.tipo === 'BENEFICIO')?.total || 0;

      // Upsert na tabela de margens
      const margemExistente = db.prepare(
        'SELECT id FROM margens WHERE funcionario_id = ? AND competencia = ?'
      ).get(func.id, competencia);

      if (margemExistente) {
        db.prepare(`
          UPDATE margens SET
            salario_bruto = ?, salario_liquido = ?,
            margem_total_emprestimo = ?, margem_total_cartao = ?, margem_total_beneficio = ?,
            margem_usada_emprestimo = ?, margem_usada_cartao = ?, margem_usada_beneficio = ?,
            margem_disponivel_emprestimo = ?, margem_disponivel_cartao = ?, margem_disponivel_beneficio = ?,
            atualizado_em = datetime('now')
          WHERE id = ?
        `).run(
          reg.salarioBruto, reg.salarioLiquido,
          margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio,
          comprEmp, comprCart, comprBenef,
          Math.max(0, margens.margemEmprestimo - comprEmp),
          Math.max(0, margens.margemCartao - comprCart),
          Math.max(0, margens.margemBeneficio - comprBenef),
          margemExistente.id
        );
      } else {
        const mId = gerarId();
        db.prepare(`
          INSERT INTO margens (id, funcionario_id, convenio_id, competencia, salario_bruto, salario_liquido,
            margem_total_emprestimo, margem_total_cartao, margem_total_beneficio,
            margem_usada_emprestimo, margem_usada_cartao, margem_usada_beneficio,
            margem_disponivel_emprestimo, margem_disponivel_cartao, margem_disponivel_beneficio)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          mId, func.id, convenioId, competencia,
          reg.salarioBruto, reg.salarioLiquido,
          margens.margemEmprestimo, margens.margemCartao, margens.margemBeneficio,
          comprEmp, comprCart, comprBenef,
          Math.max(0, margens.margemEmprestimo - comprEmp),
          Math.max(0, margens.margemCartao - comprCart),
          Math.max(0, margens.margemBeneficio - comprBenef)
        );
      }

      detalhes.push({
        matricula: reg.matricula,
        nome: func.nome,
        status: 'ATUALIZADO',
        salario_bruto: reg.salarioBruto,
        salario_liquido: reg.salarioLiquido,
        margem_emprestimo: margens.margemEmprestimo,
        margem_disponivel: Math.max(0, margens.margemEmprestimo - comprEmp)
      });
      processados++;
    } catch (e) {
      detalhes.push({ matricula: reg.matricula, status: 'ERRO', erro: e.message });
      erros++;
    }
  }

  // Atualizar status da importação
  db.prepare(`
    UPDATE importacoes_folha
    SET status = ?, total_registros = ?, processados = ?, erros = ?
    WHERE id = ?
  `).run(erros === registros.length ? 'ERRO' : 'CONCLUIDO',
    registros.length, processados, erros, importacaoId);

  return { processados, erros, detalhes };
}

module.exports = {
  parseTOTVS, parseSAP, parseSenior,
  parseCNAB240, parseCNAB400, parseCSVGenerico, parseXLSX,
  detectarFormato, processarImportacao
};
