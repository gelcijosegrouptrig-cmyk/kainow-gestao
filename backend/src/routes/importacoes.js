const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../database');
const { registrarLog } = require('../utils/auditoria');
const { gerarId, obterIP } = require('../utils/helpers');
const { gerarCompetencia } = require('../services/margemEngine');
const { autenticar, autorizar } = require('../middleware/auth');
const {
  parseTOTVS, parseSAP, parseSenior,
  parseCNAB240, parseCNAB400, parseCSVGenerico, parseXLSX,
  detectarFormato, processarImportacao
} = require('../services/parserFolha');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `folha_${ts}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_MB) || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.csv', '.xlsx', '.xls', '.ret', '.rem'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Extensão não suportada: ${ext}. Use: ${allowed.join(', ')}`));
  }
});

// GET /api/importacoes/historico - Alias para listar importações
router.get('/historico', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const convenioId = req.usuario.convenio_id || req.query.convenio_id;
  let where = '1=1';
  const params = [];
  if (convenioId && req.usuario.perfil === 'RH') {
    where += ' AND i.convenio_id = ?'; params.push(convenioId);
  }
  const lista = db.prepare(`
    SELECT i.*, c.nome as convenio_nome, u.nome as importado_por_nome
    FROM importacoes_folha i
    LEFT JOIN convenios c ON c.id = i.convenio_id
    LEFT JOIN usuarios u ON u.id = i.importado_por
    WHERE ${where}
    ORDER BY i.criado_em DESC LIMIT 20
  `).all(...params);
  res.json({ importacoes: lista });
});

// GET /api/importacoes - Listar importações
router.get('/', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const convenioId = req.usuario.convenio_id || req.query.convenio_id;
  let where = '1=1';
  const params = [];
  if (convenioId && req.usuario.perfil === 'RH') {
    where += ' AND i.convenio_id = ?'; params.push(convenioId);
  }
  const lista = db.prepare(`
    SELECT i.*, c.nome as convenio_nome, u.nome as importado_por_nome
    FROM importacoes_folha i
    LEFT JOIN convenios c ON c.id = i.convenio_id
    LEFT JOIN usuarios u ON u.id = i.importado_por
    WHERE ${where}
    ORDER BY i.criado_em DESC LIMIT 50
  `).all(...params);
  res.json(lista);
});

