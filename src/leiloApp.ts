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
import {
  AkimotoRealEstateCatalogProvider,
  AlessandraRealEstateCatalogProvider,
  DeoniziaRealEstateCatalogProvider,
  FranciscoFreitasRealEstateCatalogProvider,
  GiordanoRealEstateCatalogProvider,
  HdRealEstateCatalogProvider,
  JrRealEstateCatalogProvider,
  RioRealEstateCatalogProvider,
  ThaisTeixeiraRealEstateCatalogProvider,
  RigolonRealEstateCatalogProvider,
  LeiloesJudiciaisBahiaRealEstateCatalogProvider,
  FabioRealEstateCatalogProvider,
  GalvaniRealEstateCatalogProvider,
  JoseRodovalhoRealEstateCatalogProvider,
  RosiOliveiraRealEstateCatalogProvider,
  FidelisRealEstateCatalogProvider,
  GilsonRealEstateCatalogProvider,
  JdRealEstateCatalogProvider,
  MariaFixerRealEstateCatalogProvider,
} from './scrapers/providers/leiloesJudiciaisRealEstateCatalog.js';
import {
  SuporteLeiloesRealEstateCatalogProvider,
} from './scrapers/providers/suporteLeiloesRealEstateCatalog.js';
import { suporteLeiloesDefinitions } from './scrapers/providers/suporteLeiloesRealEstate.js';
import { MilanPageClient, MilanRealEstateCatalogProvider } from './scrapers/providers/milanRealEstateCatalog.js';
import { SatoRealEstateCatalogProvider } from './scrapers/providers/satoRealEstateCatalog.js';
import { LeiloeiroPublicoRealEstateCatalogProvider } from './scrapers/providers/leiloeiroPublicoRealEstateCatalog.js';
import { integrationDefinitions } from './integrations.js';
import { CatalogCollectionScheduler } from './scheduler/catalogCollection.js';

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
  ...(config.milanFlareSolverrUrl
    ? { milanFlareSolverrUrl: config.milanFlareSolverrUrl }
    : {}),
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
    new AkimotoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new AlessandraRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new DeoniziaRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new JrRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new GiordanoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new FranciscoFreitasRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new RioRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new HdRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new ThaisTeixeiraRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new RigolonRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new LeiloesJudiciaisBahiaRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new FabioRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new GalvaniRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new JoseRodovalhoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new RosiOliveiraRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new FidelisRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new GilsonRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new JdRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new MariaFixerRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new LeiloeiroPublicoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    new SatoRealEstateCatalogProvider(config.vlanceRequestIntervalMs),
    ...suporteLeiloesDefinitions.map((definition) =>
      new SuporteLeiloesRealEstateCatalogProvider(definition, config.vlanceRequestIntervalMs)),
    new MilanRealEstateCatalogProvider(
      config.milanRequestIntervalMs,
      new MilanPageClient(config.milanFlareSolverrUrl),
    ),
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
const dashboardRepository = new DashboardRepository(pool);
const server = new DashboardServer(
  dashboardRepository, bulkCollector, mediaStorage, logger, integrationDefinitions(config.leiloApiUrl),
);

server.listen(config.dashboardPort);
void Promise.all([
  dashboardRepository.facets({ assetTypes: ['car','motorcycle','heavy'],page: 1,pageSize: 1 }),
  dashboardRepository.stats({ assetTypes: ['car','motorcycle','heavy'],page: 1,pageSize: 1 }),
  dashboardRepository.facets({ assetTypes: ['real_estate'],page: 1,pageSize: 1 }),
  dashboardRepository.stats({ assetTypes: ['real_estate'],page: 1,pageSize: 1 }),
]).catch((error) => logger.warn('Dashboard cache warmup failed', {
  error: error instanceof Error ? error.message : String(error),
}));
const catalogScheduler = new CatalogCollectionScheduler(
  bulkCollector,
  logger,
  () => dashboardRepository.invalidateCaches(),
  {
    mode: config.catalogCollectionMode,
    cronExpression: config.catalogCollectionCron,
    idleMs: config.catalogCollectionIdleMs,
    errorBackoffMs: config.catalogCollectionErrorBackoffMs,
    collectOnStart: config.catalogCollectOnStart,
  },
);
catalogScheduler.start();
historicalScheduler.start();

async function shutdown(signal: string): Promise<void> {
  logger.info('Leilo dashboard shutting down', { signal });
  catalogScheduler.stop();
  await historicalScheduler.stop();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
