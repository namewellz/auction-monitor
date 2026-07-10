import { config } from '../config.js';
import { createPostgresPool, runPostgresMigrations } from '../database/postgres.js';
import { HistoricalRepository } from '../database/historicalRepository.js';
import { createScraperFactory } from '../scrapers/createScraperFactory.js';
import { LeiloCatalogScraper, type LeiloCatalogType } from '../scrapers/providers/leiloCatalog.js';
import { CatalogCollectionService } from '../services/catalogCollectionService.js';
import { MediaStorageService } from '../services/mediaStorageService.js';
import { Logger } from '../utils/logger.js';

const eventId = process.argv[2];
const catalogType = (process.argv[3] ?? 'Pesados') as LeiloCatalogType;
const allowedTypes: LeiloCatalogType[] = ['Carros', 'Motos', 'Pesados'];

if (!eventId || !allowedTypes.includes(catalogType)) {
  console.error('Usage: npm run collect:leilo-event -- <event-id> [Carros|Motos|Pesados]');
  process.exit(1);
}

const logger = new Logger(config.logLevel);
const pool = createPostgresPool(config.postgresUrl);

try {
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
  const collector = new CatalogCollectionService(
    repository,
    [new LeiloCatalogScraper(config.leiloApiUrl, catalogType, eventId)],
    createScraperFactory(config),
    mediaStorage,
    logger,
    config.catalogMaxPages,
  );
  const result = await collector.collectAll('leilo');
  console.log(JSON.stringify({ eventId, catalogType, ...result }, null, 2));
} finally {
  await pool.end();
}
