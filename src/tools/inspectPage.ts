import * as cheerio from 'cheerio';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npx tsx src/tools/inspectPage.ts <url>');
  process.exit(1);
}

const response = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Accept-Language': 'pt-BR',
  },
});
const html = await response.text();
const $ = cheerio.load(html);

console.log('status=', response.status);
console.log('url=', response.url);
console.log('title=', $('title').text().trim());

$('meta').each((_, element) => {
  const name = $(element).attr('name') ?? $(element).attr('property');
  const content = $(element).attr('content');
  if (name && content && /title|description|price|amount|url|locale/i.test(name)) {
    console.log(`META ${name}= ${content}`);
  }
});

for (const selector of [
  'h1',
  'h2',
  'h3',
  '[class*=bid]',
  '[class*=lance]',
  '[class*=valor]',
  '[class*=price]',
  '[class*=count]',
  '[class*=timer]',
  '[class*=local]',
  '[class*=detail]',
]) {
  const texts = $(selector)
    .slice(0, 30)
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);

  if (texts.length > 0) {
    console.log(`\nSEL ${selector}\n${texts.join('\n---\n').slice(0, 5000)}`);
  }
}

const body = $('body').text().replace(/\s+/g, ' ').trim();
for (const term of [
  'Lance',
  'Atual',
  'Incremento',
  'Próximo',
  'Proximo',
  'Encerra',
  'Encerramento',
  'Fim',
  'Local',
  'BENEVIDES',
  'Código',
  'Codigo',
  'Lote',
  'Procedência',
  'Procedencia',
  'Funcionando',
]) {
  const index = body.toLowerCase().indexOf(term.toLowerCase());
  console.log(`\nTERM ${term} IDX ${index}`);
  if (index >= 0) {
    console.log(body.slice(Math.max(0, index - 300), index + 900));
  }
}

$('script').each((index, element) => {
  const script = $(element).html() ?? '';
  if (/5e5f20dd|lance|valor|encerr|benevides|volkswagen|codigo|lote|__NUXT__|window\./i.test(script)) {
    console.log(`\nSCRIPT ${index}`);
    console.log(script.slice(0, 7000));
  }
});
