import { config } from '../config.js';
import { HistoricalRepository } from '../database/historicalRepository.js';
import { createPostgresPool, runPostgresMigrations } from '../database/postgres.js';
import { MediaStorageService } from '../services/mediaStorageService.js';
import { Logger } from '../utils/logger.js';

const batchSize = positiveInteger(process.argv[2], 500);
const runOnce = process.argv.includes('--once');
const pool = createPostgresPool(config.postgresUrl);

try {
  await runPostgresMigrations(pool);
  const logger = new Logger(config.logLevel);
  const repository = new HistoricalRepository(pool);
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
  });
  await media.initialize();

  const total = { optimized: 0, failed: 0, originalBytes: 0, optimizedBytes: 0 };
  while (true) {
    const batch = await media.optimizeExisting(batchSize);
    total.optimized += batch.optimized;
    total.failed += batch.failed;
    total.originalBytes += batch.originalBytes;
    total.optimizedBytes += batch.optimizedBytes;
    console.log(JSON.stringify({ batch, total }));
    if (batch.queued === 0 || runOnce) break;
  }

  console.log(JSON.stringify({
    ...total,
    savedBytes: total.originalBytes - total.optimizedBytes,
    reduction: total.originalBytes > 0 ? 1 - total.optimizedBytes / total.originalBytes : 0,
  }, null, 2));
} finally {
  await pool.end();
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
