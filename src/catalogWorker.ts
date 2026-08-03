import { hostname } from 'node:os';
import { config } from './config.js';
import { CatalogQueueRepository } from './database/catalogQueueRepository.js';
import { HistoricalRepository } from './database/historicalRepository.js';
import { createPostgresPool,runPostgresMigrations } from './database/postgres.js';
import { createScraperFactory } from './scrapers/createScraperFactory.js';
import { VipLeiloesClient } from './scrapers/providers/vipLeiloesClient.js';
import { CatalogCollectionService } from './services/catalogCollectionService.js';
import { createCatalogProviders } from './services/catalogProviders.js';
import { MediaStorageService } from './services/mediaStorageService.js';
import { Logger } from './utils/logger.js';

const logger = new Logger(config.logLevel);
const pool = createPostgresPool(config.postgresUrl);
await runPostgresMigrations(pool);
const historicalRepository = new HistoricalRepository(pool);
const queue = new CatalogQueueRepository(pool);
const mediaStorage = new MediaStorageService(historicalRepository,logger,{
  endpoint: config.minioEndpoint,port: config.minioPort,accessKey: config.minioAccessKey,
  secretKey: config.minioSecretKey,bucket: config.minioBucket,useSsl: config.minioUseSsl,
  concurrency: config.mediaDownloadConcurrency,imageMaxWidth: config.mediaImageMaxWidth,
  imageMaxHeight: config.mediaImageMaxHeight,imageQuality: config.mediaImageQuality,
  ...(config.milanFlareSolverrUrl ? { milanFlareSolverrUrl: config.milanFlareSolverrUrl } : {}),
});
await mediaStorage.initialize();
const vipClient = new VipLeiloesClient('https://www.vipleiloes.com.br',config.vipRequestIntervalMs);
const scraperFactory = createScraperFactory(config,{ vipClient });
const collector = new CatalogCollectionService(historicalRepository,createCatalogProviders(config,vipClient),
  scraperFactory,mediaStorage,logger,config.catalogMaxPages,{ recordRun:false,processMedia:false });
const workerId = `${hostname()}-${process.pid}`;
const abortController = new AbortController();

logger.info('Catalog worker started',{ workerId,leaseSeconds: config.catalogWorkerLeaseSeconds });
process.once('SIGINT',(signal)=>void shutdown(signal));
process.once('SIGTERM',(signal)=>void shutdown(signal));
while (!abortController.signal.aborted) {
  const job = await queue.claim(workerId,config.catalogWorkerLeaseSeconds);
  if (!job) { await delay(config.catalogWorkerPollMs,abortController.signal); continue; }
  logger.info('Catalog job claimed',{ workerId,jobId: job.id,site: job.site,attempt: job.attempts });
  const heartbeat = setInterval(() => {
    void queue.heartbeat(job.id,workerId,config.catalogWorkerLeaseSeconds,collector.getProgress()).catch((error: unknown) =>
      logger.error('Catalog job heartbeat failed',{ jobId: job.id,error: error instanceof Error ? error.message : String(error) }));
  },Math.max(5_000,Math.min(15_000,Math.floor(config.catalogWorkerLeaseSeconds * 333))));
  try {
    const progress = await collector.collectAll(job.site);
    if (progress.lastError) {
      await queue.fail(job,workerId,progress.lastError,Math.ceil(config.catalogCollectionErrorBackoffMs / 1000));
    } else {
      await queue.complete(job,workerId,progress);
    }
    logger.info('Catalog job completed',{ workerId,jobId: job.id,site: job.site,saved: progress.saved,failed: progress.failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await queue.fail(job,workerId,message,Math.ceil(config.catalogCollectionErrorBackoffMs / 1000));
    logger.error('Catalog job failed',{ workerId,jobId: job.id,site: job.site,error: message });
  } finally { clearInterval(heartbeat); }
}
await pool.end();

async function shutdown(signal: string): Promise<void> {
  logger.info('Catalog worker shutting down',{ workerId,signal });
  abortController.abort();
}
function delay(ms: number,signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve)=>{
    const timeout=setTimeout(done,ms);
    signal.addEventListener('abort',done,{ once:true });
    function done(): void { clearTimeout(timeout);signal.removeEventListener('abort',done);resolve(); }
  });
}
