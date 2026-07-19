import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';

const BASE_URL = 'https://www.francoleiloes.com.br';
const SEARCH_URL = `${BASE_URL}/busca/`;
const PAGE_SIZE = 24;

interface Session { token: string; cookie: string }
interface Photo { Foto: string }
interface RealTime {
  ValorAvaliacao?: number; ValorLanceAtual?: number; ProximoLance?: number; ValorIncremento?: number;
  StatusLeilao?: string; StatusLote?: string; Lote_SubStatus_Label?: string; PracaAtual?: number;
  DataHoraAberturaPrimeiraPraca?: string; DataHoraEncerramentoPrimeiraPraca?: string;
  DataHoraAberturaSegundaPraca?: string; DataHoraEncerramentoSegundaPraca?: string;
  DataHoraAberturaTerceiraPraca?: string; DataHoraEncerramentoTerceiraPraca?: string;
  ValorMinimoLancePrimeiraPraca?: number; ValorMinimoLanceSegundaPraca?: number;
  ValorMinimoLanceTerceiraPraca?: number;
}
interface ApiLot {
  ID_Leilao: number; ID_Leiloes_Lote: number; Leilao: string; CodLeilao: string;
  URLleilao: string; URLlote: string; Lote: string; LoteNumero: string; Categoria: string;
  IconeCategoria: string; LabelModalidade: string; Comitente: string; Comissao: number;
  Cidade: string; UF: string; Lote_CEP: string; Lote_Endereco: string; Lote_Numero: string;
  Lote_Complemento: string; Lote_Bairro: string; Coordenadas: string; Lances: number;
  IsAceitaFinanciamento: boolean; GetValorAvaliacao: number; ValorAvaliacao: number;
  Fotos: Photo[]; GetLoteRealTime: RealTime[];
}
interface ApiResponse { CountTotal: number; PageIndexMax: number; Lotes: ApiLot[] | null }

