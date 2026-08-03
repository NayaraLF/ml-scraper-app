/**
 * _parse.js — extrai dados estruturados do HTML das páginas do ML.
 * Baseado na estrutura REAL confirmada em páginas capturadas com
 * Puppeteer + stealth (não são seletores adivinhados).
 */

/**
 * Extrai um objeto JSON embutido no HTML a partir de uma chave,
 * balanceando chaves { } pra achar o fim exato do objeto — necessário
 * porque esses blobs não vêm isolados, estão no meio de JS/JSON maior.
 */
function extrairObjetoJson(html, chave) {
  const marcador = `"${chave}":{`;
  const inicio = html.indexOf(marcador);
  if (inicio === -1) return null;

  const inicioObjeto = inicio + marcador.length - 1; // posição do '{'
  let profundidade = 0;
  let fim = -1;

  for (let i = inicioObjeto; i < html.length; i++) {
    if (html[i] === '{') profundidade++;
    else if (html[i] === '}') {
      profundidade--;
      if (profundidade === 0) { fim = i + 1; break; }
    }
  }
  if (fim === -1) return null;

  const trecho = html.slice(inicioObjeto, fim);
  try {
    return JSON.parse(trecho);
  } catch (e) {
    return null;
  }
}

function extrairJsonLd(html) {
  const blocos = [];
  const regex = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      blocos.push(JSON.parse(m[1]));
    } catch (e) {
      // ignora blocos que não parseiam
    }
  }
  return blocos;
}

/**
 * Extrai os dados de uma página de PRODUTO (detalhe).
 */
function parsearPaginaProduto(html, urlOriginal) {
  const jsonLd = extrairJsonLd(html);
  const produtoLd = jsonLd.find((b) => b.offers) || {};

  const itemIdMatch = html.match(/"item_id"\s*:\s*"(MLB\d+)"/);
  const soldMatch = html.match(/"sold_quantity"\s*:\s*(\d+)/);
  const sellerNameMatch = html.match(/"seller_name"\s*:\s*"([^"]+)"/);
  const reputationMatch = html.match(/"reputation_level"\s*:\s*"([^"]+)"/);
  const powerSellerMatch = html.match(/"power_seller_status"\s*:\s*"([^"]+)"/);

  const reviews = extrairObjetoJson(html, 'reviews');

  // Categoria: pega o breadcrumb JSON-LD, se existir
  const breadcrumbLd = jsonLd.find((b) => b['@type'] === 'BreadcrumbList');
  let categoria = null;
  if (breadcrumbLd && Array.isArray(breadcrumbLd.itemListElement)) {
    const ultimo = breadcrumbLd.itemListElement[breadcrumbLd.itemListElement.length - 1];
    categoria = ultimo && ultimo.item ? ultimo.item.name : null;
  }

  return {
    url: urlOriginal,
    itemId: itemIdMatch ? itemIdMatch[1] : null,
    nome: produtoLd.name || null,
    preco: produtoLd.offers ? produtoLd.offers.price : null,
    moeda: produtoLd.offers ? produtoLd.offers.priceCurrency : null,
    disponivel: produtoLd.offers ? produtoLd.offers.availability === 'https://schema.org/InStock' : null,
    freteGratis: produtoLd.offers && produtoLd.offers.shippingDetails
      ? produtoLd.offers.shippingDetails.shippingRate && produtoLd.offers.shippingDetails.shippingRate.value === 0
      : null,
    categoria,
    vendedor: sellerNameMatch ? sellerNameMatch[1] : null,
    reputacaoVendedor: reputationMatch ? reputationMatch[1] : null,
    powerSellerStatus: powerSellerMatch ? powerSellerMatch[1] : null,
    quantidadeVendida: soldMatch ? Number(soldMatch[1]) : null,
    avaliacaoMedia: reviews && typeof reviews.rate === 'number' ? reviews.rate : null,
    quantidadeAvaliacoes: reviews && typeof reviews.count === 'number' ? reviews.count : null,
  };
}

/**
 * Converte um aria-label de preço tipo "169 reais com 06 centavos"
 * ou "239 reais com 90 centavos" em número (169.06).
 * Também aceita "R$ 169,06" como fallback.
 */
function parsearPrecoTexto(texto) {
  if (!texto) return null;
  const matchReais = texto.match(/(\d+)\s*reais?(?:\s*com\s*(\d+)\s*centavos?)?/i);
  if (matchReais) {
    const inteiro = Number(matchReais[1]);
    const centavos = matchReais[2] ? Number(matchReais[2]) : 0;
    return Number((inteiro + centavos / 100).toFixed(2));
  }
  const matchRS = texto.match(/R\$\s?([\d.]+),(\d{2})/);
  if (matchRS) {
    const inteiro = Number(matchRS[1].replace(/\./g, ''));
    const centavos = Number(matchRS[2]);
    return Number((inteiro + centavos / 100).toFixed(2));
  }
  return null;
}

/**
 * Extrai os resultados de uma página de BUSCA.
 * Retorna um array de candidatos (sem enriquecimento de vendedor/vendas —
 * isso é feito depois, abrindo cada página individualmente).
 */
function parsearPaginaBusca(html, maxResultados = 10) {
  const resultados = [];
  const cardRegex = /<li class="ui-search-layout__item"[\s\S]*?(?=<li class="ui-search-layout__item"|<\/ol>|$)/g;
  const cards = html.match(cardRegex) || [];

  for (const card of cards) {
    if (resultados.length >= maxResultados) break;

    const tituloMatch = card.match(/class="poly-component__title"[^>]*>([^<]+)</);
    if (!tituloMatch) continue; // não é um card de produto válido

    const widMatch = card.match(/wid=([A-Za-z0-9]+)/);
    const itemId = widMatch ? widMatch[1] : null;
    if (!itemId) continue;

    const posicaoMatch = card.match(/position=(\d+)/);
    const patrocinado = /is_advertising=true/.test(card);

    // Preço atual: dentro de poly-price__current
    const precoAtualBloco = card.match(/poly-price__current[\s\S]*?aria-label="([^"]+)"/);
    const precoAtual = precoAtualBloco ? parsearPrecoTexto(precoAtualBloco[1]) : null;

    // Preço original (se houver desconto): dentro de poly-price__label
    const precoOriginalBloco = card.match(/poly-price__label[\s\S]*?aria-label="([^"]+)"/);
    const precoOriginal = precoOriginalBloco ? parsearPrecoTexto(precoOriginalBloco[1]) : null;

    const avaliacaoMatch = card.match(/poly-component__review-compacted[\s\S]{0,200}?polylabel-label">([\d.]+)</);
    const freteGratis = /Frete grátis/.test(card);
    const fullMatch = /Enviado pelo FULL/.test(card);

    resultados.push({
      itemId,
      urlProduto: `https://produto.mercadolivre.com.br/${itemId.replace('MLB', 'MLB-')}-x`,
      titulo: tituloMatch[1].trim(),
      posicao: posicaoMatch ? Number(posicaoMatch[1]) : null,
      patrocinado,
      preco: precoAtual,
      precoOriginal: precoOriginal,
      desconto: precoOriginal && precoAtual ? Math.round((1 - precoAtual / precoOriginal) * 100) : null,
      avaliacaoMedia: avaliacaoMatch ? Number(avaliacaoMatch[1]) : null,
      freteGratis,
      enviadoPeloFull: fullMatch,
    });
  }

  return resultados;
}

module.exports = { parsearPaginaProduto, parsearPaginaBusca, parsearPrecoTexto, extrairJsonLd, extrairObjetoJson };
