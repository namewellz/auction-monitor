import { config } from '../config.js';
import { HistoricalRepository } from '../database/historicalRepository.js';
import { createPostgresPool, runPostgresMigrations } from '../database/postgres.js';
import { createScraperFactory } from '../scrapers/createScraperFactory.js';
import { CatalogDiscoveryService } from '../services/catalogDiscoveryService.js';
import { HistoricalCollectorService } from '../services/historicalCollectorService.js';
import { Logger } from '../utils/logger.js';
import { MediaStorageService } from '../services/mediaStorageService.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run collect:url -- <url>');
  process.exit(1);
}

const pool = createPostgresPool(config.postgresUrl);
try {
  await runPostgresMigrations(pool);
  const repository = new HistoricalRepository(pool);
  const logger = new Logger(config.logLevel);
  const collector = new HistoricalCollectorService(
    repository,
    createScraperFactory(config),
    new CatalogDiscoveryService(),
    logger,
    {
      maxDiscoveryPages: config.collectorMaxDiscoveryPages,
      maxDiscoveryDepth: config.collectorMaxDiscoveryDepth,
      concurrency: config.collectorConcurrency,
    },
  );
  const id = await collector.collectUrl(url);
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
  const media = await mediaStorage.downloadPending();
  console.log(JSON.stringify({ marketLotId: id, url, media }, null, 2));
} finally {
  await pool.end();
}