export class FrancoRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'francoleiloes';
  public readonly source = `${SEARCH_URL}#Engine=Start&Pagina=1&ID_Categoria=55`;
  private session?: Session;

  public constructor(private readonly requestIntervalMs = 750, private readonly categoryId = 55) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const session = await this.getSession();
    const uniqueLots = new Map<number, ApiLot>();
    let index = 1;
    let indexMax = 1;
    let total = 0;
    do {
      const response = await this.search(session, page, index);
      total = response.CountTotal;
      indexMax = Math.max(1, response.PageIndexMax);
      for (const lot of response.Lotes ?? []) uniqueLots.set(lot.ID_Leiloes_Lote, lot);
      index += 1;
      if (index <= indexMax) await sleep(this.requestIntervalMs);
    } while (index <= indexMax);

    const lots = [];
    for (const lot of uniqueLots.values()) {
      const url = absolute(lot.URLlote);
      const detail = await this.detail(session, url);
      lots.push({ url, data: mapLot(lot, detail), classification: 'Imóveis', assetType: 'real_estate' as const });
      await sleep(this.requestIntervalMs);
    }
    return { page, pageSize: PAGE_SIZE, total, hasNext: page * PAGE_SIZE < total, lots };
  }

  private async getSession(): Promise<Session> {
    if (this.session) return this.session;
    const response = await fetch(SEARCH_URL, { headers: headers() });
    if (!response.ok) throw new Error(`Franco search bootstrap failed: HTTP ${response.status}`);
    const html = await response.text();
    const token = /name="__RequestVerificationToken"[^>]+value="([^"]+)"/i.exec(html)?.[1];
    if (!token) throw new Error('Franco request verification token not found');
    const cookie = response.headers.get('set-cookie')?.split(/,(?=\s*[^;,=]+=[^;,]+)/)
      .map((value) => value.split(';', 1)[0]).join('; ') ?? '';
    this.session = { token, cookie };
    return this.session;
  }

  private async search(session: Session, page: number, pageIndex: number): Promise<ApiResponse> {
    const body = {
      RangeValores: 0, Scopo: 0, IgnoreScopo: 0, OrientacaoBusca: 0, Mapa: '', Busca: '',
      ID_Categoria: this.categoryId, ID_Estado: 0, ID_Cidade: 0, Bairro: '', ID_Regiao: 0,
      ValorMinSelecionado: 0, ValorMaxSelecionado: 0, CFGs: '', Pagina: page, sInL: '',
      Ordem: 0, OrdSt: 0, QtdPorPagina: PAGE_SIZE, SubStatus: [], ID_Leiloes_Status: [],
      PaginaIndex: pageIndex, BuscaProcesso: '', NomesPartes: '', CodLeilao: '', TiposLeiloes: [],
      PracaAtual: 0, DataAbertura: '', DataEncerramento: '', Filtro: {},
    };
    const response = await fetch(`${BASE_URL}/ApiEngine/GetBusca/${page}/${pageIndex}/0`, {
      method: 'POST', body: JSON.stringify(body), headers: {
        ...headers(), 'Content-Type': 'application/json; charset=utf-8',
        RequestVerificationToken: session.token, 'X-Requested-With': 'XMLHttpRequest',
        Cookie: session.cookie, Referer: SEARCH_URL,
      },
    });
    if (!response.ok) throw new Error(`Franco search failed: HTTP ${response.status}`);
    return response.json() as Promise<ApiResponse>;
  }

  private async detail(session: Session, url: string): Promise<{ images: string[]; documents: NonNullable<LotData['documents']>; description: string }> {
    const response = await fetch(url, { headers: { ...headers(), Cookie: session.cookie } });
    if (!response.ok) throw new Error(`Franco lot detail failed: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    // Franco declares UTF-8 in some responses, but the lot detail body is Windows-1252.
    const html = new TextDecoder('windows-1252').decode(bytes);
    const $ = cheerio.load(html);
    const images = unique($('a.dg-lote-img-item[href],a[href*="/imagens/1300x1300/"]')
      .map((_, element) => absolute($(element).attr('href') ?? '')).get().filter(Boolean));
    const documents: NonNullable<LotData['documents']> = [];
    $('#dg-lote-documentos li').each((_, element) => {
      const label = clean($(element).clone().children('a').remove().end().text().replace(/\s+/g, ' ').trim()) || 'Documento';
      const links = $(element).find('a[href]').map((__, anchor) => absolute($(anchor).attr('href') ?? '')).get();
      const url = links.find((link) => /\/download\//i.test(link)) ?? links[0];
      if (url) documents.push({ url, label, documentType: documentType(label) });
    });
    const description = clean($('#dg-lote-descricao .dg-lote-conteudo').text().replace(/\s+/g, ' ').trim());
    return { images, documents, description };
  }
}

function mapLot(lot: ApiLot, detail: { images: string[]; documents: NonNullable<LotData['documents']>; description: string }): LotData {
  const realtime = lot.GetLoteRealTime?.[0] ?? {};
  const dates = [
    realtime.DataHoraEncerramentoTerceiraPraca, realtime.DataHoraEncerramentoSegundaPraca,
    realtime.DataHoraEncerramentoPrimeiraPraca,
  ].map(validDate).filter((value): value is Date => Boolean(value));
  const starts = [realtime.DataHoraAberturaPrimeiraPraca, realtime.DataHoraAberturaSegundaPraca]
    .map(validDate).filter((value): value is Date => Boolean(value));
  const [latitude, longitude] = (lot.Coordenadas ?? '').split(',').map((value) => Number(value.trim()));
  const area = firstNumber(detail.description, /(?:área\s+(?:privativa|útil|total)|com)\s*(?:de\s*)?([\d.,]+)\s*m[²2]/i)
    ?? firstNumber(clean(lot.Lote), /com\s*([\d.,]+)\s*m[²2]/i);
  const usableDescription = detail.description.includes('\uFFFD') ? undefined : detail.description;
  const status = clean(realtime.Lote_SubStatus_Label ?? realtime.StatusLote ?? realtime.StatusLeilao ?? '');
  return {
    title: clean(lot.Lote), currentBid: realtime.ValorLanceAtual ?? 0,
    nextBid: realtime.ProximoLance ?? 0, auctionEnd: dates[0] ?? new Date(),
    ...(starts[0] ? { auctionStart: starts[0] } : {}), city: clean(lot.Cidade), state: lot.UF,
    address: clean([lot.Lote_Endereco, lot.Lote_Numero, lot.Lote_Complemento, lot.Lote_Bairro].filter(Boolean).join(', ')),
    neighborhood: clean(lot.Lote_Bairro), neighborhoodNormalized: normalizeLocation(lot.Lote_Bairro),
    postalCode: lot.Lote_CEP, propertyType: normalizePropertyType(lot),
    ...(/desocupad/i.test(detail.description)
      ? { occupancyStatus: 'desocupado' }
      : /ocupad/i.test(detail.description) ? { occupancyStatus: 'ocupado' } : {}),
    ...(area ? { privateAreaM2: area } : {}),
    ...(Number.isFinite(latitude) ? { latitude } : {}), ...(Number.isFinite(longitude) ? { longitude } : {}),
    acceptsFinancing: lot.IsAceitaFinanciamento, ...(usableDescription ? { observations: usableDescription } : {}),
    lotNumber: clean(lot.LoteNumero), externalCode: String(lot.ID_Leiloes_Lote),
    sourceAnnouncementId: String(lot.ID_Leiloes_Lote), consignor: clean(lot.Comitente),
    saleStatus: status, displayStatus: status, classification: 'Imóveis', assetType: 'real_estate',
    bidCount: lot.Lances, eventName: clean(lot.Leilao), eventExternalCode: lot.CodLeilao,
    eventUrl: absolute(lot.URLleilao), imageUrls: detail.images, documents: detail.documents,
    additionalDetails: {
      modalidade: clean(lot.LabelModalidade), comissaoPercentual: String(lot.Comissao),
      valorAvaliacao: String(lot.GetValorAvaliacao || lot.ValorAvaliacao || realtime.ValorAvaliacao || 0),
      valorMinimoPrimeiraPraca: String(realtime.ValorMinimoLancePrimeiraPraca ?? 0),
      valorMinimoSegundaPraca: String(realtime.ValorMinimoLanceSegundaPraca ?? 0),
      valorMinimoTerceiraPraca: String(realtime.ValorMinimoLanceTerceiraPraca ?? 0),
    },
  };
}

function headers(): Record<string, string> { return { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' }; }
function absolute(path: string): string { return new URL(path, `${BASE_URL}/`).toString(); }
function validDate(value: string | undefined): Date | undefined { if (!value || value.startsWith('1900-01-01')) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date; }
function normalizeLocation(value: string): string { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function normalizePropertyType(lot: ApiLot): string {
  const value = normalizeLocation(`${lot.Lote} ${lot.IconeCategoria}`);
  if (/apartamento|apto\b/.test(value)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(value)) return 'casa';
  if (/terreno|lote\b|urbano/.test(value)) return 'terreno';
  if (/loja|sala|conjunto|comercial/.test(value)) return 'comercial';
  if (/sitio|fazenda|chacara|rural/.test(value)) return 'rural';
  if (/galpao|barracao/.test(value)) return 'galpao';
  return normalizeLocation(lot.IconeCategoria) || 'outro';
}
function firstNumber(text: string, pattern: RegExp): number | undefined { const value = pattern.exec(text)?.[1]?.replace(/\./g, '').replace(',', '.'); const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function documentType(label: string): string { if (/matr[ií]cula/i.test(label)) return 'matricula'; if (/edital/i.test(label)) return 'edital'; if (/condi[cç][oõ]es/i.test(label)) return 'condicoes'; if (/laudo/i.test(label)) return 'laudo'; return 'outro'; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function sleep(ms: number): Promise<void> { return new Promise((done) => setTimeout(done, ms)); }
function clean(value: string): string { if (!/[ÃÂâ]/.test(value)) return value; return Buffer.from([...value].map((character) => character.charCodeAt(0) & 0xff)).toString('utf8'); }
