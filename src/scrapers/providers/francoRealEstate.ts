import * as cheerio from 'cheerio';
import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';

const BASE_URL = 'https://www.francoleiloes.com.br';

interface RealTime {
  ID_Leilao?: number;
  ValorLanceAtual?: number;
  ProximoLance?: number;
  ValorIncremento?: number;
  ValorAvaliacao?: number;
  StatusLeilao?: string;
  StatusLote?: string;
  Lote_SubStatus_Label?: string;
  DataHoraAberturaPrimeiraPraca?: string;
  DataHoraEncerramentoPrimeiraPraca?: string;
  DataHoraAberturaSegundaPraca?: string;
  DataHoraEncerramentoSegundaPraca?: string;
  DataHoraAberturaTerceiraPraca?: string;
  DataHoraEncerramentoTerceiraPraca?: string;
  ValorMinimoLancePrimeiraPraca?: number;
  ValorMinimoLanceSegundaPraca?: number;
  ValorMinimoLanceTerceiraPraca?: number;
  CountLancesLTAvista?: number;
  CountLancesLTAPrazo?: number;
  Comissao?: number;
}

interface RealTimeResponse {
  Lotes?: Array<{ ID_Leilao?: number; Comissao?: number; GetLoteRealTime?: RealTime[] }>;
}

export class FrancoRealEstateScraper implements AuctionScraper {
  public readonly site = 'francoleiloes';

  public supports(url: string): boolean {
    return hostMatches(url, ['francoleiloes.com.br']) && /\/lote\//i.test(new URL(url).pathname);
  }

