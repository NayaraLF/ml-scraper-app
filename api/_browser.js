/**
 * _browser.js — lança um navegador com disfarces anti-detecção aplicados
 * manualmente (sem o pacote puppeteer-extra-plugin-stealth).
 *
 * Por que não usar o pacote de stealth pronto: ele carrega várias
 * dependências (fs-extra, merge-deep, etc.) de forma DINÂMICA
 * (require(nomeVariavel)), o que o empacotador da Vercel não consegue
 * rastrear automaticamente — resulta em "Cannot find module" em cadeia,
 * um módulo por vez. A solução robusta pra ambiente serverless é aplicar
 * só os disfarces essenciais manualmente via script injetado na página,
 * sem depender do pacote.
 */

const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION
);

const CAMINHOS_CHROME_LOCAL = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  linux: '/usr/bin/google-chrome',
};

// puppeteer-core (nas versões atuais) só existe em formato ESM —
// require() não consegue carregá-lo (erro ERR_REQUIRE_ESM). Usamos
// import() dinâmico, que funciona dentro de um arquivo CommonJS normal
// desde que esteja dentro de uma função async.
async function carregarPuppeteerCore() {
  const mod = await import('puppeteer-core');
  return mod.default;
}

async function carregarChromium() {
  const mod = await import('@sparticuz/chromium');
  return mod.default;
}

async function launchBrowser() {
  const puppeteer = await carregarPuppeteerCore();

  if (isServerless) {
    const chromiumMod = await carregarChromium();
    const executablePath = await chromiumMod.executablePath();
    return puppeteer.launch({
      args: [...chromiumMod.args, '--disable-blink-features=AutomationControlled'],
      executablePath,
      headless: chromiumMod.headless,
      defaultViewport: { width: 1366, height: 900 },
    });
  }

  // Ambiente local (dev): usa o Chrome já instalado no seu computador.
  const executablePath = process.env.LOCAL_CHROME_PATH || CAMINHOS_CHROME_LOCAL[process.platform];
  if (!executablePath) {
    throw new Error(
      'Não encontrei o Chrome local. Defina a variável de ambiente LOCAL_CHROME_PATH ' +
      'apontando pro executável do Chrome instalado no seu sistema.'
    );
  }

  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1366, height: 900 },
  });
}

/**
 * Disfarces anti-detecção — bundle completo extraído do
 * puppeteer-extra-plugin-stealth (15 evasões: navigator.webdriver,
 * chrome.runtime, chrome.app, chrome.csi, chrome.loadTimes,
 * navigator.plugins, navigator.permissions, navigator.languages,
 * navigator.vendor, webgl.vendor, navigator.hardwareConcurrency,
 * window.outerdimensions, iframe.contentWindow, media.codecs, sourceurl).
 * Empacotado como string autocontida (sem require() de terceiros), o que
 * evita o problema de empacotamento da Vercel que o pacote original tinha.
 */
const STEALTH_BUNDLE = require('./_stealth-bundle.js');

async function aplicarStealth(page) {
  await page.evaluateOnNewDocument(STEALTH_BUNDLE);
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
}

const HEADERS_EXTRA = {
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

async function _navegarUmaVez(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 });
  } catch (e) {
    // Sem navegação extra — ok, segue.
  }
  await new Promise((r) => setTimeout(r, 1200));

  const urlFinal = page.url();
  const bloqueado =
    urlFinal.includes('account-verification') ||
    urlFinal.includes('/gz/') ||
    urlFinal.includes('/jms/') || // variante de desafio (ex: tela de login)
    urlFinal.includes('/login');

  return { bloqueado, urlFinal };
}

/**
 * Navega até uma URL cuidando de três problemas conhecidos:
 *  1. A verificação antibot do ML pode redirecionar pra /gz/account-verification
 *     (ou variantes, como uma tela de login)
 *  2. Algumas páginas fazem um redirecionamento client-side logo após carregar
 *     (ex: normalização de URL de busca), o que pode derrubar a leitura do
 *     conteúdo se a gente ler cedo demais
 *  3. O bloqueio às vezes é passageiro — tenta de novo uma vez antes de desistir
 */
async function navegarComCuidado(page, url) {
  await aplicarStealth(page);
  await page.setExtraHTTPHeaders(HEADERS_EXTRA);

  let resultado = await _navegarUmaVez(page, url);
  if (resultado.bloqueado) {
    await new Promise((r) => setTimeout(r, 2500));
    resultado = await _navegarUmaVez(page, url);
  }
  return resultado;
}

module.exports = { launchBrowser, navegarComCuidado, aplicarStealth, isServerless };
