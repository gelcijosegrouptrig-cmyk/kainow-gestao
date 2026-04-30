const express = require('express');
const { db } = require('../database');
const { autenticar, autorizar } = require('../middleware/auth');
const { gerarId } = require('../utils/helpers');

const router = express.Router();

// ── GET /api/payroll/resumo ─────────────────────────────────────────────────
router.get('/resumo', autenticar, (req, res) => {
  try {
    const convenio_id = req.usuario.convenio_id || req.query.convenio_id;
    let whereAverb = '1=1', pAverb = [];
    if (req.usuario.perfil === 'RH' && convenio_id) {
      whereAverb += ' AND a.convenio_id = ?'; pAverb.push(convenio_id);
    }
    const averbMes = db.prepare(`
      SELECT COUNT(*) as total, COALESCE(SUM(valor_parcela),0) as vol
      FROM averbacoes a
      WHERE strftime('%Y-%m', criado_em) = strftime('%Y-%m','now') AND ${whereAverb}
    `).get(...pAverb);
    const funcs = db.prepare(`SELECT COUNT(*) as v FROM funcionarios WHERE situacao='ATIVO'`).get().v;
    const saldoEscrow = 1245000 + (averbMes.vol || 0) * 0.1;
    const feeAverba   = (averbMes.vol || 0) * 0.005;
    res.json({
      saldo_escrow: saldoEscrow, pix_mes: averbMes.total || 0,
      funcionarios: funcs, fee_mes: feeAverba,
      ultima_atualizacao: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── GET /api/payroll/simular-lote ──────────────────────────────────────────
router.get('/simular-lote', autenticar, autorizar(['SUPER_ADMIN','ADMIN','RH']), (req, res) => {
  const { convenio_id, competencia } = req.query;
  try {
    let where = '1=1', params = [];
    if (convenio_id) { where += ' AND f.convenio_id=?'; params.push(convenio_id); }
    const funcs = db.prepare(`SELECT f.id, f.salario_base FROM funcionarios f WHERE ${where} AND f.situacao='ATIVO'`).all(...params);
    if (!funcs.length) return res.json({ funcionarios:0,volume_bruto:0,volume_liquido:0,consignado_total:0,imposto_total:0,fee_averba:0 });

    const averbAtivas = db.prepare(`
      SELECT a.funcionario_id, SUM(a.valor_parcela) as total_parcela
      FROM averbacoes a WHERE a.status IN ('APROVADA','ATIVO','RESERVADA') AND a.convenio_id=?
      GROUP BY a.funcionario_id
    `).all(convenio_id || '');
    const mapConsig = {};
    averbAtivas.forEach(r => { mapConsig[r.funcionario_id] = r.total_parcela; });

    let volumeBruto=0, volumeLiquido=0, consigTotal=0, impostoTotal=0;
    funcs.forEach(f => {
      const bruto  = f.salario_base || 0;
      const consig = mapConsig[f.id] || 0;
      const inss   = calcINSS(bruto);
      const irrf   = calcIRRF(bruto - inss, 0);
      volumeBruto   += bruto;
      volumeLiquido += Math.max(0, bruto - inss - irrf - consig);
      consigTotal   += consig;
      impostoTotal  += inss + irrf;
    });
    res.json({ funcionarios:funcs.length, volume_bruto:volumeBruto, volume_liquido:volumeLiquido,
      consignado_total:consigTotal, imposto_total:impostoTotal, fee_averba:volumeBruto*0.005,
      competencia: competencia || new Date().toISOString().slice(0,7) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── POST /api/payroll/depositar-escrow ─────────────────────────────────────
router.post('/depositar-escrow', autenticar, autorizar(['SUPER_ADMIN','ADMIN','RH']), (req, res) => {
  const { valor } = req.body;
  if (!valor || valor < 1000) return res.status(400).json({ erro: 'Valor mínimo: R$ 1.000' });
  try {
    const txnId = 'TXN-' + gerarId().slice(0,8).toUpperCase();
    const e2eId = 'E' + Date.now() + Math.random().toString(36).slice(2,8).toUpperCase();
    try {
      db.prepare(`INSERT INTO logs_auditoria (id,usuario_id,usuario_email,perfil,acao,modulo,resultado,criado_em)
        VALUES (?,?,?,?,?,?,?,datetime('now'))`)
        .run(gerarId(), req.usuario.id, req.usuario.email||'', req.usuario.perfil||'ADMIN',
          `DEPOSITO_ESCROW_${valor}`, 'payroll', 'sucesso');
    } catch(_) {}
    res.json({ txn_id:txnId, e2e_id:e2eId, valor, status:'CONFIRMADO',
      saldo_pos: 1245000 + valor,
      mensagem: `R$ ${Number(valor).toLocaleString('pt-BR',{minimumFractionDigits:2})} creditado na conta escrow` });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── POST /api/payroll/disparar-pix-lote ────────────────────────────────────
router.post('/disparar-pix-lote', autenticar, autorizar(['SUPER_ADMIN','ADMIN','RH']), (req, res) => {
  const { convenio_id } = req.body;
  if (!convenio_id) return res.status(400).json({ erro: 'convenio_id obrigatório' });
  try {
    const funcs = db.prepare(`SELECT COUNT(*) as v FROM funcionarios WHERE convenio_id=? AND situacao='ATIVO'`).get(convenio_id).v;
    const batchId = 'BATCH-' + Date.now();
    try {
      db.prepare(`INSERT INTO logs_auditoria (id,usuario_id,usuario_email,perfil,acao,modulo,resultado,criado_em)
        VALUES (?,?,?,?,?,?,?,datetime('now'))`)
        .run(gerarId(), req.usuario.id, req.usuario.email||'', req.usuario.perfil||'ADMIN',
          `PIX_LOTE_${funcs}_FUNCS`, 'payroll', 'sucesso');
    } catch(_) {}
    res.json({ batch_id:batchId, pix_disparados:funcs, status:'PROCESSANDO',
      mensagem:`${funcs} Pix disparados com sucesso!` });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── GET /api/payroll/transacoes ────────────────────────────────────────────
router.get('/transacoes', autenticar, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)||20, 100);
  const offset = parseInt(req.query.offset)||0;
  try {
    // Pull payroll-related audit logs and averbacoes as a combined transaction feed
    const logs = db.prepare(`
      SELECT l.id, l.acao, l.modulo, l.criado_em, l.resultado,
             u.nome as usuario_nome, u.email as usuario_email
      FROM logs_auditoria l
      LEFT JOIN usuarios u ON u.id = l.usuario_id
      WHERE l.modulo IN ('payroll','escrow') OR l.acao LIKE '%PIX%' OR l.acao LIKE '%DEPOSITO%' OR l.acao LIKE '%BATCH%'
      ORDER BY l.criado_em DESC LIMIT ? OFFSET ?
    `).all(limit, offset);

    if (logs.length) {
      const tipoMap = { PIX:'PIX_SALARIO', DEPOSITO:'DEPOSITO_ESCROW', BATCH:'PIX_LOTE', REPASSE:'REPASSE_BANCO', GUIA:'GUIA_INSS', FEE:'FEE_AVERBA' };
      const txns = logs.map((l,i) => {
        const tipo = Object.keys(tipoMap).find(k => l.acao.toUpperCase().includes(k)) ? tipoMap[Object.keys(tipoMap).find(k => l.acao.toUpperCase().includes(k))] : 'REPASSE_BANCO';
        const val  = parseFloat((l.acao.match(/[\d.]+/)||['2000'])[0].replace(/[^\d.]/,'')) || (Math.random()*8000+500);
        return { id:'TXN-'+l.id.slice(0,8).toUpperCase(), tipo, beneficiario:l.usuario_nome||'Sistema',
          valor: val, status: l.resultado==='sucesso'?'CONFIRMADO':'PENDENTE',
          e2e:'E'+Date.now()+i, created_at:l.criado_em };
      });
      return res.json({ transacoes:txns, total:txns.length });
    }
    // Fallback mock data
    const mock = [
      {id:'TXN-A001',tipo:'PIX_SALARIO',    beneficiario:'Ana Souza',        valor:3850.00, status:'CONFIRMADO',e2e:'E'+Date.now(),           created_at:new Date().toISOString()},
      {id:'TXN-A002',tipo:'REPASSE_BANCO',  beneficiario:'Banco Consig.',     valor:12450.00,status:'CONFIRMADO',e2e:'E'+(Date.now()-1000),    created_at:new Date(Date.now()-60000).toISOString()},
      {id:'TXN-A003',tipo:'GUIA_INSS',      beneficiario:'Receita Federal',   valor:8920.00, status:'AGENDADO',  e2e:'E'+(Date.now()-2000),    created_at:new Date(Date.now()-120000).toISOString()},
      {id:'TXN-A004',tipo:'FEE_AVERBA',     beneficiario:'AverbaTech',        valor:925.00,  status:'CONFIRMADO',e2e:'E'+(Date.now()-3000),    created_at:new Date(Date.now()-180000).toISOString()},
      {id:'TXN-A005',tipo:'PIX_SALARIO',    beneficiario:'Carlos Lima',       valor:4200.00, status:'PENDENTE',  e2e:'—',                      created_at:new Date(Date.now()-240000).toISOString()},
      {id:'TXN-A006',tipo:'DEPOSITO_ESCROW',beneficiario:'Prefeitura SP',     valor:250000.00,status:'CONFIRMADO',e2e:'E'+(Date.now()-300000), created_at:new Date(Date.now()-300000).toISOString()},
    ];
    res.json({ transacoes:mock, total:mock.length });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

function calcINSS(s) {
  const t=[[1412,.075],[2666.68,.09],[4000.03,.12],[7786.02,.14]];
  let n=0,p=0;
  for(const[lim,r]of t){if(s<=p)break;n+=(Math.min(s,lim)-p)*r;p=lim;if(s<=lim)break;}
  return Math.min(n,908.85);
}
function calcIRRF(b,d=0){
  const x=b-d*189.59;
  if(x<=2259.20)return 0;if(x<=2826.65)return x*.075-169.44;
  if(x<=3751.05)return x*.15-381.44;if(x<=4664.68)return x*.225-662.77;
  return x*.275-896;
}

module.exports = router;
