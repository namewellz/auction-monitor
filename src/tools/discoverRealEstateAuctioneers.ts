import * as cheerio from 'cheerio';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_URL = 'https://www.leilaoimovel.com.br/encontre-seu-imovel?s=&tipo=2%2C5%2C1%2C6%2C0%2C3&estado=35';
const DEFAULT_OUTPUT = 'artifacts/real-estate-auctioneers-sp';
const AGGREGATOR_HOST = 'www.leilaoimovel.com.br';

interface Options { startUrl: string; outputDirectory: string; delayMs: number; maxPages: number; maxListings: number; resume: boolean }
interface ListingResult {
  aggregatorUrl: string; auctioneerName: string | null; auctioneerUrl: string | null;
  auctioneerDomain: string | null; legalRepresentative: string | null;
  boardRegistration: string | null; collectedAt: string; extractionWarnings: string[];
}
interface AuctioneerSummary {
  auctioneerDomain: string; auctioneerName: string; auctioneerUrl: string;
  legalRepresentatives: string[]; boardRegistrations: string[];
  listingCount: number; aggregatorUrls: string[];
}
class CloudflareBlockedError extends Error {}

await run(parseArguments(process.argv.slice(2)));

async function run(options: Options): Promise<void> {
  const outputDirectory = resolve(options.outputDirectory);
  const urlsFile = resolve(outputDirectory, 'listing-urls.txt');
  const recordsFile = resolve(outputDirectory, 'listings.jsonl');
  await mkdir(outputDirectory, { recursive: true });

  const previous = options.resume ? await readJsonLines<ListingResult>(recordsFile) : [];
  const completedUrls = new Set(previous.map((record) => record.aggregatorUrl));
  console.log(`Descobrindo anúncios a partir de ${options.startUrl}`);
  let listingUrls: string[] = [];
  let blocked = false;
  try {
    listingUrls = await discoverListingUrls(options);
  } catch (error) {
    if (!(error instanceof CloudflareBlockedError)) throw error;
    blocked = true;
    console.error('Cloudflare bloqueou a página de busca. Nenhuma tentativa de contornar a proteção foi feita.');
  }
  await writeFile(urlsFile, listingUrls.length ? `${listingUrls.join('\n')}\n` : '', 'utf8');
  console.log(`${listingUrls.length} URLs salvas em ${urlsFile}`);
  if (!options.resume) await writeFile(recordsFile, '', 'utf8');

  const results = [...previous];
  const pending = listingUrls.filter((url) => !completedUrls.has(url)).slice(0, options.maxListings);
  for (const [index, url] of pending.entries()) {
    if (index > 0) await sleep(options.delayMs);
    try {
      const result = extractListing(url, await fetchPage(url));
      results.push(result);
      await appendFile(recordsFile, `${JSON.stringify(result)}\n`, 'utf8');
      console.log(`[${index + 1}/${pending.length}] ${result.auctioneerDomain ?? result.auctioneerName ?? 'não identificado'}`);
    } catch (error) {
      if (error instanceof CloudflareBlockedError) {
        blocked = true;
        console.error('Cloudflare interrompeu a coleta. O progresso foi preservado; tente novamente com --resume quando o acesso estiver liberado.');
        break;
      }
      console.error(`[${index + 1}/${pending.length}] Falha em ${url}: ${messageOf(error)}`);
    }
  }

  const summaries = summarize(results);
  const jsonFile = resolve(outputDirectory, 'auctioneers.json');
  const csvFile = resolve(outputDirectory, 'auctioneers.csv');
  await writeFile(jsonFile, `${JSON.stringify(summaries, null, 2)}\n`, 'utf8');
  await writeFile(csvFile, toCsv(summaries), 'utf8');
  console.log(`${results.length} anúncios processados; ${summaries.length} domínios identificados.`);
  console.log(`Resumo: ${jsonFile} e ${csvFile}`);
  if (blocked) process.exitCode = 2;
}

