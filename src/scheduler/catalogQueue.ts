import cron,{ type ScheduledTask } from 'node-cron';
import type { CatalogQueueRepository } from '../database/catalogQueueRepository.js';
import type { Logger } from '../utils/logger.js';

export interface CatalogQueueSchedulerOptions {
  mode: 'continuous' | 'cron'; cronExpression: string; idleMs: number; collectOnStart: boolean;
}

export class CatalogQueueScheduler {
  private readonly abortController = new AbortController();
  private cronTask: ScheduledTask | undefined;

  public constructor(private readonly queue: CatalogQueueRepository,private readonly sites: string[],
    private readonly logger: Logger,private readonly options: CatalogQueueSchedulerOptions) {}

  public start(): void {
    if (this.options.mode === 'continuous') {
      void this.continuousLoop();
      return;
    }
    this.cronTask=cron.schedule(this.options.cronExpression,()=>void this.enqueue());
    if (this.options.collectOnStart) void this.enqueue();
    this.logger.info('Catalog queue scheduler started',{ mode:'cron',cron:this.options.cronExpression });
  }

  public stop(): void { this.abortController.abort();this.cronTask?.stop(); }

  private async continuousLoop(): Promise<void> {
    this.logger.info('Catalog queue scheduler started',{ mode:'continuous',idleMs:this.options.idleMs });
    while (!this.abortController.signal.aborted) {
      try {
        const progress=await this.queue.progress();
        if (!progress.running) await this.enqueue();
      } catch (error) {
        this.logger.error('Catalog cycle could not be scheduled',{ error:error instanceof Error ? error.message:String(error) });
      }
      await delay(this.options.idleMs,this.abortController.signal);
    }
  }

  private async enqueue(): Promise<void> {
    const result=await this.queue.enqueueCycle(this.sites);
    this.logger.info('Catalog cycle queued',{ runId:result.runId,queuedSites:result.queued });
  }
}

function delay(ms:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted)return Promise.resolve();
  return new Promise((resolve)=>{const timeout=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});
    function done():void{clearTimeout(timeout);signal.removeEventListener('abort',done);resolve();}});
}
