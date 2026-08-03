# ML Scraper App — pesquisa de concorrentes sem Apify

App irmão do `market-research` original, mas fazendo o próprio scraping
do Mercado Livre com Puppeteer + stealth em vez de pagar por Actors da
Apify. Roda na Vercel, mesma infraestrutura do app original.

## Por que existe

O app original (`market-research`) usa Actors pagos da Apify
(`gio21/mercadolivre-product-detail` e
`karamelo/mercadolivre-scraper-brasil-portugues`), que consomem o
crédito mensal gratuito rápido. Este app faz a mesma coisa por conta
própria — **sem custo de terceiro**, além do que a própria Vercel já
oferece de graça.

## Como foi validado

O Mercado Livre usa um sistema antibot (provavelmente Akamai) que
bloqueia fetch simples (sem navegador) e disfarces fracos, redirecionando
pra uma página de verificação (`/gz/account-verification`). Testado e
confirmado, nessa ordem:

1. ❌ Fetch simples via Node (`fetch()`, sem navegador) → bloqueado
2. ❌ Selenium "puro" (testado em sessão anterior) → sempre deu erro
3. ✅ Puppeteer + `puppeteer-extra-plugin-stealth` completo (testado local,
   IP residencial) → passa direto
4. ❌ Disfarce manual simplificado (só `navigator.webdriver` + alguns
   outros) → **ainda bloqueia**, mesmo com IP residencial — confirma que
   o problema é a força do disfarce, não o IP
5. ✅ **Bundle completo dos 15 disfarces reais do
   `puppeteer-extra-plugin-stealth`**, extraído e embutido como script
   autocontido (`api/_stealth-bundle.js`) — sem depender do pacote em si
   (que tinha problemas de empacotamento na Vercel)

### Por que não usar o pacote `puppeteer-extra-plugin-stealth` direto

Ele carrega várias dependências (`fs-extra`, `merge-deep`, outros plugins)
de forma **dinâmica** (`require(nomeVariavel)`), que o empacotador da
Vercel (Node File Trace) não consegue rastrear automaticamente — resulta
em erros `Cannot find module` em cadeia, um de cada vez.

### Como o bundle foi gerado

Usando a técnica do pacote oficial `extract-stealth-evasions`: cada
evasão do `puppeteer-extra-plugin-stealth` chama
`page.evaluateOnNewDocument(function)` internamente. Interceptamos essa
chamada (sem precisar abrir um navegador de verdade) e concatenamos o
código de todas as evasões num único arquivo JS autocontido, sem nenhum
`require()` — só um script de texto que é injetado na página via
Puppeteer puro. Isso dá a força completa do pacote original sem o
problema de empacotamento.

Se o Mercado Livre reforçar a detecção no futuro e for preciso
regenerar o bundle com uma versão mais nova do pacote de stealth, o
processo (rodado localmente, não na Vercel) é:

```bash
mkdir tmp-extract && cd tmp-extract
npm init -y && npm install puppeteer-extra-plugin-stealth
# (usar o script extrair.js documentado na sessão de desenvolvimento,
#  que itera sobre as pastas em node_modules/puppeteer-extra-plugin-stealth/evasions/
#  chamando onPageCreated() com uma page falsa que captura o script em vez de executar)
```



## Estrutura

```
api/
  _browser.js       — lança o navegador (Chromium serverless na Vercel,
                       Chrome local em dev) com stealth configurado
  _parse.js         — extrai dados do HTML (produto e busca)
  detail.js         — POST { urls: [...] } → detalhe de até 8 produtos
  search.js         — POST { keyword, maxResults } → resultados de busca
  concorrentes.js   — POST { keyword, topN } → busca + enriquece os
                       top N (prioriza orgânicos sobre patrocinados)
                       com vendedor/vendas de cada um
```

## Endpoints

### `POST /api/detail`
```json
{ "urls": ["https://www.mercadolivre.com.br/.../up/MLBU..."] }
```
Retorna `{ items: [...] }` com preço, disponibilidade, categoria,
vendedor, reputação, quantidade vendida, avaliação média.

### `POST /api/search`
```json
{ "keyword": "kit relação cbx 250", "maxResults": 10 }
```
Retorna `{ items: [...] }` com título, preço, desconto, avaliação,
posição no resultado, se é patrocinado, frete grátis — SEM vendedor
nem quantidade vendida (isso só existe na página de cada produto).

### `POST /api/concorrentes` ⭐ (o endpoint principal pra você)
```json
{ "keyword": "kit relação cbx 250", "topN": 3 }
```
Faz a busca, filtra pra priorizar resultados orgânicos (pula
patrocinados quando possível), e abre individualmente os `topN`
melhores colocados pra trazer vendedor, reputação e quantidade
vendida junto com preço e avaliação.

## Deploy na Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

Não precisa configurar nenhuma variável de ambiente — não há token de
API de terceiro.

⚠️ **Atenção ao plano da Vercel**: os endpoints `detail` e
`concorrentes` abrem várias páginas em sequência (podem levar de 15 a
40+ segundos). O `vercel.json` já pede `maxDuration: 60`, mas **o
plano Hobby (grátis) da Vercel pode limitar isso** dependendo da
configuração da sua conta (Fluid Compute precisa estar habilitado
pra funções acima de 10s). Se dor erro de timeout, veja em
Project Settings → Functions se o Fluid Compute está ativo, ou
considere reduzir `topN` pra 2.

## Teste local

Não precisa instalar o Chrome do zero — o script aponta pro Chrome
que você já tem no Mac. Rode:

```bash
npm install
vercel dev
```

E teste com curl:

```bash
curl -X POST http://localhost:3000/api/concorrentes \
  -H "Content-Type: application/json" \
  -d '{"keyword": "kit relação cbx 250", "topN": 3}'
```

Se o Chrome não for encontrado automaticamente, defina o caminho:

```bash
export LOCAL_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Limitações conhecidas

- **Sem garantia contra mudanças no ML**: se o Mercado Livre mudar a
  estrutura do HTML ou reforçar o antibot, o parsing pode quebrar.
  Como não há um serviço terceiro cuidando disso (diferente da
  Apify), a manutenção é sua/nossa.
- **Mais lento que os Actors da Apify** pra buscas com enriquecimento
  (abre página por página, sequencialmente).
- **Sem proxy residencial**: se o volume de uso aumentar muito, pode
  voltar a esbarrar em bloqueios — nesse caso, adicionar um proxy é o
  próximo passo (fica mais barato que o Actor completo, mas não é
  mais grátis).
- **Bloqueio aparenta ser por item, não só por IP**: em testes,
  percebemos que uma URL de produto acessada uma segunda vez em
  sequência (mesmo de IPs diferentes — Vercel e residencial) tende a
  cair na verificação antibot, mesmo quando a primeira vez passou
  limpo. Isso sugere que o Mercado Livre pode estar sinalizando itens
  individuais como "sob suspeita" após acesso automatizado, não só
  bloqueando por reputação de IP. **Mitigação implementada**: cada
  navegação tenta de novo automaticamente uma vez antes de desistir
  (`api/_browser.js`), e o `/api/concorrentes` degrada graciosamente
  — se o enriquecimento de um item falhar, ele mantém os dados que já
  tinha da busca (preço, título, avaliação) em vez de descartar o
  item inteiro. Ainda assim, **evite rodar a mesma busca/URL repetidas
  vezes em sequência** durante testes — no uso real do dia a dia
  (buscas por produtos diferentes) isso tende a não ser um problema.
