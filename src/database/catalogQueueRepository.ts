import type { Pool, PoolClient } from 'pg';
import type { CatalogCollectionProgress } from '../services/catalogCollectionService.js';

export interface CatalogJob {
  id: number;
  cycleRunId: number;
  site: string;
  attempts: number;
}

export class CatalogQueueRepository {
  public constructor(private readonly pool: Pool) {}

  public async enqueueCycle(sites: string[], requestedSite?: string): Promise<{ runId: number; queued: number }> {
    const uniqueSites = [...new Set(sites)].sort();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [7_314_021]);
      const active = await client.query<{ cycle_run_id: string }>(
        `SELECT cycle_run_id FROM catalog_collection_jobs
         WHERE status IN ('queued','running') AND ($1::text IS NULL OR site=$1)
         ORDER BY created_at LIMIT 1`,
        [requestedSite ?? null],
      );
      if (active.rows[0]) {
        await client.query('COMMIT');
        return { runId: Number(active.rows[0].cycle_run_id), queued: 0 };
      }

      const run = await client.query<{ id: string }>(
        `INSERT INTO collection_runs(site,started_at,status) VALUES ($1,NOW(),'running') RETURNING id`,
        [requestedSite ?? null],
      );
      const runId = Number(run.rows[0]?.id);
      let queued = 0;
      for (const site of uniqueSites) {
        const inserted = await client.query(
          `INSERT INTO catalog_collection_jobs(cycle_run_id,site) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [runId, site],
        );
        queued += inserted.rowCount ?? 0;
      }
      if (!queued) {
        await client.query(`UPDATE collection_runs SET status='completed',finished_at=NOW() WHERE id=$1`, [runId]);
      }
      await client.query('COMMIT');
      return { runId, queued };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async claim(workerId: string, leaseSeconds: number): Promise<CatalogJob | undefined> {
    const result = await this.pool.query<{
      id: string; cycle_run_id: string; site: string; attempts: number;
    }>(
      `WITH candidate AS (
         SELECT id FROM catalog_collection_jobs
         WHERE (status='queued' AND available_at<=NOW())
            OR (status='running' AND lease_expires_at<NOW())
         ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,available_at,created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE catalog_collection_jobs job SET status='running',worker_id=$1,
         lease_expires_at=NOW()+($2::int * INTERVAL '1 second'),
         started_at=COALESCE(job.started_at,NOW()),attempts=job.attempts+1,error=NULL
       FROM candidate WHERE job.id=candidate.id
       RETURNING job.id,job.cycle_run_id,job.site,job.attempts`,
      [workerId, leaseSeconds],
    );
    const row = result.rows[0];
    return row ? { id: Number(row.id), cycleRunId: Number(row.cycle_run_id), site: row.site, attempts: row.attempts } : undefined;
  }

  public async heartbeat(jobId: number, workerId: string, leaseSeconds: number,
    progress: CatalogCollectionProgress): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE catalog_collection_jobs SET lease_expires_at=NOW()+($3::int * INTERVAL '1 second'),progress=$4::jsonb
       WHERE id=$1 AND worker_id=$2 AND status='running'`,
      [jobId, workerId, leaseSeconds, JSON.stringify(progress)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async complete(job: CatalogJob, workerId: string, progress: CatalogCollectionProgress): Promise<void> {
    const status = progress.lastError ? 'failed' : 'completed';
    await this.pool.query(
      `UPDATE catalog_collection_jobs SET status=$3,finished_at=NOW(),lease_expires_at=NULL,
         progress=$4::jsonb,error=$5 WHERE id=$1 AND worker_id=$2`,
      [job.id, workerId, status, JSON.stringify(progress), progress.lastError ?? null],
    );
    await this.finalizeCycle(job.cycleRunId);
  }

  public async fail(job: CatalogJob, workerId: string, error: string, retryDelaySeconds: number): Promise<void> {
    const exhausted = job.attempts >= 3;
    await this.pool.query(
      `UPDATE catalog_collection_jobs SET status=$3,worker_id=NULL,lease_expires_at=NULL,
         available_at=NOW()+($4::int * INTERVAL '1 second'),error=$5,
         finished_at=CASE WHEN $3='failed' THEN NOW() ELSE NULL END
       WHERE id=$1 AND worker_id=$2`,
      [job.id, workerId, exhausted ? 'failed' : 'queued', retryDelaySeconds, error.slice(0, 4000)],
    );
    if (exhausted) await this.finalizeCycle(job.cycleRunId);
  }

  public async progress(): Promise<CatalogCollectionProgress & { queuedSites: number; runningSites: number; completedSites: number; failedSites: number; currentSites: string[] }> {
    const result = await this.pool.query<{
      cycle_run_id: string; queued: string; running: string; completed: string; failed: string;
      current_site: string | null; current_sites: string[] | null; total_pages: string; processed_pages: string; discovered: string;
      saved: string; new_count: string; updated: string; unchanged: string; failed_count: string;
      started_at: Date; finished_at: Date | null;
    }>(
      `WITH active_cycle AS (
         SELECT id,started_at,finished_at FROM collection_runs
         WHERE source_id IS NULL AND EXISTS(SELECT 1 FROM catalog_collection_jobs j WHERE j.cycle_run_id=collection_runs.id)
         ORDER BY EXISTS(SELECT 1 FROM catalog_collection_jobs active
           WHERE active.cycle_run_id=collection_runs.id AND active.status IN ('queued','running')) DESC,
           started_at DESC LIMIT 1
       )
       SELECT c.id::text AS cycle_run_id,
         COUNT(*) FILTER(WHERE j.status='queued')::text AS queued,
         COUNT(*) FILTER(WHERE j.status='running')::text AS running,
         COUNT(*) FILTER(WHERE j.status='completed')::text AS completed,
         COUNT(*) FILTER(WHERE j.status='failed')::text AS failed,
         MIN(j.site) FILTER(WHERE j.status='running') AS current_site,
         ARRAY_AGG(j.site ORDER BY j.site) FILTER(WHERE j.status='running') AS current_sites,
         COALESCE(SUM((j.progress->>'totalPages')::int),0)::text AS total_pages,
         COALESCE(SUM((j.progress->>'processedPages')::int),0)::text AS processed_pages,
         COALESCE(SUM((j.progress->>'discovered')::int),0)::text AS discovered,
         COALESCE(SUM((j.progress->>'saved')::int),0)::text AS saved,
         COALESCE(SUM((j.progress->>'new')::int),0)::text AS new_count,
         COALESCE(SUM((j.progress->>'updated')::int),0)::text AS updated,
         COALESCE(SUM((j.progress->>'unchanged')::int),0)::text AS unchanged,
         COALESCE(SUM((j.progress->>'failed')::int),0)::text AS failed_count,
         c.started_at,c.finished_at
       FROM active_cycle c JOIN catalog_collection_jobs j ON j.cycle_run_id=c.id
       GROUP BY c.id,c.started_at,c.finished_at`,
    );
    const row = result.rows[0];
    if (!row) return { ...emptyProgress(), queuedSites: 0, runningSites: 0, completedSites: 0, failedSites: 0,currentSites:[] };
    const queuedSites = Number(row.queued); const runningSites = Number(row.running);
    return {
      running: queuedSites + runningSites > 0,
      ...(row.current_site ? { currentSite: row.current_site } : {}),
      currentSites: row.current_sites ?? [],
      startedAt: row.started_at.toISOString(),
      ...(row.finished_at ? { finishedAt: row.finished_at.toISOString() } : {}),
      totalPages: Number(row.total_pages), processedPages: Number(row.processed_pages),
      discovered: Number(row.discovered), saved: Number(row.saved), new: Number(row.new_count),
      updated: Number(row.updated), unchanged: Number(row.unchanged), failed: Number(row.failed_count),
      mediaQueued: 0, mediaDownloaded: 0, mediaFailed: 0, mediaBytes: 0,
      queuedSites, runningSites, completedSites: Number(row.completed), failedSites: Number(row.failed),
    };
  }

  private async finalizeCycle(runId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM collection_runs WHERE id=$1 FOR UPDATE', [runId]);
      const pending = await client.query(`SELECT 1 FROM catalog_collection_jobs WHERE cycle_run_id=$1 AND status IN ('queued','running') LIMIT 1`, [runId]);
      if (pending.rowCount) { await client.query('COMMIT'); return; }
      await client.query(
        `UPDATE collection_runs r SET finished_at=NOW(),
          status=CASE WHEN a.failed=0 AND a.failures=0 THEN 'completed'
            WHEN a.completed=0 THEN 'failed' ELSE 'partial' END,
          discovered_count=a.discovered,collected_count=a.saved,failed_count=a.failures,
          new_count=a.new_count,updated_count=a.updated,unchanged_count=a.unchanged,error=a.errors
         FROM (SELECT COUNT(*) FILTER(WHERE status='failed')::int failed,
           COUNT(*) FILTER(WHERE status='completed')::int completed,
           COALESCE(SUM((progress->>'discovered')::int),0)::int discovered,
           COALESCE(SUM((progress->>'saved')::int),0)::int saved,
           COALESCE(SUM((progress->>'failed')::int),0)::int failures,
           COALESCE(SUM((progress->>'new')::int),0)::int new_count,
           COALESCE(SUM((progress->>'updated')::int),0)::int updated,
           COALESCE(SUM((progress->>'unchanged')::int),0)::int unchanged,
           STRING_AGG(site||': '||error,E'\n') FILTER(WHERE error IS NOT NULL) errors
          FROM catalog_collection_jobs WHERE cycle_run_id=$1) a WHERE r.id=$1`,
        [runId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }
}

function emptyProgress(): CatalogCollectionProgress {
  return { running: false,totalPages: 0,processedPages: 0,discovered: 0,saved: 0,new: 0,updated: 0,
    unchanged: 0,failed: 0,mediaQueued: 0,mediaDownloaded: 0,mediaFailed: 0,mediaBytes: 0 };
}
