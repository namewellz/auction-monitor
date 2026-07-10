import type { LotData } from '../../types/lot.js';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import { isLeiloFinalSaleStatus } from './leiloStatus.js';
import { mapLeiloVehicleDetails, type LeiloVehiclePayload } from './leiloVehicleDetails.js';

interface LeiloCatalogLot {
  id?: string;
  lelId?: number;
  numero?: number;
  nome?: string;
  tipo?: string;
  situacao?: string;
  dataFim?: string | null;
  dataInicio?: string | null;
  dataAlteracao?: string | null;
  descricao?: string;
  video?: string | null;
  fotosUrls?: string[];
  localizacao?: {
    nome?: string;
    cidade?: string;
    estado?: string;
    endereco?: string;
  };
  veiculo?: LeiloVehiclePayload;
  valor?: {
    minimo?: number;
    valorProposta?: number;
    incremento?: number;
    totalDespesas?: number;
    totalAPagar?: number;
    comissaoValorCalculado?: number;
    lance?: {
      valor?: number | null;
      data?: string | null;
      apelido?: string | null;
    };
  };
  comitente?: { nome?: string };
  leilao?: {
    id?: string;
    nome?: string;
    data?: string;
  };
}

export interface LeiloCatalogPage extends Omit<CatalogPage, 'lots'> {
  lots: Array<{ url: string; data: LotData }>;
}

export type LeiloCatalogType = 'Carros' | 'Motos' | 'Pesados';

const stateNames: Record<string, string> = {
  AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara',
  DF: 'distrito-federal', ES: 'espirito-santo', GO: 'goias', MA: 'maranhao',
  MT: 'mato-grosso', MS: 'mato-grosso-do-sul', MG: 'minas-gerais', PA: 'para',
  PB: 'paraiba', PR: 'parana', PE: 'pernambuco', PI: 'piaui', RJ: 'rio-de-janeiro',
  RN: 'rio-grande-do-norte', RS: 'rio-grande-do-sul', RO: 'rondonia', RR: 'roraima',
  SC: 'santa-catarina', SP: 'sao-paulo', SE: 'sergipe', TO: 'tocantins',
};

export class LeiloCatalogScraper implements CatalogProvider {
  public readonly site = 'leilo';
  public readonly source: string;
  private readonly detailApiUrl: string;

  public constructor(
    private readonly apiUrl = 'https://api.leilo.com.br/v1/lote/busca-elastic',
    private readonly catalogType: LeiloCatalogType = 'Carros',
    private readonly eventId?: string,
  ) {
    this.source = eventId ? `${catalogType.toLowerCase()}:${eventId}` : catalogType.toLowerCase();
    this.detailApiUrl = new URL('/v1/lote/by-id/', apiUrl).toString();
  }

  public async scrapePage(page: number): Promise<LeiloCatalogPage> {
    const pageSize = 30;
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://leilo.com.br',
        Referer: 'https://leilo.com.br/',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        from: (page - 1) * pageSize,
        size: pageSize,
        requisicoesBusca: [
          { campo: 'tipo', tipo: 'exata', label: 'Tipo', valor: this.catalogType },
          ...(this.eventId
            ? [{ campo: 'leilao.id', tipo: 'exata', label: 'Leilão', valor: this.eventId }]
            : []),
        ],
        listaOrdenacao: [{ campo: 'dataFim', tipoCampo: 'long', tipoOrdenacao: 'asc' }],
      }),
    });
    if (!response.ok) throw new Error(`Leilo catalog API failed with status ${response.status}.`);
    const catalogLots = (await response.json()) as LeiloCatalogLot[];
    const lots = await mapWithConcurrency(catalogLots, 6, async (lot) => {
      const detail = lot.veiculo?.id ? await this.fetchDetail(lot.veiculo.id) : undefined;
      const enrichedLot = mergeCatalogAndDetail(lot, detail);
      return { url: buildLotUrl(lot), data: mapCatalogLot(enrichedLot) };
    });

    return {
      page,
      pageSize,
      total: Number(response.headers.get('count')) || lots.length,
      hasNext: page * pageSize < (Number(response.headers.get('count')) || lots.length),
      lots,
    };
  }

  private async fetchDetail(vehicleId: string): Promise<LeiloCatalogLot | undefined> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(new URL(encodeURIComponent(vehicleId), this.detailApiUrl), {
          headers: leiloHeaders(),
          signal: AbortSignal.timeout(20_000),
        });
        if (response.ok) return await response.json() as LeiloCatalogLot;
      } catch {
        // The catalog thumbnails remain usable when a detail request fails temporarily.
      }
    }
    return undefined;
  }
}

