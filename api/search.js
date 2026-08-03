const { launchBrowser, navegarComCuidado } = require('./_browser');
const { parsearPaginaBusca } = require('./_parse');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const keyword = (body.keyword || '').trim();
  if (!keyword) {
    res.status(400).json({ error: 'no_keyword' });
    return;
  }
  const maxResults = Math.min(Number(body.maxResults) || 10, 20);

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(keyword)}`;

    const { bloqueado, urlFinal } = await navegarComCuidado(page, url);
    if (bloqueado) {
      res.status(502).json({ error: 'blocked', message: 'Caiu na verificação antibot do ML.', urlFinal });
      return;
    }

    const html = await page.content();
    const resultados = parsearPaginaBusca(html, maxResults);

    res.status(200).json({ keyword, items: resultados });
  } catch (err) {
    res.status(500).json({ error: 'request_failed', message: err.message });
  } finally {
    if (browser) await browser.close();
  }
};
