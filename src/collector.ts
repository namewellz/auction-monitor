import { config } from './config.js';
import { HistoricalRepository } from './database/historicalRepository.js';
import { createPostgresPool, runPostgresMigrations } from './database/postgres.js';
import { createScraperFactory } from './scrapers/createScraperFactory.js';
import { CatalogDiscoveryService } from './services/catalogDiscoveryService.js';
import { HistoricalCollectorService } from './services/historicalCollectorService.js';
import { HistoricalCollectorScheduler } from './scheduler/historicalCollector.js';
import { Logger } from './utils/logger.js';
import { MediaStorageService } from './services/mediaStorageService.js';

const logger = new Logger(config.logLevel);
const pool = createPostgresPool(config.postgresUrl);
await runPostgresMigrations(pool);
const repository = new HistoricalRepository(pool);
const mediaStorage = new MediaStorageService(repository, logger, {
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
const scraperFactory = createScraperFactory(config);
const discovery = new CatalogDiscoveryService();
const collector = new HistoricalCollectorService(repository, scraperFactory, discovery, logger, {
  maxDiscoveryPages: config.collectorMaxDiscoveryPages,
  maxDiscoveryDepth: config.collectorMaxDiscoveryDepth,
  concurrency: config.collectorConcurrency,
  siteIntervalMs: config.collectorSiteIntervalMs,
});

for (const sourceUrl of config.collectorSources) {
  const site = scraperFactory.forUrl(sourceUrl).site;
  await repository.addSource(site, sourceUrl, config.collectorSourceIntervalMinutes);
}

const scheduler = new HistoricalCollectorScheduler(
  config.collectorCron,
  repository,
  collector,
  mediaStorage,
  logger,
  config.collectorBatchSize,
  config.collectorIdlePollMs,
);
scheduler.start();

async function shutdown(signal: string): Promise<void> {
  logger.info('Historical collector shutting down', { signal });
  await scheduler.stop();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