function mergeCatalogAndDetail(catalog: LeiloCatalogLot, detail: LeiloCatalogLot | undefined): LeiloCatalogLot {
  if (!detail) return catalog;
  const descricao = detail.descricao ?? catalog.descricao;
  const video = detail.video || catalog.video;
  const fotosUrls = detail.fotosUrls?.length ? detail.fotosUrls : catalog.fotosUrls;
  const situacao = detail.situacao ?? catalog.situacao;
  return {
    ...catalog,
    ...detail,
    dataFim: detail.dataFim ?? catalog.dataFim ?? null,
    dataInicio: detail.dataInicio ?? catalog.dataInicio ?? null,
    dataAlteracao: detail.dataAlteracao ?? catalog.dataAlteracao ?? null,
    ...(situacao ? { situacao } : {}),
    ...(descricao !== undefined ? { descricao } : {}),
    ...(video !== undefined ? { video } : {}),
    ...(fotosUrls !== undefined ? { fotosUrls } : {}),
    localizacao: { ...catalog.localizacao, ...detail.localizacao },
    veiculo: { ...catalog.veiculo, ...detail.veiculo },
    valor: {
      ...catalog.valor,
      ...detail.valor,
      lance: { ...catalog.valor?.lance, ...detail.valor?.lance },
    },
    comitente: { ...catalog.comitente, ...detail.comitente },
    leilao: { ...catalog.leilao, ...detail.leilao },
  };
}

function leiloHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    Origin: 'https://leilo.com.br',
    Referer: 'https://leilo.com.br/',
    'User-Agent': 'Mozilla/5.0',
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item);
    }
  });
  await Promise.all(workers);
  return results;
}

function mapCatalogLot(lot: LeiloCatalogLot): LotData {
  const title = lot.nome?.trim();
  const auctionEndRaw = lot.dataFim ?? lot.valor?.lance?.data ?? lot.dataAlteracao ?? lot.leilao?.data;
  const auctionEnd = auctionEndRaw ? new Date(auctionEndRaw) : undefined;
  const currentBid = lot.valor?.lance?.valor ?? lot.valor?.valorProposta ?? lot.valor?.minimo ?? 0;
  const increment = lot.valor?.incremento ?? 0;
  if (!title || !auctionEnd || Number.isNaN(auctionEnd.getTime())) {
    throw new Error(`Incomplete Leilo catalog lot: ${lot.lelId ?? lot.id ?? 'unknown'}`);
  }

  const commissionFee = lot.valor?.comissaoValorCalculado;
  const reportedFees = lot.valor?.totalDespesas;
  const otherFees = reportedFees === undefined ? undefined : Math.max(0, reportedFees - (commissionFee ?? 0));
  const soldAtRaw = lot.valor?.lance?.data ?? lot.dataAlteracao;
  const finalSale = isLeiloFinalSaleStatus(lot.situacao) && lot.valor?.lance?.valor != null;
  const soldAt = finalSale && soldAtRaw ? new Date(soldAtRaw) : undefined;
  const auctionStart = lot.dataInicio ?? lot.leilao?.data;

  return {
    title,
    currentBid,
    ...(lot.valor?.lance?.apelido ? { bidderAlias: lot.valor.lance.apelido } : {}),
    nextBid: currentBid + increment,
    auctionEnd,
    city: lot.localizacao?.cidade ?? '',
    state: lot.localizacao?.estado ?? '',
    address: lot.localizacao?.endereco ?? lot.localizacao?.nome ?? '',
    ...(lot.localizacao?.nome ? { yardName: lot.localizacao.nome } : {}),
    ...(lot.descricao?.trim() ? { observations: normalizeWhitespace(lot.descricao) } : {}),
    ...(lot.numero !== undefined ? { lotNumber: String(lot.numero) } : {}),
    ...(lot.lelId !== undefined ? { externalCode: String(lot.lelId) } : {}),
    ...(lot.veiculo?.retomada ? { origin: lot.veiculo.retomada } : {}),
    assetType: normalizeAssetType(lot.tipo),
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
    ...(auctionStart ? { auctionStart: new Date(auctionStart) } : {}),
    ...(lot.fotosUrls?.length ? { imageUrls: lot.fotosUrls } : {}),
    ...(lot.video ? { videoUrl: lot.video } : {}),
  };
}

function normalizeAssetType(value: string | undefined): 'car' | 'motorcycle' | 'heavy' {
  const normalized = value?.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() ?? '';
  if (normalized.includes('moto')) return 'motorcycle';
  if (normalized.includes('pesad')) return 'heavy';
  return 'car';
}

function buildLotUrl(lot: LeiloCatalogLot): string {
  const vehicleId = lot.veiculo?.id;
  if (!vehicleId) throw new Error(`Leilo vehicle id missing for lot ${lot.lelId ?? 'unknown'}.`);

  const city = slug(lot.localizacao?.cidade ?? 'local');
  const state = stateNames[lot.localizacao?.estado ?? ''] ?? slug(lot.localizacao?.estado ?? 'estado');
  const type = slug(lot.tipo ?? 'carros');
  const brand = slug(lot.veiculo?.infocarMarca ?? 'veiculo');
  const model = encodeURIComponent(slug(lot.veiculo?.infocarModelo ?? lot.nome ?? 'modelo'));
  const year = lot.veiculo?.anoModelo ?? 0;
  return `https://leilo.com.br/leilao/${city}-${state}/${type}/${brand}/${model}/ano.${year}/${vehicleId}`;
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9()/]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
