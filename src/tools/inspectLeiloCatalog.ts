const page = process.argv[2] ?? '2';
const url = `https://leilo.com.br/leilao/carros?pagina=${page}`;

for (const userAgent of ['Mozilla/5.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36']) {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, 'Accept-Language': 'pt-BR' },
    redirect: 'manual',
  });
  const html = await response.text();
  const reportedPage = html.match(/"paginaAtual":(\d+)/)?.[1];
  const firstLot = html.match(/"lotesCompleto":\[\{"id":"([^"]+)/)?.[1];
  console.log(JSON.stringify({ userAgent, status: response.status, location: response.headers.get('location'), reportedPage, firstLot }));
}
