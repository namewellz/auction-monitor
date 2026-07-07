import * as cheerio from 'cheerio';
import type { AuctionScraper } from '../base/auctionScraper.js';
import { fetchHtml } from '../base/cycleTlsClient.js';
import type { LotData } from '../../types/lot.js';
import { isLeiloFinalSaleStatus } from './leiloStatus.js';
import { hostMatches } from '../../utils/url.js';
import { mapLeiloVehicleDetails, type LeiloVehiclePayload } from './leiloVehicleDetails.js';

interface LeiloState {
  LoteSelecionadoState?: LeiloLot;
}

interface LeiloLot {
  id?: string;
  dataFim?: string | null;
  lelId?: number;
  nome?: string;
  numero?: number;
  tipo?: string;
  descricao?: string;
  situacao?: string;
  dataAlteracao?: string | null;
  dataInicio?: string | null;
  fotosUrls?: string[];
  video?: string | null;
  veiculo?: LeiloVehiclePayload;
  localizacao?: {
    nome?: string;
    cidade?: string;
    estado?: string;
    endereco?: string;
  };
  valor?: {
    minimo?: number;
    valorProposta?: number;
    incremento?: number;
    lance?: {
      valor?: number | null;
      data?: string | null;
      apelido?: string | null;
      quantidade?: number;
    };
    totalDespesas?: number;
    totalAPagar?: number;
    comissaoValorCalculado?: number;
  };
  comitente?: { nome?: string };
  leilao?: { id?: string; nome?: string; data?: string };
}

export class LeiloScraper implements AuctionScraper {
  public readonly site = 'leilo';

  public supports(url: string): boolean {
    return hostMatches(url, ['leilo.com.br']);
  }