async function discoverListingUrls(options: Options): Promise<string[]> {
  const listings = new Set<string>();
  const visited = new Set<string>();
  const queue = [normalizeUrl(options.startUrl)];
  while (queue.length && visited.size < options.maxPages) {
    const pageUrl = queue.shift();
    if (!pageUrl || visited.has(pageUrl)) continue;
    if (visited.size) await sleep(options.delayMs);
    const $ = cheerio.load(await fetchPage(pageUrl));
    visited.add(pageUrl);
    $('a[href]').each((_, element) => {
      const url = absoluteUrl($(element).attr('href'), pageUrl);
      if (!url) return;
      if (isListingUrl(url)) listings.add(url);
      else if (isFilterPageUrl(url, options.startUrl) && !visited.has(url) && !queue.includes(url)) queue.push(url);
    });
    console.log(`Página ${visited.size}: ${listings.size} anúncios encontrados`);
  }
  return [...listings].sort();
}

export function extractListing(aggregatorUrl: string, html: string): ListingResult {
  const $ = cheerio.load(html);
  const text = normalizeText($('body').text());
  const auctioneerName = firstMatch(text, [
    /Leiloeiro\s*:\s*(.+?)(?=\s*\(Ver\s+An[uú]ncio|\s+C[oó]digo\s+Im[oó]vel|\s+Valor\s+de|$)/i,
    /Leiloeiro\s+Oficial\s*:\s*([^.;|]+)/i,
  ]);
  const auctioneerUrl = findAuctioneerUrl($, aggregatorUrl);
  const legalRepresentative = firstMatch(text, [
    /Respons[aá]vel\s+legal\s*:?\s*(.+?)(?=,?\s+leiloeiro|\s+Junta|\s+JUC|[.;]|$)/i,
    /(?:conduzido|responsabilidade)\s+(?:pelo|por)\s+Leiloeiro(?:\s+P[uú]blico)?(?:\s+Oficial)?\s+([^.,;]+)/i,
  ]);
  const boardRegistration = firstMatch(text, [
    /\b(JUC[A-Z]{1,6}\s*(?:n[º°o.]|sob\s+o\s+n[º°o.]?|N[º°o.]?)?\s*[A-Z/-]*\d+[A-Z0-9/.-]*)\b/i,
    /\b(AARC\s*[/.-]?\s*\d+)\b/i,
  ]);
  const warnings: string[] = [];
  if (!auctioneerName) warnings.push('auctioneer_name_not_found');
  if (!auctioneerUrl) warnings.push('auctioneer_url_not_found');
  if (!legalRepresentative) warnings.push('legal_representative_not_found');
  if (!boardRegistration) warnings.push('board_registration_not_found');
  return {
    aggregatorUrl, auctioneerName, auctioneerUrl,
    auctioneerDomain: auctioneerUrl ? domainOf(auctioneerUrl) : null,
    legalRepresentative, boardRegistration, collectedAt: new Date().toISOString(),
    extractionWarnings: warnings,
  };
}

function findAuctioneerUrl($: cheerio.CheerioAPI, pageUrl: string): string | null {
  const candidates: Array<{ url: string; score: number }> = [];
  $('a[href]').each((_, element) => {
    const url = absoluteUrl($(element).attr('href'), pageUrl);
    if (!url || !isExternalHttpUrl(url)) return;
    const label = normalizeText($(element).text());
    const context = normalizeText($(element).parent().text());
    let score = 1;
    if (/ver\s+an[uú]ncio|site\s+do\s+leiloeiro|acesse\s+o\s+leil[aã]o/i.test(label)) score += 10;
    if (/leiloeiro|leil[oõ]es|leil[aã]o/i.test(label)) score += 5;
    if (/leiloeiro|respons[aá]vel\s+legal/i.test(context)) score += 3;
    if (/facebook|instagram|youtube|linkedin|whatsapp|google|maps/i.test(url)) score -= 10;
    candidates.push({ url, score });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url ?? null;
}

function summarize(records: ListingResult[]): AuctioneerSummary[] {
  const grouped = new Map<string, AuctioneerSummary>();
  for (const record of records) {
    if (!record.auctioneerDomain || !record.auctioneerUrl) continue;
    const item = grouped.get(record.auctioneerDomain) ?? {
      auctioneerDomain: record.auctioneerDomain,
      auctioneerName: record.auctioneerName ?? record.auctioneerDomain,
      auctioneerUrl: record.auctioneerUrl,
      legalRepresentatives: [], boardRegistrations: [], listingCount: 0, aggregatorUrls: [],
    };
    item.listingCount += 1;
    item.aggregatorUrls.push(record.aggregatorUrl);
    addUnique(item.legalRepresentatives, record.legalRepresentative);
    addUnique(item.boardRegistrations, record.boardRegistration);
    if (record.auctioneerName && item.auctioneerName === record.auctioneerDomain) item.auctioneerName = record.auctioneerName;
    grouped.set(record.auctioneerDomain, item);
  }
  return [...grouped.values()].sort((a, b) => b.listingCount - a.listingCount);
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitorResearch/1.0; +https://github.com/namewellz/auction-monitor)',
    },
    redirect: 'follow',
  });
  const html = await response.text();
  if (response.status === 403 || /cdn-cgi\/challenge-platform|Just a moment|Enable JavaScript and cookies to continue/i.test(html)) {
    throw new CloudflareBlockedError(`Cloudflare bloqueou ${url}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  return html;
}

function parseArguments(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith('--')) continue;
    const [key, inline] = argument.split('=', 2);
    if (!key) continue;
    const next = args[index + 1];
    values.set(key, inline ?? (next && !next.startsWith('--') ? next : 'true'));
    if (!inline && next && !next.startsWith('--')) index += 1;
  }
  return {
    startUrl: values.get('--url') ?? DEFAULT_URL,
    outputDirectory: values.get('--output') ?? DEFAULT_OUTPUT,
    delayMs: positiveInteger(values.get('--delay-ms'), 2_500),
    maxPages: positiveInteger(values.get('--max-pages'), 500),
    maxListings: positiveInteger(values.get('--max-listings'), Number.MAX_SAFE_INTEGER),
    resume: values.get('--resume') !== 'false',
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Valor inválido: ${value}`);
  return parsed;
}
function isListingUrl(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === AGGREGATOR_HOST && /^\/imovel\/[^/]+\/[^/]+\/.+-imovel-\d+\/?$/i.test(parsed.pathname);
}
function isFilterPageUrl(url: string, startUrl: string): boolean {
  const candidate = new URL(url);
  const start = new URL(startUrl);
  if (candidate.hostname !== AGGREGATOR_HOST || candidate.pathname !== start.pathname || !candidate.searchParams.has('pag')) return false;
  for (const [key, value] of start.searchParams.entries()) {
    if (key !== 'pag' && candidate.searchParams.get(key) !== value) return false;
  }
  return true;
}
function isExternalHttpUrl(url: string): boolean {
  const parsed = new URL(url);
  return /^https?:$/.test(parsed.protocol) && parsed.hostname !== AGGREGATOR_HOST;
}
function absoluteUrl(href: string | undefined, base: string): string | null {
  if (!href || /^(?:javascript:|mailto:|tel:|#)/i.test(href)) return null;
  try { return normalizeUrl(new URL(href, base).toString()); } catch { return null; }
}
function normalizeUrl(url: string): string { const parsed = new URL(url); parsed.hash = ''; return parsed.toString(); }
function domainOf(url: string): string { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
function normalizeText(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) { const value = pattern.exec(text)?.[1]; if (value) return normalizeText(value); }
  return null;
}
function addUnique(values: string[], value: string | null): void { if (value && !values.includes(value)) values.push(value); }
async function readJsonLines<T>(path: string): Promise<T[]> {
  try { return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error; }
}
function toCsv(items: AuctioneerSummary[]): string {
  const rows = [['dominio', 'leiloeiro', 'url_leiloeiro', 'quantidade_imoveis', 'responsaveis_legais', 'registros_junta_comercial', 'urls_agregador']];
  for (const item of items) rows.push([item.auctioneerDomain, item.auctioneerName, item.auctioneerUrl, String(item.listingCount), item.legalRepresentatives.join(' | '), item.boardRegistrations.join(' | '), item.aggregatorUrls.join(' | ')]);
  return `${rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n')}\n`;
}
function sleep(milliseconds: number): Promise<void> { return new Promise((done) => setTimeout(done, milliseconds)); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