// POST /api/importacoes/upload - Upload e parse de arquivo
router.post('/upload', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'),
  upload.single('arquivo'), async (req, res) => {
    const { convenio_id, competencia, sistema, processar_imediatamente } = req.body;
    const ip = obterIP(req);

    if (!req.file) return res.status(400).json({ erro: 'Arquivo não enviado' });
    if (!convenio_id) return res.status(400).json({ erro: 'convenio_id obrigatório' });

    const conv = db.prepare('SELECT * FROM convenios WHERE id = ?').get(convenio_id);
    if (!conv) return res.status(404).json({ erro: 'Convênio não encontrado' });

    const comp = competencia || gerarCompetencia();
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let resultado;
    try {
      if (['.xlsx', '.xls'].includes(ext)) {
        resultado = parseXLSX(filePath);
      } else {
        const conteudo = fs.readFileSync(filePath, 'utf8');
        const formato = sistema || detectarFormato(req.file.originalname, conteudo);
        switch (formato.toUpperCase()) {
          case 'TOTVS':    resultado = parseTOTVS(conteudo); break;
          case 'SAP':      resultado = parseSAP(conteudo); break;
          case 'SENIOR':   resultado = parseSenior(conteudo); break;
          case 'CNAB240':  resultado = parseCNAB240(conteudo); break;
          case 'CNAB400':  resultado = parseCNAB400(conteudo); break;
          default:         resultado = parseCSVGenerico(conteudo); break;
        }
      }
    } catch (e) {
      return res.status(422).json({ erro: 'Falha ao ler arquivo: ' + e.message });
    }

    // Criar registro de importação
    const importId = gerarId();
    db.prepare(`
      INSERT INTO importacoes_folha
        (id, convenio_id, competencia, sistema_origem, nome_arquivo, total_registros, status, importado_por)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(importId, convenio_id, comp, resultado.formato,
      req.file.originalname, resultado.registros.length, 'PROCESSANDO', req.usuario.id);

    registrarLog({
      usuario_id: req.usuario.id, usuario_email: req.usuario.email,
      perfil: req.usuario.perfil, ip,
      acao: 'UPLOAD_FOLHA', modulo: 'IMPORTACOES',
      entidade_tipo: 'importacao', entidade_id: importId,
      dados_depois: { arquivo: req.file.originalname, formato: resultado.formato, registros: resultado.registros.length },
      resultado: 'SUCESSO'
    });

    // Se processar_imediatamente, já atualiza margens
    let detalhesProcessamento = null;
    if (processar_imediatamente === 'true' || processar_imediatamente === true) {
      try {
        detalhesProcessamento = processarImportacao({
          importacaoId: importId,
          convenioId: convenio_id,
          competencia: comp,
          registros: resultado.registros,
          sistema: resultado.formato
        });
      } catch (e) {
        db.prepare("UPDATE importacoes_folha SET status='ERRO' WHERE id=?").run(importId);
      }
    } else {
      db.prepare("UPDATE importacoes_folha SET status='CONCLUIDO', processados=?, erros=? WHERE id=?")
        .run(resultado.registros.length, resultado.erros.length, importId);
    }

    res.status(201).json({
      importacao_id: importId,
      formato_detectado: resultado.formato,
      competencia: comp,
      total_lidos: resultado.registros.length,
      erros_parse: resultado.erros.length,
      preview: resultado.registros.slice(0, 5),
      erros_detalhe: resultado.erros.slice(0, 10),
      processamento: detalhesProcessamento,
      mensagem: resultado.registros.length > 0
        ? `${resultado.registros.length} registros lidos com sucesso (${resultado.erros.length} erros de parse)`
        : 'Nenhum registro válido encontrado no arquivo'
    });
  }
);

// POST /api/importacoes/:id/processar - Processar importação previamente carregada
router.post('/:id/processar', autenticar, autorizar('SUPER_ADMIN', 'ADMIN', 'RH'), (req, res) => {
  const imp = db.prepare('SELECT * FROM importacoes_folha WHERE id = ?').get(req.params.id);
  if (!imp) return res.status(404).json({ erro: 'Importação não encontrada' });
  if (imp.status === 'CONCLUIDO') return res.status(409).json({ erro: 'Importação já processada' });

  res.json({ mensagem: 'Use /upload com processar_imediatamente=true para novo upload e processamento automático' });
});

// GET /api/importacoes/template/:formato - Baixar template de arquivo
router.get('/template/:formato', autenticar, (req, res) => {
  const { formato } = req.params;
  const templates = {
    TOTVS: `HDR TOTVS RM FOLHA DE PAGAMENTO\n` +
      `MAT001    ANA PAULA FERREIRA              005800.00004200.00\n` +
      `MAT002    CARLOS EDUARDO LIMA             003200.00002600.00\n` +
      `MAT003    MARIANA COSTA SOUZA             007500.00005800.00\n` +
      `TRL 000003\n`,
    SAP: `PERNR;ENAME;GROSS;NET;COMPANY\n` +
      `MAT001;Ana Paula Ferreira;5800.00;4200.00;Prefeitura SP\n` +
      `MAT002;Carlos Eduardo Lima;3200.00;2600.00;Prefeitura SP\n` +
      `MAT003;Mariana Costa Souza;7500.00;5800.00;Prefeitura SP\n`,
    SENIOR: `CODIGO,NOME,EMPRESA,COMPETENCIA,SALARIO_BRUTO,SALARIO_LIQUIDO\n` +
      `MAT001,Ana Paula Ferreira,Prefeitura SP,2024-01,5800.00,4200.00\n` +
      `MAT002,Carlos Eduardo Lima,Prefeitura SP,2024-01,3200.00,2600.00\n` +
      `MAT003,Mariana Costa Souza,Prefeitura SP,2024-01,7500.00,5800.00\n`,
    CSV: `MATRICULA,NOME,SALARIO_BRUTO,SALARIO_LIQUIDO\n` +
      `MAT001,Ana Paula Ferreira,5800.00,4200.00\n` +
      `MAT002,Carlos Eduardo Lima,3200.00,2600.00\n` +
      `MAT003,Mariana Costa Souza,7500.00,5800.00\n`
  };

  const conteudo = templates[formato.toUpperCase()];
  if (!conteudo) return res.status(404).json({ erro: 'Formato não suportado. Use: TOTVS, SAP, SENIOR, CSV' });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="template_${formato.toLowerCase()}.txt"`);
  res.send(conteudo);
});

module.exports = router;