  public async scrape(url: string): Promise<LotData> {
    const vehicleId = new URL(url).pathname.split('/').filter(Boolean).at(-1);
    const apiLot = vehicleId ? await fetchDetail(vehicleId) : undefined;
    let html = '';
    let $ = cheerio.load('');
    let lot = apiLot;

    if (!lot) {
      html = await fetchHtml(url, { allowNativeFallback: true });
      $ = cheerio.load(html);
      lot = extractInitialState(html).LoteSelecionadoState;
    }

    if (!lot) {
      throw new Error('Leilo scraper could not find LoteSelecionadoState.');
    }

    const title = lot.nome ?? firstText($, ['h1']);
    const currentBid = lot.valor?.lance?.valor ?? lot.valor?.valorProposta ?? lot.valor?.minimo;
    const increment = lot.valor?.incremento ?? 0;
    const nextBid = currentBid === undefined ? undefined : currentBid + increment;
    const auctionEndRaw = lot.dataFim ?? lot.valor?.lance?.data ?? lot.dataAlteracao ?? lot.leilao?.data;
    const auctionEnd = auctionEndRaw ? new Date(auctionEndRaw) : undefined;
    const city = lot.localizacao?.cidade ?? '';
    const state = lot.localizacao?.estado ?? '';
    const address = lot.localizacao?.endereco ?? lot.localizacao?.nome ?? '';
    const observations = normalizedText(lot.descricao ?? '');
    const origin = lot.veiculo?.retomada;
    const commissionFee = lot.valor?.comissaoValorCalculado;
    const reportedFees = lot.valor?.totalDespesas;
    const otherFees = reportedFees === undefined ? undefined : Math.max(0, reportedFees - (commissionFee ?? 0));
    const finalSale = isLeiloFinalSaleStatus(lot.situacao) && lot.valor?.lance?.valor != null;
    const soldAtRaw = lot.valor?.lance?.data ?? lot.dataAlteracao;
    const soldAt = finalSale && soldAtRaw ? new Date(soldAtRaw) : undefined;

    if (!title || currentBid === undefined || nextBid === undefined || !auctionEnd || Number.isNaN(auctionEnd.getTime())) {
      throw new Error('Leilo scraper could not extract required lot fields from this page.');
    }

    return {
      title,
      currentBid,
      ...(lot.valor?.lance?.apelido ? { bidderAlias: lot.valor.lance.apelido } : {}),
      nextBid,
      auctionEnd,
      city,
      state,
      address,
      yardName: lot.localizacao?.nome ?? 'Leilo',
      ...(observations ? { observations } : {}),
      ...(lot.numero !== undefined ? { lotNumber: String(lot.numero) } : {}),
      ...(lot.lelId !== undefined ? { externalCode: String(lot.lelId) } : {}),
      ...(origin ? { origin } : {}),
      assetType: normalizeAssetType(lot.tipo, url),
      ...(lot.veiculo?.infocarMarca ? { brand: lot.veiculo.infocarMarca } : {}),
      ...(lot.veiculo?.infocarModelo ? { model: lot.veiculo.infocarModelo } : {}),
      ...(lot.veiculo?.anoFabricacao ? { manufactureYear: lot.veiculo.anoFabricacao } : {}),
      ...(lot.veiculo?.anoModelo ? { modelYear: lot.veiculo.anoModelo } : {}),
      ...(lot.veiculo?.km !== undefined ? { mileage: lot.veiculo.km } : {}),
      ...mapLeiloVehicleDetails(lot.veiculo),
      ...(lot.comitente?.nome ? { consignor: lot.comitente.nome } : {}),
      ...(lot.situacao ? { saleStatus: lot.situacao } : {}),
      ...(finalSale ? { finalBid: lot.valor!.lance!.valor! } : {}),
      ...(commissionFee !== undefined ? { commissionFee } : {}),
      ...(otherFees !== undefined ? { otherFees } : {}),
      ...(lot.valor?.totalAPagar !== undefined ? { totalCost: lot.valor.totalAPagar } : {}),
      ...(soldAt && !Number.isNaN(soldAt.getTime()) ? { soldAt } : {}),
      ...(lot.leilao?.nome ? { eventName: lot.leilao.nome } : {}),
      ...(lot.leilao?.id ? { eventExternalCode: lot.leilao.id } : {}),
      ...(lot.dataInicio ? { auctionStart: new Date(lot.dataInicio) } : {}),
      ...(lot.fotosUrls?.length ? { imageUrls: lot.fotosUrls } : {}),
      ...(lot.video ? { videoUrl: lot.video } : {}),
    };
  }
}

function normalizeAssetType(value: string | undefined, url: string): 'car' | 'motorcycle' {
  const source = `${value ?? ''} ${new URL(url).pathname}`
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return source.includes('/motos/') || source.includes('motos') ? 'motorcycle' : 'car';
}

async function fetchDetail(vehicleId: string): Promise<LeiloLot | undefined> {
  try {
    const response = await fetch(`https://api.leilo.com.br/v1/lote/by-id/${encodeURIComponent(vehicleId)}`, {
      headers: {
        Accept: 'application/json', Origin: 'https://leilo.com.br', Referer: 'https://leilo.com.br/',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok ? await response.json() as LeiloLot : undefined;
  } catch {
    return undefined;
  }
}

function extractInitialState(html: string): LeiloState {
  const prefix = 'window.__INITIAL_STATE__=';
  const start = html.indexOf(prefix);
  if (start < 0) {
    throw new Error('Leilo initial state script was not found.');
  }

  const end = html.indexOf('</script>', start);
  if (end < 0) {
    throw new Error('Leilo initial state script is malformed.');
  }

  const script = html.slice(start + prefix.length, end).trim();
  const cleanupStart = script.indexOf(';(function()');
  const raw = (cleanupStart >= 0 ? script.slice(0, cleanupStart) : script).trim().replace(/;$/, '');
  return JSON.parse(raw) as LeiloState;
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const value = normalizedText($(selector).first().text());
    if (value) return value;
  }

  return '';
}

function normalizedText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
