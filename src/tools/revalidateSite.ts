import { config } from '../config.js';
import { createPostgresPool, runPostgresMigrations } from '../database/postgres.js';
import { HistoricalRepository } from '../database/historicalRepository.js';
import { createScraperFactory } from '../scrapers/createScraperFactory.js';
import { CatalogDiscoveryService } from '../services/catalogDiscoveryService.js';
import { HistoricalCollectorService } from '../services/historicalCollectorService.js';
import { MediaStorageService } from '../services/mediaStorageService.js';
import { Logger } from '../utils/logger.js';

const site = process.argv[2] ?? 'leilo';
const logger = new Logger(config.logLevel);
const pool = createPostgresPool(config.postgresUrl);

try {
  await runPostgresMigrations(pool);
  const repository = new HistoricalRepository(pool);
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
  const result = await collector.revalidateSite(site);
  const media = new MediaStorageService(repository, logger, {
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
  await media.initialize();
  const mediaResult = await media.downloadPending();
  console.log(JSON.stringify({ site, ...result, media: mediaResult }, null, 2));
} finally {
  await pool.end();
}
