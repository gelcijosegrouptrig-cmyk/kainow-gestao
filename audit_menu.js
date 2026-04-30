
const { chromium } = require('playwright');

const BASE = 'https://3001-i4i7i743o756tjyp8h57t-18e660f9.sandbox.novita.ai';
const TOKEN = process.argv[2];

const NAV_PAGES = [
  'dashboard','averbacoes','nova-averbacao','funcionarios','convenios','bancos','usuarios',
  'rh-folha','rh-ocorrencias','rh-reservas','rh-desconto',
  'banco-margem','banco-reserva','banco-carteira',
  'auditoria','iso27001','consulta-margem','calculadora',
  'certificados','importacoes','faturamento','integracoes','rh-integracao',
  'banco-convenios','esocial','portabilidade','seguros','cartao-consignado',
  'faturamento-recorrente','score-margem','antecipacao','superendividamento','biometria',
  'nextlevel','open-finance','cashback','leilao','marketplace','parceiros','desligamento',
  'plataforma','camaleao','fgts','carteira-digital','gamificacao','erp','antecipacao-recebiveis',
  'controle','painel-controle',
  'onboarding','payroll','payment-flow','ia-preditiva'
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Load dashboard with token
  await page.goto(BASE + '/dashboard/?t=' + TOKEN, { waitUntil: 'networkidle', timeout: 30000 });
  const title = await page.title();
  console.log('Page title:', title);
  if (!title.includes('Dashboard')) {
    console.log('FAIL: not on dashboard page');
    await browser.close();
    process.exit(1);
  }
  console.log('PASS: Dashboard loaded');

  const results = [];
  for (const pg of NAV_PAGES) {
    try {
      // Click the nav item
      await page.evaluate((p) => {
        if (typeof navTo === 'function') navTo(p);
      }, pg);
      await page.waitForTimeout(800);

      // Check section is visible and has content
      const sectionVisible = await page.evaluate((p) => {
        const sec = document.getElementById('section-' + p);
        if (!sec) return { ok: false, reason: 'section not found' };
        const isActive = sec.classList.contains('active');
        const text = sec.innerText || sec.textContent || '';
        const hasContent = text.trim().length > 50;
        return { ok: isActive && hasContent, active: isActive, textLen: text.trim().length, reason: isActive ? (hasContent ? 'ok' : 'no content') : 'not active' };
      }, pg);

      const status = sectionVisible.ok ? '✅' : '⚠️';
      results.push({ page: pg, ...sectionVisible, status });
      console.log(status + ' ' + pg + ' — ' + sectionVisible.reason + ' (len=' + sectionVisible.textLen + ')');
    } catch(e) {
      results.push({ page: pg, ok: false, reason: 'error: ' + e.message, status: '❌' });
      console.log('❌ ' + pg + ' — ' + e.message);
    }
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log('\n=== SUMMARY ===');
  console.log('PASSED: ' + passed + '/' + NAV_PAGES.length);
  console.log('FAILED: ' + failed);
  if (failed > 0) {
    console.log('ISSUES:');
    results.filter(r => !r.ok).forEach(r => console.log('  - ' + r.page + ': ' + r.reason));
  }

  await browser.close();
})();
