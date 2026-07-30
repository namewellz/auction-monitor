import 'dotenv/config';

export interface AppConfig {
  telegramBotToken: string | undefined;
  allowedChatIds: Set<number>;
  monitorCron: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  exampleScraperHosts: string[];
  collectorCron: string;
  collectorBatchSize: number;
  collectorConcurrency: number;
  collectorIdlePollMs: number;
  collectorSiteIntervalMs: number;
  collectorMaxDiscoveryPages: number;
  collectorMaxDiscoveryDepth: number;
  collectorSourceIntervalMinutes: number;
  collectorSources: string[];
  dashboardPort: number;
  leiloApiUrl: string;
  leiloMaxPages: number;
  catalogCollectionMode: 'continuous' | 'cron';
  catalogCollectionCron: string;
  catalogCollectionIdleMs: number;
  catalogCollectionErrorBackoffMs: number;
  catalogCollectOnStart: boolean;
  catalogMaxPages: number;
  vipRequestIntervalMs: number;
  francoRequestIntervalMs: number;
  alessandroRequestIntervalMs: number;
  alvaroRequestIntervalMs: number;
  brunoRequestIntervalMs: number;
  calilRequestIntervalMs: number;
  capitalValorRequestIntervalMs: number;
  d1LanceRequestIntervalMs: number;
  vlanceRequestIntervalMs: number;
  milanRequestIntervalMs: number;
  milanFlareSolverrUrl: string | undefined;
  megaRequestIntervalMs: number;
  superbidRequestIntervalMs: number;
  superbidCatalogPageSize: number;
  superbidCatalogMaxOffers: number;
  postgresUrl: string;
  minioEndpoint: string;
  minioPort: number;
  minioAccessKey: string;
  minioSecretKey: string;
  minioBucket: string;
  minioUseSsl: boolean;
  mediaDownloadConcurrency: number;
  mediaImageMaxWidth: number;
  mediaImageMaxHeight: number;
  mediaImageQuality: number;
}

function parseNumberSet(value: string | undefined): Set<number> {
  if (!value?.trim()) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item)),
  );
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseCsv(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function parseLogLevel(value: string | undefined): AppConfig['logLevel'] {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }

  return 'info';
}

function parseCatalogCollectionMode(value: string | undefined): AppConfig['catalogCollectionMode'] {
  return value?.trim().toLowerCase() === 'cron' ? 'cron' : 'continuous';
}

