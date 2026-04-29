const { db } = require('../database');

/**
 * Registra log de auditoria - LGPD compliance
 */
function registrarLog({
  usuario_id = null,
  usuario_email = null,
  perfil = null,
  ip = null,
  acao,
  modulo,
  entidade_tipo = null,
  entidade_id = null,
  dados_antes = null,
  dados_depois = null,
  resultado = 'SUCESSO',
  detalhe = null
}) {
  try {
    const stmt = db.prepare(`
      INSERT INTO logs_auditoria 
        (usuario_id, usuario_email, perfil, ip, acao, modulo, entidade_tipo, 
         entidade_id, dados_antes, dados_depois, resultado, detalhe)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    stmt.run(
      usuario_id,
      usuario_email,
      perfil,
      ip,
      acao,
      modulo,
      entidade_tipo,
      entidade_id,
      dados_antes ? JSON.stringify(dados_antes) : null,
      dados_depois ? JSON.stringify(dados_depois) : null,
      resultado,
      detalhe
    );
  } catch (err) {
    console.error('Erro ao registrar auditoria:', err.message);
  }
}

module.exports = { registrarLog };
