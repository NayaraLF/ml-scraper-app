/**
 * concorrentes.js — fluxo completo de "melhores concorrentes":
 *   1. Busca pela palavra-chave e lista candidatos
 *   2. Abre individualmente os top N (config: 3) pra pegar vendedor
 *      e quantidade vendida, que não aparecem na lista de busca
 *
 * Reusa a MESMA instância do navegador entre a busca e os detalhes,
 * só abrindo abas (pages) novas — mais rápido que lançar o navegador
 * várias vezes.
 */
const { launchBrowser, navegarComCuidado } = require('./_browser');
const { parsearPaginaBusca, parsearPaginaProduto } = require('./_parse');

const TOP_N_PADRAO = 3;

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
  const topN = Math.min(Number(body.topN) || TOP_N_PADRAO, 6);

  let browser;
  try {
    browser = await launchBrowser();

    // 1. Busca
    const searchPage = await browser.newPage();
    const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(keyword)}`;
    const { bloqueado: buscaBloqueada, urlFinal: buscaUrlFinal } = await navegarComCuidado(searchPage, searchUrl);
    if (buscaBloqueada) {
      res.status(502).json({ error: 'blocked', message: 'Busca caiu na verificação antibot do ML.', urlFinal: buscaUrlFinal });
      return;
    }
    const searchHtml = await searchPage.content();
    await searchPage.close();

    // Busca uma lista maior e prioriza resultados ORGÂNICOS — os primeiros
    // colocados costumam ser anúncios patrocinados, que não refletem
    // necessariamente quem mais vende de verdade.
    const todosCandidatos = parsearPaginaBusca(searchHtml, 15);
    const organicos = todosCandidatos.filter((c) => !c.patrocinado);
    const patrocinados = todosCandidatos.filter((c) => c.patrocinado);
    const candidatos = [...organicos, ...patrocinados].slice(0, topN);

    if (!candidatos.length) {
      res.status(200).json({ keyword, items: [], aviso: 'Nenhum resultado encontrado na busca.' });
      return;
    }

    // 2. Enriquecimento individual (vendedor, vendas, avaliação detalhada)
    const enriquecidos = [];
    for (const candidato of candidatos) {
      const page = await browser.newPage();
      try {
        const { bloqueado, urlFinal } = await navegarComCuidado(page, candidato.urlProduto);
        if (bloqueado) {
          enriquecidos.push({ ...candidato, enriquecimento: 'blocked', urlFinal });
          continue;
        }
        const html = await page.content();
        const detalhe = parsearPaginaProduto(html, candidato.urlProduto);
        enriquecidos.push({
          ...candidato,
          // dados da página de busca continuam (posição, patrocinado, preço na listagem)
          // dados enriquecidos da página de produto:
          vendedor: detalhe.vendedor,
          reputacaoVendedor: detalhe.reputacaoVendedor,
          quantidadeVendida: detalhe.quantidadeVendida,
          quantidadeAvaliacoes: detalhe.quantidadeAvaliacoes,
          avaliacaoMediaDetalhada: detalhe.avaliacaoMedia,
          precoAtual: detalhe.preco, // preço confirmado na página de produto (mais confiável que a listagem)
          disponivel: detalhe.disponivel,
        });
      } catch (err) {
        enriquecidos.push({ ...candidato, enriquecimento: 'failed', message: err.message });
      } finally {
        await page.close();
      }
    }

    res.status(200).json({ keyword, items: enriquecidos });
  } catch (err) {
    res.status(500).json({ error: 'request_failed', message: err.message });
  } finally {
    if (browser) await browser.close();
  }
};
