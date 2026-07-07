import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardRepository } from '../database/dashboardRepository.js';
import type { CatalogCollectionService } from '../services/catalogCollectionService.js';
import type { Logger } from '../utils/logger.js';
import type { MediaStorageService } from '../services/mediaStorageService.js';

const webRoot = resolve(fileURLToPath(new URL('../../web', import.meta.url)));

export class DashboardServer {
  public constructor(
    private readonly repository: DashboardRepository,
    private readonly collector: CatalogCollectionService,
    private readonly mediaStorage: MediaStorageService,
    private readonly logger: Logger,
  ) {}

  public listen(port: number): void {
    createServer((request, response) => void this.handle(request, response)).listen(port, '0.0.0.0', () => {
      this.logger.info('Dashboard server started', { port });
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        return json(response, 200, await this.repository.stats(filtersFromUrl(url, 1, 1)));
      }
      if (url.pathname === '/api/events' && request.method === 'GET') {
        return json(response, 200, await this.repository.events(url.searchParams.get('site') ?? undefined));
      }
      if (url.pathname === '/api/sites' && request.method === 'GET') {
        return json(response, 200, await this.repository.sites());
      }
      if (url.pathname === '/api/lots/facets' && request.method === 'GET') {
        return json(response, 200, await this.repository.facets(filtersFromUrl(url, 1, 1)));
      }
      if (url.pathname === '/api/lots' && request.method === 'GET') {
        const page = positiveInt(url.searchParams.get('page'), 1);
        const pageSize = Math.min(100, positiveInt(url.searchParams.get('pageSize'), 24));
        return json(response, 200, await this.repository.lots(filtersFromUrl(url, page, pageSize)));
      }
      const mediaMatch = url.pathname.match(/^\/api\/media\/(\d+)$/);
      if (mediaMatch?.[1] && request.method === 'GET') {
        const media = await this.mediaStorage.open(Number(mediaMatch[1]));
        if (!media) return json(response, 404, { error: 'Midia nao encontrada.' });
        if ('fallbackUrl' in media) {
          response.writeHead(302, { Location: media.fallbackUrl, 'Cache-Control': 'private, max-age=60' });
          response.end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': media.contentType,
          'Cache-Control': 'public, max-age=86400, immutable',
        });
        media.stream.on('error', (error) => {
          this.logger.warn('Stored media stream failed', { error: error.message });
          response.destroy(error);
        });
        media.stream.pipe(response);
        return;
      }
      const lotMatch = url.pathname.match(/^\/api\/lots\/(\d+)$/);
      if (lotMatch?.[1] && request.method === 'GET') {
        const lot = await this.repository.lot(Number(lotMatch[1]));
        return lot ? json(response, 200, lot) : json(response, 404, { error: 'Lote nao encontrado.' });
      }
      if (url.pathname === '/api/collection' && request.method === 'GET') {
        return json(response, 200, this.collector.getProgress());
      }
      if (url.pathname === '/api/collection/leilo' && request.method === 'POST') {
        if (!this.collector.getProgress().running) void this.collector.collectAll('leilo');
        return json(response, 202, this.collector.getProgress());
      }
      const collectionMatch = url.pathname.match(/^\/api\/collection\/(leilo|vipleiloes)$/);
      if (collectionMatch?.[1] && request.method === 'POST') {
        if (!this.collector.getProgress().running) void this.collector.collectAll(collectionMatch[1]);
        return json(response, 202, this.collector.getProgress());
      }
      if (url.pathname === '/api/collection' && request.method === 'POST') {
        if (!this.collector.getProgress().running) void this.collector.collectAll();
        return json(response, 202, this.collector.getProgress());
      }

      await serveStatic(url.pathname, response);
    } catch (error) {
      this.logger.error('Dashboard request failed', { error: error instanceof Error ? error.message : String(error) });
      json(response, 500, { error: 'Erro interno.' });
    }
  }
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(webRoot, relative);
  if (!filePath.startsWith(webRoot)) return json(response, 404, { error: 'Nao encontrado.' });

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeType(filePath), 'Cache-Control': 'no-cache' });
    response.end(content);
  } catch {
    if (pathname !== '/') {
      const content = await readFile(resolve(webRoot, 'index.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end(content);
      return;
    }
    json(response, 404, { error: 'Nao encontrado.' });
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function filtersFromUrl(url: URL, page: number, pageSize: number) {
  const running = url.searchParams.get('runningAtEntry');
  const eventDateFrom = dateParameter(url.searchParams.get('eventDateFrom'));
  const eventDateTo = dateParameter(url.searchParams.get('eventDateTo'));
  const sort = sortParameter(url.searchParams.get('sort'));
  return {
    page,
    pageSize,
    ...(url.searchParams.get('search') ? { search: url.searchParams.get('search')!.trim() } : {}),
    ...stringListFilter(url, 'site', 'sites'),
    ...stringListFilter(url, 'assetType', 'assetTypes'),
    ...numberListFilter(url, 'event', 'eventIds'),
    ...stringListFilter(url, 'status', 'statuses'),
    ...stringListFilter(url, 'brand', 'brands'),
    ...stringListFilter(url, 'model', 'models'),
    ...numberListFilter(url, 'year', 'years'),
    ...stringListFilter(url, 'state', 'states'),
    ...stringListFilter(url, 'city', 'cities'),
    ...stringListFilter(url, 'origin', 'origins'),
    ...stringListFilter(url, 'consignor', 'consignors'),
    ...stringListFilter(url, 'classification', 'classifications'),
    ...stringListFilter(url, 'fuel', 'fuels'),
    ...stringListFilter(url, 'transmission', 'transmissions'),
    ...(running === 'yes' ? { runningAtEntry: true } : running === 'no' ? { runningAtEntry: false } : {}),
    ...(eventDateFrom ? { eventDateFrom } : {}),
    ...(eventDateTo ? { eventDateTo } : {}),
    ...(sort ? { sort } : {}),
  };
}

function sortParameter(value: string | null) {
  const allowed = ['auction_desc', 'auction_asc', 'year_desc', 'year_asc', 'brand_asc', 'brand_desc'] as const;
  return allowed.find((option) => option === value);
}

function dateParameter(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
}

function stringListFilter(url: URL, parameter: string, property: string): Record<string, string[]> {
  const values = parameterValues(url, parameter);
  return values.length ? { [property]: values } : {};
}

function numberListFilter(url: URL, parameter: string, property: string): Record<string, number[]> {
  const values = parameterValues(url, parameter).map(Number).filter(Number.isInteger);
  return values.length ? { [property]: values } : {};
}

function parameterValues(url: URL, parameter: string): string[] {
  return [...new Set(url.searchParams.getAll(parameter).flatMap((value) => value.split(','))
    .map((value) => value.trim()).filter(Boolean))];
}

function mimeType(path: string): string {
  switch (extname(path)) {
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.webp': return 'image/webp';
    case '.png': return 'image/png';
    default: return 'text/html; charset=utf-8';
  }
}
