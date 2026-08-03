const { launchBrowser, navegarComCuidado } = require('./_browser');
const { parsearPaginaProduto } = require('./_parse');

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

  const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
  if (!urls.length) {
    res.status(400).json({ error: 'no_urls' });
    return;
  }
  if (urls.length > 8) {
    res.status(400).json({ error: 'too_many_urls', message: 'Máximo de 8 URLs por chamada.' });
    return;
  }

  let browser;
  try {
    browser = await launchBrowser();
    const resultados = [];

    for (const url of urls) {
      const page = await browser.newPage();
      try {
        const { bloqueado, urlFinal } = await navegarComCuidado(page, url);
        if (bloqueado) {
          resultados.push({ url, error: 'blocked', message: 'Caiu na verificação antibot do ML.', urlFinal });
          continue;
        }
        const html = await page.content();
        const dados = parsearPaginaProduto(html, url);
        resultados.push(dados);
      } catch (err) {
        resultados.push({ url, error: 'scrape_failed', message: err.message });
      } finally {
        await page.close();
      }
    }

    res.status(200).json({ items: resultados });
  } catch (err) {
    res.status(500).json({ error: 'request_failed', message: err.message });
  } finally {
    if (browser) await browser.close();
  }
};
