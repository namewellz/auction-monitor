import { createHash } from 'node:crypto';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import type {
  HistoricalRepository,
  OptimizableMedia,
  OptimizedMediaMetadata,
  PendingDocument,
  PendingMedia,
} from '../database/historicalRepository.js';
import type { Logger } from '../utils/logger.js';
import { ImageOptimizer, type OptimizedImage } from './imageOptimizer.js';

export interface MediaDownloadResult {
  queued: number;
  downloaded: number;
  failed: number;
  bytes: number;
}

export interface MediaOptimizationResult {
  queued: number;
  optimized: number;
  failed: number;
  originalBytes: number;
  optimizedBytes: number;
}

export class MediaStorageService {
  private readonly client: Client;
  private readonly imageOptimizer: ImageOptimizer;
  private pendingDownload: Promise<MediaDownloadResult> | undefined;

  public constructor(
    private readonly repository: HistoricalRepository,
    private readonly logger: Logger,
    private readonly options: {
      endpoint: string;
      port: number;
      accessKey: string;
      secretKey: string;
      bucket: string;
      useSsl: boolean;
      concurrency: number;
      imageMaxWidth: number;
      imageMaxHeight: number;
      imageQuality: number;
    },
  ) {
    this.client = new Client({
      endPoint: options.endpoint,
      port: options.port,
      useSSL: options.useSsl,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
    this.imageOptimizer = new ImageOptimizer(
      options.imageMaxWidth,
      options.imageMaxHeight,
      options.imageQuality,
    );
  }

  public async initialize(): Promise<void> {
    if (!(await this.client.bucketExists(this.options.bucket))) {
      await this.client.makeBucket(this.options.bucket, 'us-east-1');
    }
  }

  public downloadPending(limit = 10_000): Promise<MediaDownloadResult> {
    if (this.pendingDownload) return this.pendingDownload;
    const download = this.performDownloadPending(limit).finally(() => {
      if (this.pendingDownload === download) this.pendingDownload = undefined;
    });
    this.pendingDownload = download;
    return download;
  }

  private async performDownloadPending(limit: number): Promise<MediaDownloadResult> {
    const items = await this.repository.listPendingMedia(limit);
    const result: MediaDownloadResult = { queued: items.length, downloaded: 0, failed: 0, bytes: 0 };
    let cursor = 0;

    const workers = Array.from({ length: Math.min(Math.max(1, this.options.concurrency), items.length || 1) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        if (!item) continue;
        try {
          await this.repository.markMediaProcessing(item.id);
          const size = await this.download(item);
          result.downloaded += 1;
          result.bytes += size;
        } catch (error) {
          result.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          await this.repository.markMediaFailed(item.id, message);
          this.logger.warn('Media download failed', { mediaId: item.id, url: item.sourceUrl, error: message });
        }
      }
    });

    await Promise.all(workers);
    const documents = await this.downloadPendingDocuments(limit);
    result.queued += documents.queued;
    result.downloaded += documents.downloaded;
    result.failed += documents.failed;
    result.bytes += documents.bytes;
    return result;
  }

  private async downloadPendingDocuments(limit: number): Promise<MediaDownloadResult> {
    const items = await this.repository.listPendingDocuments(limit);
    const result: MediaDownloadResult = { queued: items.length, downloaded: 0, failed: 0, bytes: 0 };
    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, this.options.concurrency), items.length || 1) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        if (!item) continue;
        try {
          await this.repository.markMediaProcessing(item.id);
          result.bytes += await this.downloadDocument(item);
          result.downloaded += 1;
        } catch (error) {
          result.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          await this.repository.markMediaFailed(item.id, message);
          this.logger.warn('Document download failed', { mediaId: item.id, url: item.sourceUrl, error: message });
        }
      }
    });
    await Promise.all(workers);
    return result;
  }

  public async optimizeExisting(limit = 500): Promise<MediaOptimizationResult> {
    const items = await this.repository.listUnoptimizedMedia(this.imageOptimizer.profile, limit);
    const result: MediaOptimizationResult = {
      queued: items.length,
      optimized: 0,
      failed: 0,
      originalBytes: 0,
      optimizedBytes: 0,
    };
    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, this.options.concurrency), items.length || 1) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        if (!item) continue;
        try {
          const sizes = await this.optimizeStored(item);
          result.optimized += 1;
          result.originalBytes += sizes.original;
          result.optimizedBytes += sizes.optimized;
        } catch (error) {
          result.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          await this.repository.markMediaOptimizationFailed(item.id, message);
          this.logger.warn('Stored image optimization failed', { mediaId: item.id, error: message });
        }
      }
    });
    await Promise.all(workers);
    return result;
  }

  public async open(mediaId: number): Promise<
    { stream: Readable; contentType: string } | { fallbackUrl: string } | undefined
  > {
    const media = await this.repository.getMedia(mediaId);
    if (!media) return undefined;
    if (!media.storageKey || media.downloadStatus !== 'downloaded') return { fallbackUrl: media.sourceUrl };
    let stream: Readable;
    try {
      stream = await this.client.getObject(this.options.bucket, media.storageKey);
    } catch (error) {
      void this.record('get', media.mediaType, media.site, false);
      throw error;
    }
    let bytes = 0;
    let recorded = false;
    stream.on('data', (chunk: Buffer | string) => { bytes += Buffer.byteLength(chunk); });
    stream.once('end', () => {
      if (recorded) return;
      recorded = true;
      void this.record('get', media.mediaType, media.site, true, { bytesOut: bytes });
    });
    stream.once('error', () => {
      if (recorded) return;
      recorded = true;
      void this.record('get', media.mediaType, media.site, false, { bytesOut: bytes });
    });
    return {
      stream,
      contentType: media.contentType ?? 'application/octet-stream',
    };
  }

  private async download(item: PendingMedia): Promise<number> {
    const response = await fetch(item.sourceUrl, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = normalizeContentType(response.headers.get('content-type'));
    if (!contentType.startsWith('image/')) throw new Error(`Unexpected content type: ${contentType}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) throw new Error('Empty image');

    const optimized = await this.imageOptimizer.optimize(body);
    const stored = await this.storeOptimized(optimized, item.sourceUrl, item.site);
    await this.repository.markMediaDownloaded(item.id, stored);
    return optimized.buffer.length;
  }

  private async downloadDocument(item: PendingDocument): Promise<number> {
    const response = await fetch(item.sourceUrl, {
      headers: {
        accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)',
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) throw new Error('Empty document');
    const receivedType = normalizeContentType(response.headers.get('content-type'));
    const isPdf = receivedType === 'application/pdf' || body.subarray(0, 5).toString('ascii') === '%PDF-';
    const contentType = isPdf ? 'application/pdf' : receivedType;
    const contentHash = createHash('sha256').update(body).digest('hex');
    const storageKey = `documents/sha256/${contentHash.slice(0, 2)}/${contentHash}.${isPdf ? 'pdf' : 'bin'}`;
    let etag: string | undefined;
    try {
      etag = (await this.client.statObject(this.options.bucket, storageKey)).etag;
      void this.record('head', 'document', item.site, true);
    } catch (error) {
      void this.record('head', 'document', item.site, false);
      if (!isNotFound(error)) throw error;
      try {
        etag = (await this.client.putObject(this.options.bucket, storageKey, body, body.length, {
          'Content-Type': contentType,
          'x-amz-meta-source-url': item.sourceUrl,
          'x-amz-meta-document-type': item.documentType ?? 'other',
          // S3 metadata headers must remain ASCII; preserve the original label URL-encoded.
          'x-amz-meta-label': encodeURIComponent(item.label ?? 'Documento'),
        })).etag;
        void this.record('put', 'document', item.site, true, { bytesIn: body.length });
      } catch (error) {
        void this.record('put', 'document', item.site, false);
        throw error;
      }
    }
    await this.repository.markDocumentDownloaded(item.id, {
      storageKey, contentHash, contentType, sizeBytes: body.length, ...(etag ? { etag } : {}),
    }, this.options.bucket);
    return body.length;
  }

  private async optimizeStored(item: OptimizableMedia): Promise<{ original: number; optimized: number }> {
    const original = await this.readStoredObject(item.storageKey, 'image', item.site);
    if (original.length === 0) throw new Error('Empty stored image');
    const optimized = await this.imageOptimizer.optimize(original);
    const stored = await this.storeOptimized(optimized, item.sourceUrl, item.site);
    await this.repository.markMediaOptimized(item.id, stored);

    if (item.storageKey !== stored.storageKey && await this.repository.countMediaByStorageKey(item.storageKey) === 0) {
      try {
        await this.client.removeObject(this.options.bucket, item.storageKey);
        void this.record('delete', 'image', item.site, true);
      } catch (error) {
        void this.record('delete', 'image', item.site, false);
        this.logger.warn('Obsolete source object could not be removed', {
          storageKey: item.storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { original: original.length, optimized: optimized.buffer.length };
  }

  private async storeOptimized(image: OptimizedImage, sourceUrl: string, site: string): Promise<OptimizedMediaMetadata> {
    const contentHash = createHash('sha256').update(image.buffer).digest('hex');
    const storageKey = `sha256/${contentHash.slice(0, 2)}/${contentHash}.webp`;
    let etag: string | undefined;
    try {
      etag = (await this.client.statObject(this.options.bucket, storageKey)).etag;
      void this.record('head', 'image', site, true);
    } catch (error) {
      void this.record('head', 'image', site, false);
      if (!isNotFound(error)) throw error;
      try {
        const stored = await this.client.putObject(
          this.options.bucket,
          storageKey,
          image.buffer,
          image.buffer.length,
          {
            'Content-Type': image.contentType,
            'x-amz-meta-source-url': sourceUrl,
            'x-amz-meta-optimization-profile': image.profile,
          },
        );
        etag = stored.etag;
        void this.record('put', 'image', site, true, { bytesIn: image.buffer.length });
      } catch (error) {
        void this.record('put', 'image', site, false);
        throw error;
      }
    }
    return {
      storageKey,
      contentHash,
      contentType: image.contentType,
      sizeBytes: image.buffer.length,
      originalSizeBytes: image.originalSizeBytes,
      imageWidth: image.width,
      imageHeight: image.height,
      optimizationProfile: image.profile,
      ...(etag ? { etag } : {}),
    };
  }

  private async readStoredObject(storageKey: string, mediaType: string, site: string): Promise<Buffer> {
    try {
      const body = await streamToBuffer(await this.client.getObject(this.options.bucket, storageKey));
      void this.record('get', mediaType, site, true, { bytesOut: body.length });
      return body;
    } catch (error) {
      void this.record('get', mediaType, site, false);
      throw error;
    }
  }

  private async record(
    operation: string,
    mediaType: string,
    site: string,
    success: boolean,
    bytes: { bytesIn?: number; bytesOut?: number } = {},
  ): Promise<void> {
    try {
      await this.repository.recordStorageOperation({
        provider: 'oracle-minio', operation, mediaType, site, success, ...bytes,
      });
    } catch (error) {
      this.logger.warn('Storage metric could not be recorded', {
        operation, mediaType, site, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function normalizeContentType(value: string | null): string {
  return (value ?? 'application/octet-stream').split(';')[0]?.trim().toLowerCase() ?? 'application/octet-stream';
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; statusCode?: number };
  return candidate.statusCode === 404 || ['NotFound', 'NoSuchKey', 'NoSuchObject'].includes(candidate.code ?? '');
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