  public async scrape(url: string): Promise<LotData> {
    const page = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) });
    if (!page.ok) throw new Error(`Franco lot page failed: HTTP ${page.status}`);
    const html = new TextDecoder('windows-1252').decode(await page.arrayBuffer());
    const $ = cheerio.load(html);
    const lotId = Number($('#ID_Leiloes_Lote').val());
    if (!Number.isInteger(lotId) || lotId <= 0) throw new Error('Franco lot id was not found');

    const token = $('input[name="__RequestVerificationToken"]').val()?.toString();
    if (!token) throw new Error('Franco request verification token was not found');
    const cookie = page.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
    const realtime = await this.getRealTime(url, lotId, token, cookie);
    const lot = realtime.Lotes?.[0];
    const live = lot?.GetLoteRealTime?.[0];
    if (!live) throw new Error('Franco real-time API returned no lot data');

    const title = clean($('.dg-lote-nome').first().text());
    const description = clean($('#dg-lote-descricao .dg-lote-conteudo').text());
    const address = clean($('#dg-lote-local .dg-lote-local-endereco').text());
    const location = parseLocation(address, title);
    const dates = [
      live.DataHoraEncerramentoTerceiraPraca,
      live.DataHoraEncerramentoSegundaPraca,
      live.DataHoraEncerramentoPrimeiraPraca,
    ].map(validDate).filter((value): value is Date => Boolean(value));
    const auctionStart = validDate(live.DataHoraAberturaPrimeiraPraca);
    const status = clean(live.Lote_SubStatus_Label ?? live.StatusLote ?? live.StatusLeilao ?? '');
    const images = unique($('a.dg-lote-img-item[href],a[href*="/imagens/1300x1300/"]')
      .map((_, element) => absolute($(element).attr('href') ?? '')).get().filter(Boolean));
    const documents: NonNullable<LotData['documents']> = [];
    $('#dg-lote-documentos li').each((_, element) => {
      const label = clean($(element).clone().children('a').remove().end().text()) || 'Documento';
      const links = $(element).find('a[href]').map((__, anchor) => absolute($(anchor).attr('href') ?? '')).get();
      const documentUrl = links.find((link) => /\/download\//i.test(link)) ?? links[0];
      if (documentUrl) documents.push({ url: documentUrl, label, documentType: documentType(label) });
    });
    const code = clean($('.dg-lote-nome-titulo-codigo').text());
    const lotNumber = /LOTE\s*([\w.-]+)/i.exec(code)?.[1];
    const eventCode = /C[oó]d(?:igo)?\s+do\s+leil[aã]o:\s*([^/]+)/i.exec(code)?.[1]?.trim();
    const privateAreaM2 = firstNumber(description, /[áa]rea\s+(?:privativa|útil|total)[^0-9]*([\d.,]+)\s*m[²2]/i);
    const neighborhood = location.neighborhood;

    return {
      title,
      currentBid: live.ValorLanceAtual ?? 0,
      nextBid: live.ProximoLance ?? 0,
      auctionEnd: dates[0] ?? new Date(),
      ...(auctionStart ? { auctionStart } : {}),
      city: location.city,
      state: location.state,
      address,
      ...(neighborhood ? { neighborhood, neighborhoodNormalized: normalize(neighborhood) } : {}),
      ...(description ? { observations: description } : {}),
      ...(privateAreaM2 ? { privateAreaM2 } : {}),
      ...(/desocupad/i.test(description) ? { occupancyStatus: 'desocupado' }
        : /ocupad/i.test(description) ? { occupancyStatus: 'ocupado' } : {}),
      propertyType: propertyType(`${title} ${$('.dg-lote-titulo-categoria').text()}`),
      ...(lotNumber ? { lotNumber } : {}),
      externalCode: String(lotId),
      sourceAnnouncementId: String(lotId),
      saleStatus: status,
      displayStatus: status,
      classification: 'Imóveis',
      assetType: 'real_estate',
      bidCount: (live.CountLancesLTAvista ?? 0) + (live.CountLancesLTAPrazo ?? 0),
      ...(eventCode ? { eventName: `Leilão ${eventCode}`, eventExternalCode: eventCode } : {}),
      imageUrls: images,
      documents,
      ...(live.ValorMinimoLancePrimeiraPraca ? { firstRoundMinimumValue: live.ValorMinimoLancePrimeiraPraca } : {}),
      ...(live.ValorMinimoLanceSegundaPraca ? { secondRoundMinimumValue: live.ValorMinimoLanceSegundaPraca } : {}),
      ...(live.ValorMinimoLanceTerceiraPraca ? { thirdRoundMinimumValue: live.ValorMinimoLanceTerceiraPraca } : {}),
      ...((lot?.Comissao ?? live.Comissao) !== undefined ? { commissionFee: lot?.Comissao ?? live.Comissao } : {}),
      additionalDetails: {
        valorAvaliacao: String(live.ValorAvaliacao ?? 0),
        valorIncremento: String(live.ValorIncremento ?? 0),
      },
    };
  }

  private async getRealTime(url: string, lotId: number, token: string, cookie: string): Promise<RealTimeResponse> {
    const response = await fetch(`${BASE_URL}/ApiEngine/GetRealTime?GetRealTimeDarlance`, {
      method: 'POST',
      headers: {
        ...headers(),
        'Content-Type': 'application/json; charset=utf-8',
        RequestVerificationToken: token,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: url,
        Cookie: cookie,
      },
      body: JSON.stringify({ IDs_Leiloes_Lote: [lotId], IsLances: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Franco real-time API failed: HTTP ${response.status}`);
    return response.json() as Promise<RealTimeResponse>;
  }
}

function headers(): Record<string, string> {
  return { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9',
    'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' };
}
function absolute(path: string): string { return new URL(path, `${BASE_URL}/`).toString(); }
function validDate(value: string | undefined): Date | undefined {
  if (!value || value.startsWith('1900-01-01')) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
function clean(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!/[ÃƒÃ‚Ã¢]/.test(compact)) return compact;
  return Buffer.from([...compact].map((character) => character.charCodeAt(0) & 0xff)).toString('utf8');
}
function normalize(value: string): string {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function parseLocation(address: string, title: string): { city: string; state: string; neighborhood?: string } {
  const state = /\b([A-Z]{2})\b\s*$/.exec(address)?.[1] ?? /\/([A-Z]{2})\b/.exec(title)?.[1] ?? '';
  const parts = address.split(/\s+-\s+/).map(clean).filter(Boolean);
  const city = parts.length >= 2 ? parts.at(-2) ?? '' : title.split('/')[0]?.split(' - ')[0]?.trim() ?? '';
  const neighborhood = parts.length >= 3 ? parts.at(-3) : undefined;
  return { city, state, ...(neighborhood ? { neighborhood } : {}) };
}
function propertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento|apto\b/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(normalized)) return 'casa';
  if (/terreno|lote\b|urbano/.test(normalized)) return 'terreno';
  if (/loja|sala|conjunto|comercial/.test(normalized)) return 'comercial';
  if (/sitio|fazenda|chacara|rural/.test(normalized)) return 'rural';
  if (/galpao|barracao/.test(normalized)) return 'galpao';
  return 'outro';
}
function firstNumber(text: string, pattern: RegExp): number | undefined {
  const value = pattern.exec(text)?.[1]?.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function documentType(label: string): string {
  const value = normalize(label);
  if (value.includes('matricula')) return 'matricula';
  if (value.includes('edital')) return 'edital';
  if (value.includes('condicoes')) return 'condicoes';
  if (value.includes('laudo')) return 'laudo';
  return 'outro';
}
function unique(values: string[]): string[] { return [...new Set(values)]; }
