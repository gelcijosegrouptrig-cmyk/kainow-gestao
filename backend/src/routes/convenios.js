const express = require('express');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP, validarCNPJ } = require('../utils/helpers');
const { autenticar, autorizar } = require('../middleware/auth');

const router = express.Router();

// GET /api/convenios
router.get('/', autenticar, (req, res) => {
  const convenios = db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM funcionarios f WHERE f.convenio_id = c.id AND f.situacao = 'ATIVO') as total_funcionarios
    FROM convenios c ORDER BY c.nome
  `).all();
  res.json(convenios);
});

// GET /api/convenios/:id
router.get('/:id', autenticar, (req, res) => {
  const conv = db.prepare('SELECT * FROM convenios WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ erro: 'Convênio não encontrado' });
  res.json(conv);
});

// POST /api/convenios
router.post('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { nome, cnpj, tipo, sistema_folha, percentual_emprestimo, percentual_cartao, percentual_beneficio, responsavel, telefone } = req.body;
  const ip = obterIP(req);

  if (!nome || !cnpj || !tipo) {
    return res.status(400).json({ erro: 'Nome, CNPJ e tipo são obrigatórios' });
  }

  const id = gerarId();
  try {
    db.prepare(`
      INSERT INTO convenios (id, nome, cnpj, tipo, sistema_folha, percentual_emprestimo, percentual_cartao, percentual_beneficio, responsavel, telefone)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, nome, cnpj.replace(/\D/g, ''), tipo, sistema_folha || 'MANUAL',
      percentual_emprestimo || 35.0, percentual_cartao || 5.0, percentual_beneficio || 5.0,
      responsavel || null, telefone || null);

    registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'CRIAR_CONVENIO', modulo: 'CONVENIOS', entidade_tipo: 'convenio', entidade_id: id, dados_depois: req.body, resultado: 'SUCESSO' });
    res.status(201).json({ id, mensagem: 'Convênio criado com sucesso' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ erro: 'CNPJ já cadastrado' });
    throw err;
  }
});

// PUT /api/convenios/:id
router.put('/:id', autenticar, autorizar('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  const { nome, tipo, sistema_folha, percentual_emprestimo, percentual_cartao, percentual_beneficio, responsavel, telefone, ativo } = req.body;
  const ip = obterIP(req);

  const antes = db.prepare('SELECT * FROM convenios WHERE id = ?').get(req.params.id);
  if (!antes) return res.status(404).json({ erro: 'Convênio não encontrado' });

  db.prepare(`
    UPDATE convenios SET nome=?, tipo=?, sistema_folha=?, percentual_emprestimo=?, percentual_cartao=?,
    percentual_beneficio=?, responsavel=?, telefone=?, ativo=?, atualizado_em=datetime('now') WHERE id=?
  `).run(nome || antes.nome, tipo || antes.tipo, sistema_folha || antes.sistema_folha,
    percentual_emprestimo ?? antes.percentual_emprestimo, percentual_cartao ?? antes.percentual_cartao,
    percentual_beneficio ?? antes.percentual_beneficio, responsavel || antes.responsavel,
    telefone || antes.telefone, ativo !== undefined ? ativo : antes.ativo, req.params.id);

  registrarLog({ usuario_id: req.usuario.id, usuario_email: req.usuario.email, perfil: req.usuario.perfil, ip, acao: 'ATUALIZAR_CONVENIO', modulo: 'CONVENIOS', entidade_tipo: 'convenio', entidade_id: req.params.id, dados_antes: antes, dados_depois: req.body, resultado: 'SUCESSO' });
  res.json({ mensagem: 'Convênio atualizado com sucesso' });
});

module.exports = router;
