/**
 * MOTOR DE CÁLCULO DE MARGEM CONSIGNÁVEL
 * Implementa as regras do Art. 45 da Lei 8.112/90 e Lei 10.820/2003
 */

/**
 * Calcula as margens consignáveis baseado no salário
 * @param {number} salarioBruto
 * @param {number} salarioLiquido
 * @param {object} percentuais - percentuais do convênio
 * @returns {object} margens calculadas
 */
function calcularMargens(salarioBruto, salarioLiquido, percentuais = {}) {
  const pEmprestimo = percentuais.emprestimo || 35.0;
  const pCartao = percentuais.cartao || 5.0;
  const pBeneficio = percentuais.beneficio || 5.0;

  // Base de cálculo: salário líquido (após descontos obrigatórios)
  const base = salarioLiquido > 0 ? salarioLiquido : salarioBruto;

  const margemEmprestimo = parseFloat(((base * pEmprestimo) / 100).toFixed(2));
  const margemCartao = parseFloat(((base * pCartao) / 100).toFixed(2));
  const margemBeneficio = parseFloat(((base * pBeneficio) / 100).toFixed(2));
  const margemTotal = parseFloat((margemEmprestimo + margemCartao + margemBeneficio).toFixed(2));

  return {
    salarioBruto: parseFloat(salarioBruto.toFixed(2)),
    salarioLiquido: parseFloat(base.toFixed(2)),
    percentuais: { pEmprestimo, pCartao, pBeneficio },
    margemEmprestimo,
    margemCartao,
    margemBeneficio,
    margemTotal,
    percentualTotal: parseFloat((pEmprestimo + pCartao + pBeneficio).toFixed(2))
  };
}

/**
 * Verifica se uma parcela cabe na margem disponível
 * @param {number} valorParcela
 * @param {number} margemDisponivel
 * @param {string} tipo - EMPRESTIMO | CARTAO | BENEFICIO
 * @returns {object}
 */
function verificarDisponibilidade(valorParcela, margemDisponivel, tipo = 'EMPRESTIMO') {
  const disponivel = parseFloat(margemDisponivel.toFixed(2));
  const parcela = parseFloat(valorParcela.toFixed(2));

  if (parcela <= 0) {
    return { disponivel: false, motivo: 'Valor da parcela deve ser maior que zero' };
  }
  if (disponivel <= 0) {
    return { disponivel: false, motivo: 'Margem indisponível: sem saldo para ' + tipo };
  }
  if (parcela > disponivel) {
    return {
      disponivel: false,
      motivo: `Parcela R$ ${parcela.toFixed(2)} excede margem disponível R$ ${disponivel.toFixed(2)}`,
      excedente: parseFloat((parcela - disponivel).toFixed(2))
    };
  }
  return {
    disponivel: true,
    margemRestante: parseFloat((disponivel - parcela).toFixed(2)),
    motivo: 'Margem disponível'
  };
}

/**
 * Calcula valor total do contrato
 */
function calcularTotalContrato(valorParcela, prazoMeses, taxaJurosMensal = 0) {
  if (taxaJurosMensal <= 0) {
    return parseFloat((valorParcela * prazoMeses).toFixed(2));
  }
  // Tabela Price
  const taxa = taxaJurosMensal / 100;
  const pv = (valorParcela * (1 - Math.pow(1 + taxa, -prazoMeses))) / taxa;
  return parseFloat((pv).toFixed(2));
}

/**
 * Gera competência no formato YYYY-MM
 */
function gerarCompetencia(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

/**
 * Retorna competência futura N meses à frente
 */
function competenciaFutura(competenciaInicio, prazoMeses) {
  const [ano, mes] = competenciaInicio.split('-').map(Number);
  let novoMes = mes + prazoMeses - 1;
  let novoAno = ano + Math.floor(novoMes / 12);
  novoMes = novoMes % 12 || 12;
  if (novoMes === 0) { novoMes = 12; novoAno--; }
  return `${novoAno}-${String(novoMes).padStart(2, '0')}`;
}

module.exports = {
  calcularMargens,
  verificarDisponibilidade,
  calcularTotalContrato,
  gerarCompetencia,
  competenciaFutura
};
