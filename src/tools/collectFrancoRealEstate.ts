import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { ImageOptimizer } from '../services/imageOptimizer.js';

const BASE_URL = 'https://www.francoleiloes.com.br';
const SEARCH_URL = `${BASE_URL}/busca/`;
const DEFAULT_OUTPUT = 'artifacts/franco-real-estate';
const PAGE_SIZE = 24;

interface Options {
  categoryId: number;
  delayMs: number;
  downloadConcurrency: number;
  imageMaxWidth: number;
  imageMaxHeight: number;
  imageQuality: number;
  outputDirectory: string;
}
interface DownloadedAsset {
  label: string; sourceUrl: string; localPath: string; contentType: string;
  sizeBytes: number; sha256: string;
  originalSizeBytes?: number; width?: number; height?: number; optimizationProfile?: string;
}

interface FrancoPhoto { Foto: string; LabelFoto?: string }
interface FrancoRealTime {
  StatusLeilao?: string; StatusLote?: string; Lote_SubStatus_Label?: string;
  ValorAvaliacao?: number; ValorLanceAtual?: number; ProximoLance?: number; ValorIncremento?: number;
  QtdPracas?: number; PracaAtual?: number;
  DataHoraAberturaPrimeiraPraca?: string; DataHoraEncerramentoPrimeiraPraca?: string;
  DataHoraAberturaSegundaPraca?: string; DataHoraEncerramentoSegundaPraca?: string;
  DataHoraAberturaTerceiraPraca?: string; DataHoraEncerramentoTerceiraPraca?: string;
  ValorMinimoLancePrimeiraPraca?: number; ValorMinimoLanceSegundaPraca?: number;
  ValorMinimoLanceTerceiraPraca?: number;
}
interface FrancoLot {
  ID_Leilao: number; ID_Leiloes_Lote: number; Leilao: string; CodLeilao: string;
  URLleilao: string; URLlote: string; Lote: string; LoteNumero: string;
  Categoria: string; IconeCategoria: string; LabelModalidade: string; Comitente: string;
  Comissao: number; ValorAvaliacao: number; GetValorAvaliacao: number;
  Cidade: string; UF: string; Lote_CEP: string; Lote_Endereco: string;
  Lote_Numero: string; Lote_Complemento: string; Lote_Bairro: string;
  Coordenadas: string; Visitas: number; Habilitacoes: number; Lances: number;
  Propostas: number; IsAceitaFinanciamento: boolean; IsEncerrado: boolean;
  Fotos: FrancoPhoto[]; GetLoteRealTime: FrancoRealTime[];
}
interface SearchResponse {
  CountTotal: number; PageIndexMax: number; Lotes: FrancoLot[] | null;
}
interface ExportedLot {
  source: 'francoleiloes.com.br'; collectedAt: string; lotId: number; auctionId: number;
  auctionCode: string; lotNumber: string; title: string; category: string;
  subcategory: string; modality: string; seller: string; commissionPercent: number;
  appraisalValue: number; currentBid: number; nextBid: number; bidIncrement: number;
  status: string; auctionStatus: string; currentRound: number; roundCount: number;
  firstRoundStartsAt: string | null; firstRoundEndsAt: string | null;
  firstRoundMinimumValue: number; secondRoundStartsAt: string | null;
  secondRoundEndsAt: string | null; secondRoundMinimumValue: number;
  thirdRoundStartsAt: string | null; thirdRoundEndsAt: string | null;
  thirdRoundMinimumValue: number; acceptsFinancing: boolean; city: string; state: string;
  postalCode: string; address: string; coordinates: string; views: number;
  registrations: number; bids: number; proposals: number; aggregatorUrl: string;
  originalUrl: string; auctionUrl: string; imageUrls: string[];
  photos: DownloadedAsset[]; documents: DownloadedAsset[]; assetCollectionComplete: boolean;
}

await run(parseArguments(process.argv.slice(2)));

