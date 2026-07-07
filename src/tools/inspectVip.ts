import * as cheerio from 'cheerio';

const lotUrl =
  process.argv[2] ?? 'https://www.vipleiloes.com.br/evento/anuncio/volkswagen-voyage-10l-mc4-188961';
const lotPath = new URL(lotUrl).pathname;
const canalUrl = new URL(`/canal?returnUrl=${encodeURIComponent(lotPath)}`, lotUrl).toString();

const canalResponse = await fetch(canalUrl, { redirect: 'manual' });
const cookie = canalResponse.headers.get('set-cookie')?.split(';')[0] ?? '';
const lotResponse = await fetch(lotUrl, {
  headers: {
    Cookie: cookie,
    'User-Agent': 'Mozilla/5.0',
    'Accept-Language': 'pt-BR',
  },
});

const html = await lotResponse.text();
const $ = cheerio.load(html);

console.log('status=', lotResponse.status);
console.log('title=', $('title').text().trim());
console.log('cookie=', cookie);

for (const selector of [
  'h1',
  'h2',
  'h3',
  '.card',
  '.lote',
  '.titulo',
  '.valor',
  '.detalhe',
  '[class*=lance]',
  '[class*=valor]',
  '[class*=encerr]',
  '[class*=local]',
]) {
  const texts = $(selector)
    .slice(0, 20)
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);

  if (texts.length > 0) {
    console.log(`\nSEL ${selector}\n${texts.join('\n---\n').slice(0, 5000)}`);
  }
}

const body = $('body').text().replace(/\s+/g, ' ').trim();
for (const term of ['Lance', 'Valor', 'Encerramento', 'Patio', 'Pátio', 'Local', 'Voyage', 'VOLKSWAGEN', 'Proximo', 'Próximo', 'Incremento']) {
  const index = body.toLowerCase().indexOf(term.toLowerCase());
  console.log(`\nTERM ${term} IDX ${index}`);
  if (index >= 0) {
    console.log(body.slice(Math.max(0, index - 300), index + 700));
  }
}

$('script').each((index, element) => {
  const script = $(element).html() ?? '';
  if (/188961|1179552|encerr|inicio|leilao|lance|Data|date/i.test(script)) {
    console.log(`\nSCRIPT ${index}`);
    console.log(script.slice(0, 5000));
  }
});
