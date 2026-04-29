const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * Gera código de averbação único e seguro
 * Formato: AVB-YYYYMM-XXXX-XXXX (ex: AVB-202401-A3F2-9B1C)
 */
function gerarCodigoAverbacao(convenioId = '') {
  const now = new Date();
  const ano = now.getFullYear();
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const prefixo = convenioId ? convenioId.substring(0, 3).toUpperCase() : 'AVB';
  const aleatorio = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefixo}-${ano}${mes}-${aleatorio.substring(0, 4)}-${aleatorio.substring(4, 8)}`;
}

/**
 * Gera ID UUID v4
 */
function gerarId() {
  return uuidv4();
}

/**
 * Mascarar CPF para exibição (LGPD)
 */
function mascaraCPF(cpf) {
  if (!cpf) return '***.***.***-**';
  const limpo = cpf.replace(/\D/g, '');
  return `${limpo.substring(0, 3)}.***.***-${limpo.substring(9, 11)}`;
}

/**
 * Formatar CPF para exibição
 */
function formatarCPF(cpf) {
  const limpo = cpf.replace(/\D/g, '');
  return `${limpo.substring(0, 3)}.${limpo.substring(3, 6)}.${limpo.substring(6, 9)}-${limpo.substring(9, 11)}`;
}

/**
 * Validar CPF
 */
function validarCPF(cpf) {
  const limpo = cpf.replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(limpo[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(limpo[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(limpo[10]);
}

/**
 * Validar CNPJ
 */
function validarCNPJ(cnpj) {
  const limpo = cnpj.replace(/\D/g, '');
  if (limpo.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(limpo)) return false;
  const calc = (str, peso) => {
    let soma = 0;
    for (let i = 0; i < str.length; i++) soma += parseInt(str[i]) * peso[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(limpo.substring(0, 12), p1) === parseInt(limpo[12]) &&
    calc(limpo.substring(0, 13), p2) === parseInt(limpo[13]);
}

/**
 * Formatar moeda BRL
 */
function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

/**
 * Obter IP do request
 */
function obterIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'desconhecido';
}

module.exports = {
  gerarCodigoAverbacao,
  gerarId,
  mascaraCPF,
  formatarCPF,
  validarCPF,
  validarCNPJ,
  formatarMoeda,
  obterIP
};
