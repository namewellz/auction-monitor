import type { MonitorScheduler } from '../scheduler/monitor.js';

export class SchedulerService {
  public constructor(private readonly monitor: MonitorScheduler) {}

  public start(): void {
    this.monitor.start();
  }

  public stop(): void {
    this.monitor.stop();
  }
}
