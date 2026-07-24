import cron from 'node-cron';
import { config } from './config.js';
import { DashboardRepository } from './database/dashboardRepository.js';
import { HistoricalRepository } from './database/historicalRepository.js';
import { createPostgresPool, runPostgresMigrations } from './database/postgres.js';
import { LeiloCatalogScraper } from './scrapers/providers/leiloCatalog.js';
import { DashboardServer } from './server/dashboardServer.js';
import { Logger } from './utils/logger.js';
import { MediaStorageService } from './services/mediaStorageService.js';
import { createScraperFactory } from './scrapers/createScraperFactory.js';
import { CatalogDiscoveryService } from './services/catalogDiscoveryService.js';
import { HistoricalCollectorService } from './services/historicalCollectorService.js';
import { HistoricalCollectorScheduler } from './scheduler/historicalCollector.js';
import { VipLeiloesClient } from './scrapers/providers/vipLeiloesClient.js';
import { VipLeiloesCatalogProvider } from './scrapers/providers/vipLeiloesCatalog.js';
import { CatalogCollectionService } from './services/catalogCollectionService.js';
import { FrancoRealEstateCatalogProvider } from './scrapers/providers/francoRealEstateCatalog.js';
import { AlessandroTeixeiraRealEstateCatalogProvider } from './scrapers/providers/alessandroTeixeiraRealEstateCatalog.js';
import { AlvaroRealEstateCatalogProvider } from './scrapers/providers/alvaroRealEstateCatalog.js';
import { BrunoRealEstateCatalogProvider } from './scrapers/providers/brunoRealEstateCatalog.js';
import { CalilRealEstateCatalogProvider } from './scrapers/providers/calilRealEstateCatalog.js';
import { CapitalValorRealEstateCatalogProvider } from './scrapers/providers/capitalValorRealEstateCatalog.js';
import { D1LanceRealEstateCatalogProvider } from './scrapers/providers/d1LanceRealEstateCatalog.js';
import { CarloFerrariRealEstateCatalogProvider, CidaFixerRealEstateCatalogProvider, DaSilvaRealEstateCatalogProvider, DoLeiloesRealEstateCatalogProvider } from './scrapers/providers/vlanceRealEstateCatalog.js';
import { SuperbidCatalogProvider } from './scrapers/providers/superbidCatalog.js';
import { integrationDefinitions } from './integrations.js';

const logger = new Logger(config.logLevel);
const pool = createPostgresPool(config.postgresUrl);
await runPostgresMigrations(pool);
const historicalRepository = new HistoricalRepository(pool);
const mediaStorage = new MediaStorageService(historicalRepository, logger, {
  endpoint: config.minioEndpoint,
  port: config.minioPort,
  accessKey: config.minioAccessKey,
  secretKey: config.minioSecretKey,
  bucket: config.minioBucket,
  useSsl: config.minioUseSsl,
  concurrency: config.mediaDownloadConcurrency,
  imageMaxWidth: config.mediaImageMaxWidth,
  imageMaxHeight: config.mediaImageMaxHeight,
  imageQuality: config.mediaImageQuality,
});
await mediaStorage.initialize();
const vipClient = new VipLeiloesClient('https://www.vipleiloes.com.br', config.vipRequestIntervalMs);
const scraperFactory = createScraperFactory(config, { vipClient });
const bulkCollector = new CatalogCollectionService(
  historicalRepository,
  [
    new LeiloCatalogScraper(config.leiloApiUrl, 'Carros'),
    new LeiloCatalogScraper(config.leiloApiUrl, 'Motos'),
    new LeiloCatalogScraper(config.leiloApiUrl, 'Pesados'),
    new VipLeiloesCatalogProvider(vipClient, 'Seminovos'),
    new VipLeiloesCatalogProvider(vipClient, 'Usados'),
    new VipLeiloesCatalogProvider(vipClient, 'Motos'),
    new VipLeiloesCatalogProvider(vipClient, 'Pesados'),
    new FrancoRealEstateCatalogProvider(config.francoRequestIntervalMs),
    new AlessandroTeixeiraRealEstateCatalogProvider(config.alessandroRequestIntervalMs),
    new AlvaroRealEstateCatalogProvider(config.alvaroRequestIntervalMs),
    new BrunoRealEstateCatalogProvider(config.brunoRequestIntervalMs),
    new CalilRealEstateCatalogProvider(config.calilRequestIntervalMs),
    new CapitalValorRealEstateCatalogProvider(config.capitalValorRequestIntervalMs),
    new D1LanceRealEstateCatalogProvider(config.d1LanceRequestIntervalMs),
    new CarloFerrariRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new DaSilvaRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new CidaFixerRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new DoLeiloesRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new SuperbidCatalogProvider(config.superbidCatalogPageSize, config.superbidRequestIntervalMs,
      config.superbidCatalogMaxOffers),
  ],
  scraperFactory,
  mediaStorage,
  logger,
  config.catalogMaxPages,
);
const historicalCollector = new HistoricalCollectorService(
  historicalRepository,
  scraperFactory,
  new CatalogDiscoveryService(),
  logger,
  {
    maxDiscoveryPages: config.collectorMaxDiscoveryPages,
    maxDiscoveryDepth: config.collectorMaxDiscoveryDepth,
    concurrency: config.collectorConcurrency,
    siteIntervalMs: config.collectorSiteIntervalMs,
  },
);
const historicalScheduler = new HistoricalCollectorScheduler(
  config.collectorCron,
  historicalRepository,
  historicalCollector,
  mediaStorage,
  logger,
  config.collectorBatchSize,
  config.collectorIdlePollMs,
);
const server = new DashboardServer(
  new DashboardRepository(pool), bulkCollector, mediaStorage, logger, integrationDefinitions(config.leiloApiUrl),
);

server.listen(config.dashboardPort);
cron.schedule(config.catalogCollectionCron, () => void bulkCollector.collectAll());
historicalScheduler.start();
if (config.catalogCollectOnStart) void bulkCollector.collectAll('leilo');

async function shutdown(signal: string): Promise<void> {
  logger.info('Leilo dashboard shutting down', { signal });
  await historicalScheduler.stop();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