async function run(options: Options): Promise<void> {
  const outputDirectory = resolve(options.outputDirectory);
  const imageOptimizer = new ImageOptimizer(options.imageMaxWidth, options.imageMaxHeight, options.imageQuality);
  await mkdir(outputDirectory, { recursive: true });
  const session = await createSession();
  const lots = new Map<number, FrancoLot>();

  let page = 1;
  let countTotal = 0;
  do {
    let pageIndex = 1;
    let pageIndexMax = 1;
    do {
      const response = await search(session, options.categoryId, page, pageIndex);
      countTotal = response.CountTotal;
      pageIndexMax = Math.max(1, response.PageIndexMax);
      for (const lot of response.Lotes ?? []) lots.set(lot.ID_Leiloes_Lote, lot);
      console.log(`Página ${page}, bloco ${pageIndex}/${pageIndexMax}: ${lots.size}/${countTotal} lotes únicos`);
      pageIndex += 1;
      if (pageIndex <= pageIndexMax) await sleep(options.delayMs);
    } while (pageIndex <= pageIndexMax);
    page += 1;
    if (lots.size < countTotal) await sleep(options.delayMs);
  } while (lots.size < countTotal);

  const collectedAt = new Date().toISOString();
  const exported = [...lots.values()].map((lot) => exportLot(lot, collectedAt));
  exported.sort((left, right) => left.lotId - right.lotId);
  const checkpointFile = resolve(outputDirectory, 'lots.partial.json');
  const checkpoint = await readJsonIfExists<ExportedLot[]>(checkpointFile, []);
  const checkpointById = new Map(checkpoint.map((lot) => [lot.lotId, lot]));
  for (const lot of exported) {
    const saved = checkpointById.get(lot.lotId);
    if (saved?.assetCollectionComplete && saved.photos.every((photo) => photo.optimizationProfile === imageOptimizer.profile)) {
      Object.assign(lot, saved, { collectedAt });
    }
  }
  for (const [index, lot] of exported.entries()) {
    if (lot.assetCollectionComplete) {
      console.log(`Arquivos ${index + 1}/${exported.length}: lote ${lot.lotId} recuperado do checkpoint`);
      continue;
    }
    if (index > 0) await sleep(options.delayMs);
    await enrichAndDownloadAssets(lot, session, outputDirectory, options.downloadConcurrency, imageOptimizer);
    lot.assetCollectionComplete = true;
    await writeFile(checkpointFile, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
    console.log(`Arquivos ${index + 1}/${exported.length}: lote ${lot.lotId}, ${lot.photos.length} fotos e ${lot.documents.length} documentos`);
  }
  await writeFile(resolve(outputDirectory, 'lots.raw.json'), `${JSON.stringify([...lots.values()], null, 2)}\n`, 'utf8');
  await writeFile(resolve(outputDirectory, 'lots.json'), `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
  await writeFile(resolve(outputDirectory, 'lots.csv'), toCsv(exported), 'utf8');

  const stateCountMap = new Map<string, number>();
  for (const lot of exported) stateCountMap.set(lot.state, (stateCountMap.get(lot.state) ?? 0) + 1);
  const stateCounts = Object.fromEntries(
    [...stateCountMap.entries()].sort((left, right) => right[1] - left[1]),
  );
  await writeFile(resolve(outputDirectory, 'summary.json'), `${JSON.stringify({ collectedAt, categoryId: options.categoryId, expected: countTotal, extracted: exported.length, stateCounts }, null, 2)}\n`, 'utf8');
  console.log(`Concluído: ${exported.length}/${countTotal} anúncios em ${outputDirectory}`);
}

async function createSession(): Promise<{ cookie: string; token: string }> {
  const response = await fetch(SEARCH_URL, { headers: browserHeaders() });
  if (!response.ok) throw new Error(`Falha ao abrir a busca: HTTP ${response.status}`);
  const html = await response.text();
  const token = /name="__RequestVerificationToken"[^>]+value="([^"]+)"/i.exec(html)?.[1];
  if (!token) throw new Error('Token antifalsificação não encontrado na página de busca.');
  const cookie = response.headers.get('set-cookie')
    ?.split(/,(?=\s*[^;,=]+=[^;,]+)/)
    .map((value) => value.split(';', 1)[0])
    .join('; ') ?? '';
  return { cookie, token };
}

async function search(session: { cookie: string; token: string }, categoryId: number, page: number, pageIndex: number): Promise<SearchResponse> {
  const body = {
    RangeValores: 0, Scopo: 0, IgnoreScopo: 0, OrientacaoBusca: 0, Mapa: '', Busca: '',
    ID_Categoria: categoryId, ID_Estado: 0, ID_Cidade: 0, Bairro: '', ID_Regiao: 0,
    ValorMinSelecionado: 0, ValorMaxSelecionado: 0, CFGs: '', Pagina: page, sInL: '',
    Ordem: 0, OrdSt: 0, QtdPorPagina: PAGE_SIZE, SubStatus: [], ID_Leiloes_Status: [],
    PaginaIndex: pageIndex, BuscaProcesso: '', NomesPartes: '', CodLeilao: '',
    TiposLeiloes: [], PracaAtual: 0, DataAbertura: '', DataEncerramento: '', Filtro: {},
  };
  const response = await fetch(`${BASE_URL}/ApiEngine/GetBusca/${page}/${pageIndex}/0`, {
    method: 'POST',
    headers: {
      ...browserHeaders(), 'Content-Type': 'application/json; charset=utf-8',
      'RequestVerificationToken': session.token, 'X-Requested-With': 'XMLHttpRequest',
      Cookie: session.cookie, Referer: SEARCH_URL,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Busca falhou na página ${page}, bloco ${pageIndex}: HTTP ${response.status}`);
  return response.json() as Promise<SearchResponse>;
}

function exportLot(lot: FrancoLot, collectedAt: string): ExportedLot {
  const realtime = lot.GetLoteRealTime?.[0] ?? {};
  const absolute = (path: string): string => new URL(path, `${BASE_URL}/`).toString();
  return {
    source: 'francoleiloes.com.br', collectedAt, lotId: lot.ID_Leiloes_Lote,
    auctionId: lot.ID_Leilao, auctionCode: lot.CodLeilao, lotNumber: cleanText(lot.LoteNumero),
    title: cleanText(lot.Lote), category: cleanText(lot.Categoria), subcategory: cleanText(lot.IconeCategoria),
    modality: cleanText(lot.LabelModalidade), seller: cleanText(lot.Comitente), commissionPercent: lot.Comissao,
    appraisalValue: lot.GetValorAvaliacao || lot.ValorAvaliacao || realtime.ValorAvaliacao || 0,
    currentBid: realtime.ValorLanceAtual ?? 0, nextBid: realtime.ProximoLance ?? 0,
    bidIncrement: realtime.ValorIncremento ?? 0,
    status: cleanText(realtime.Lote_SubStatus_Label ?? realtime.StatusLote ?? ''),
    auctionStatus: cleanText(realtime.StatusLeilao ?? ''), currentRound: realtime.PracaAtual ?? 0,
    roundCount: realtime.QtdPracas ?? 0,
    firstRoundStartsAt: dateOrNull(realtime.DataHoraAberturaPrimeiraPraca),
    firstRoundEndsAt: dateOrNull(realtime.DataHoraEncerramentoPrimeiraPraca),
    firstRoundMinimumValue: realtime.ValorMinimoLancePrimeiraPraca ?? 0,
    secondRoundStartsAt: dateOrNull(realtime.DataHoraAberturaSegundaPraca),
    secondRoundEndsAt: dateOrNull(realtime.DataHoraEncerramentoSegundaPraca),
    secondRoundMinimumValue: realtime.ValorMinimoLanceSegundaPraca ?? 0,
    thirdRoundStartsAt: dateOrNull(realtime.DataHoraAberturaTerceiraPraca),
    thirdRoundEndsAt: dateOrNull(realtime.DataHoraEncerramentoTerceiraPraca),
    thirdRoundMinimumValue: realtime.ValorMinimoLanceTerceiraPraca ?? 0,
    acceptsFinancing: lot.IsAceitaFinanciamento, city: cleanText(lot.Cidade), state: lot.UF,
    postalCode: lot.Lote_CEP,
    address: cleanText([lot.Lote_Endereco, lot.Lote_Numero, lot.Lote_Complemento, lot.Lote_Bairro].filter(Boolean).join(', ')),
    coordinates: lot.Coordenadas, views: lot.Visitas, registrations: lot.Habilitacoes,
    bids: lot.Lances, proposals: lot.Propostas,
    aggregatorUrl: '', originalUrl: absolute(lot.URLlote), auctionUrl: absolute(lot.URLleilao),
    imageUrls: [], photos: [], documents: [], assetCollectionComplete: false,
  };
}

async function enrichAndDownloadAssets(lot: ExportedLot, session: { cookie: string }, outputDirectory: string, concurrency: number, imageOptimizer: ImageOptimizer): Promise<void> {
  const response = await fetch(lot.originalUrl, { headers: { ...browserHeaders(), Cookie: session.cookie } });
  if (!response.ok) throw new Error(`Falha ao abrir o lote ${lot.lotId}: HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const photoUrls = unique(
    $('a.dg-lote-img-item[href], a[href*="/imagens/1300x1300/"]')
      .map((_, element) => absoluteUrl($(element).attr('href'), lot.originalUrl))
      .get()
      .filter((url): url is string => Boolean(url)),
  );
  const documentSources: Array<{ label: string; url: string }> = [];
  $('#dg-lote-documentos li').each((_, element) => {
    const label = cleanText($(element).clone().children('a').remove().end().text().replace(/\s+/g, ' ').trim()) || 'documento';
    const links = $(element).find('a[href]').map((__, anchor) => absoluteUrl($(anchor).attr('href'), lot.originalUrl)).get().filter((url): url is string => Boolean(url));
    const preferred = links.find((url) => /\/download\//i.test(url)) ?? links[0];
    if (preferred) documentSources.push({ label, url: preferred });
  });

  const photoDirectory = resolve(outputDirectory, 'lots', String(lot.lotId), 'photos');
  const documentDirectory = resolve(outputDirectory, 'lots', String(lot.lotId), 'documents');
  await rm(photoDirectory, { recursive: true, force: true });
  await mkdir(photoDirectory, { recursive: true });
  await mkdir(documentDirectory, { recursive: true });

  lot.photos = await mapWithConcurrency(photoUrls, concurrency, async (url, index) =>
    downloadAsset(url, `foto-${String(index + 1).padStart(2, '0')}`, photoDirectory, outputDirectory, session.cookie, `foto-${index + 1}`, imageOptimizer),
  );
  lot.documents = await mapWithConcurrency(uniqueByUrl(documentSources), concurrency, async (document, index) =>
    downloadAsset(document.url, `${String(index + 1).padStart(2, '0')}-${safeName(document.label)}`, documentDirectory, outputDirectory, session.cookie, document.label),
  );
  lot.imageUrls = lot.photos.map((photo) => photo.sourceUrl);
}

async function downloadAsset(url: string, baseName: string, directory: string, outputDirectory: string, cookie: string, label = baseName, imageOptimizer?: ImageOptimizer): Promise<DownloadedAsset> {
  const response = await fetchWithRetry(url, { headers: { ...browserHeaders(), Cookie: cookie, Referer: SEARCH_URL } });
  const originalBytes = Buffer.from(await response.arrayBuffer());
  const originalContentType = response.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream';
  const optimized = imageOptimizer ? await imageOptimizer.optimize(originalBytes) : null;
  const bytes = optimized?.buffer ?? originalBytes;
  const contentType = optimized?.contentType ?? originalContentType;
  const extension = optimized ? '.webp' : extensionFor(url, contentType);
  const localFile = resolve(directory, `${baseName}${extension}`);
  await writeFile(localFile, bytes);
  return {
    label, sourceUrl: url,
    localPath: localFile.slice(resolve(outputDirectory).length + 1).replace(/\\/g, '/'),
    contentType, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...(optimized ? {
      originalSizeBytes: optimized.originalSizeBytes,
      width: optimized.width,
      height: optimized.height,
      optimizationProfile: optimized.profile,
    } : {}),
  };
}
async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      lastStatus = response.status;
      if (response.ok) return response;
      if (![408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(response.status)) break;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    if (attempt < attempts) await sleep(1_000 * 2 ** (attempt - 1));
  }
  throw new Error(`Download falhou após ${attempts} tentativas (${lastStatus}): ${url}`);
}

function dateOrNull(value: string | undefined): string | null {
  return !value || value.startsWith('1900-01-01') ? null : value;
}
function cleanText(value: string): string {
  if (!/[ÃÂâ]/.test(value)) return value;
  const windows1252 = new Map<string, number>([
    ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86],
    ['‡', 0x87], ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c],
    ['Ž', 0x8e], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95],
    ['–', 0x96], ['—', 0x97], ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b],
    ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
  ]);
  const bytes = [...value].map((character) => windows1252.get(character) ?? character.charCodeAt(0));
  return Buffer.from(bytes).toString('utf8');
}
function browserHeaders(): Record<string, string> {
  return { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' };
}
function parseArguments(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith('--')) continue;
    const [key, inline] = argument.split('=', 2);
    if (!key) continue;
    const next = args[index + 1];
    values.set(key, inline ?? (next && !next.startsWith('--') ? next : ''));
    if (!inline && next && !next.startsWith('--')) index += 1;
  }
  return {
    categoryId: positiveInt(values.get('--category'), 55),
    delayMs: positiveInt(values.get('--delay-ms'), 750),
    downloadConcurrency: positiveInt(values.get('--download-concurrency'), 3),
    imageMaxWidth: positiveInt(values.get('--image-max-width') ?? process.env.MEDIA_IMAGE_MAX_WIDTH, 1280),
    imageMaxHeight: positiveInt(values.get('--image-max-height') ?? process.env.MEDIA_IMAGE_MAX_HEIGHT, 960),
    imageQuality: positiveInt(values.get('--image-quality') ?? process.env.MEDIA_IMAGE_QUALITY, 70),
    outputDirectory: values.get('--output') || DEFAULT_OUTPUT,
  };
}
function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Valor inválido: ${value}`);
  return parsed;
}
function toCsv(lots: ExportedLot[]): string {
  const columns: Array<keyof ExportedLot> = ['lotId', 'auctionId', 'auctionCode', 'lotNumber', 'title', 'category', 'subcategory', 'modality', 'seller', 'commissionPercent', 'appraisalValue', 'currentBid', 'nextBid', 'status', 'firstRoundStartsAt', 'firstRoundEndsAt', 'firstRoundMinimumValue', 'secondRoundStartsAt', 'secondRoundEndsAt', 'secondRoundMinimumValue', 'acceptsFinancing', 'city', 'state', 'postalCode', 'address', 'originalUrl', 'auctionUrl', 'photos', 'documents'];
  const rows = [columns.map(String), ...lots.map((lot) => columns.map((column) => Array.isArray(lot[column]) ? String(lot[column].length) : String(lot[column] ?? '')))];
  return `${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')}\n`;
}
function sleep(milliseconds: number): Promise<void> { return new Promise((done) => setTimeout(done, milliseconds)); }
async function readJsonIfExists<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8')) as T; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback; throw error; }
}
function absoluteUrl(value: string | undefined, base: string): string | null {
  if (!value || /^(?:javascript:|#)/i.test(value)) return null;
  try { return new URL(value, base).toString(); } catch { return null; }
}
function unique(values: string[]): string[] { return [...new Set(values)]; }
function uniqueByUrl<T extends { url: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.url, value])).values()];
}
function safeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'documento';
}
function extensionFor(url: string, contentType: string): string {
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/.test(extension)) return extension;
  const known: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  return known[contentType] ?? '.bin';
}
async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