export const config: AppConfig = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  allowedChatIds: parseNumberSet(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
  monitorCron: process.env.MONITOR_CRON ?? '*/1 * * * *',
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
  exampleScraperHosts: parseList(process.env.EXAMPLE_SCRAPER_HOSTS, ['example.com', 'site.com.br']),
  collectorCron: process.env.COLLECTOR_CRON ?? '*/5 * * * *',
  collectorBatchSize: parsePositiveInt(process.env.COLLECTOR_BATCH_SIZE, 100),
  collectorConcurrency: parsePositiveInt(process.env.COLLECTOR_CONCURRENCY, 4),
  collectorIdlePollMs: parsePositiveInt(process.env.COLLECTOR_IDLE_POLL_MS, 5000),
  collectorSiteIntervalMs: parsePositiveInt(process.env.COLLECTOR_SITE_INTERVAL_MS, 750),
  collectorMaxDiscoveryPages: parsePositiveInt(process.env.COLLECTOR_MAX_DISCOVERY_PAGES, 40),
  collectorMaxDiscoveryDepth: parsePositiveInt(process.env.COLLECTOR_MAX_DISCOVERY_DEPTH, 2),
  collectorSourceIntervalMinutes: parsePositiveInt(process.env.COLLECTOR_SOURCE_INTERVAL_MINUTES, 360),
  collectorSources: parseCsv(process.env.COLLECTOR_SOURCES),
  dashboardPort: parsePositiveInt(process.env.DASHBOARD_PORT, 3000),
  leiloApiUrl: process.env.LEILO_API_URL ?? 'https://api.leilo.com.br/v1/lote/busca-elastic',
  leiloMaxPages: parsePositiveInt(process.env.LEILO_MAX_PAGES, 20),
  catalogCollectionMode: parseCatalogCollectionMode(process.env.CATALOG_COLLECTION_MODE),
  catalogCollectionCron: process.env.CATALOG_COLLECTION_CRON
    ?? process.env.LEILO_COLLECTION_CRON
    ?? '0 */6 * * *',
  catalogCollectionIdleMs: parsePositiveInt(process.env.CATALOG_COLLECTION_IDLE_MS, 60_000),
  catalogCollectionErrorBackoffMs: parsePositiveInt(
    process.env.CATALOG_COLLECTION_ERROR_BACKOFF_MS,
    300_000,
  ),
  catalogCollectOnStart: parseBoolean(process.env.CATALOG_COLLECT_ON_START, false),
  catalogMaxPages: parsePositiveInt(process.env.CATALOG_MAX_PAGES, 60),
  vipRequestIntervalMs: parsePositiveInt(process.env.VIP_REQUEST_INTERVAL_MS, 750),
  francoRequestIntervalMs: parsePositiveInt(process.env.FRANCO_REQUEST_INTERVAL_MS, 750),
  alessandroRequestIntervalMs: parsePositiveInt(process.env.ALESSANDRO_REQUEST_INTERVAL_MS, 750),
  alvaroRequestIntervalMs: parsePositiveInt(process.env.ALVARO_REQUEST_INTERVAL_MS, 750),
  brunoRequestIntervalMs: parsePositiveInt(process.env.BRUNO_REQUEST_INTERVAL_MS, 750),
  calilRequestIntervalMs: parsePositiveInt(process.env.CALIL_REQUEST_INTERVAL_MS, 750),
  capitalValorRequestIntervalMs: parsePositiveInt(process.env.CAPITAL_VALOR_REQUEST_INTERVAL_MS, 750),
  d1LanceRequestIntervalMs: parsePositiveInt(process.env.D1_LANCE_REQUEST_INTERVAL_MS, 750),
  vlanceRequestIntervalMs: parsePositiveInt(process.env.VLANCE_REQUEST_INTERVAL_MS, 750),
  milanRequestIntervalMs: parsePositiveInt(process.env.MILAN_REQUEST_INTERVAL_MS, 750),
  milanFlareSolverrUrl: process.env.MILAN_FLARESOLVERR_URL?.trim() || undefined,
  megaRequestIntervalMs: parsePositiveInt(process.env.MEGA_REQUEST_INTERVAL_MS, 750),
  superbidRequestIntervalMs: parsePositiveInt(process.env.SUPERBID_REQUEST_INTERVAL_MS, 750),
  superbidCatalogPageSize: parsePositiveInt(process.env.SUPERBID_CATALOG_PAGE_SIZE, 100),
  superbidCatalogMaxOffers: Number.isInteger(Number(process.env.SUPERBID_CATALOG_MAX_OFFERS))
    && Number(process.env.SUPERBID_CATALOG_MAX_OFFERS) >= 0 ? Number(process.env.SUPERBID_CATALOG_MAX_OFFERS) : 0,
  postgresUrl: process.env.POSTGRES_URL ?? 'postgresql://auction:auction@localhost:5432/auction_monitor',
  minioEndpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  minioPort: parsePositiveInt(process.env.MINIO_PORT, 9000),
  minioAccessKey: process.env.MINIO_ACCESS_KEY ?? 'auctionadmin',
  minioSecretKey: process.env.MINIO_SECRET_KEY ?? 'auctionsecret',
  minioBucket: process.env.MINIO_BUCKET ?? 'auction-media',
  minioUseSsl: parseBoolean(process.env.MINIO_USE_SSL, false),
  mediaDownloadConcurrency: parsePositiveInt(process.env.MEDIA_DOWNLOAD_CONCURRENCY, 6),
  mediaImageMaxWidth: parsePositiveInt(process.env.MEDIA_IMAGE_MAX_WIDTH, 1280),
  mediaImageMaxHeight: parsePositiveInt(process.env.MEDIA_IMAGE_MAX_HEIGHT, 960),
  mediaImageQuality: parsePositiveInt(process.env.MEDIA_IMAGE_QUALITY, 70),
};
