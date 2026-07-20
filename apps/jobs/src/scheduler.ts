/**
 * In-repo scheduler. Runs the maintenance jobs (rollup, retention, billing
 * expiry, weekly report) on fixed intervals in a single long-lived process —
 * an alternative to wiring each job to an external cron. Intervals are
 * env-tunable; each run is isolated so one failure never stops the loop.
 *
 * Run with `pnpm jobs:scheduler`.
 */
import { pathToFileURL } from 'node:url';
import { runIngestHealthCheck } from './ingest-health.js';
import { recordJobRun, startMetricsServer } from './metrics.js';
import { retryDueDeliveries } from './notify-retry.js';
import { runReport } from './report.js';
import { runRetention } from './retention.js';
import { runRollup } from './rollup.js';
import { expireSubscriptions } from './subscriptions.js';

export interface ScheduledTask {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
}

export interface Scheduler {
  start(): void;
  stop(): void;
}

/** Runs a task once, logging the outcome. Never throws, so a failing run can't
 *  tear down the scheduler — the next tick still fires. */
export async function runTask(task: ScheduledTask): Promise<void> {
  const start = Date.now();
  try {
    await task.run();
    const ms = Date.now() - start;
    recordJobRun(task.name, 'ok', ms);
    console.log(JSON.stringify({ level: 'info', job: task.name, status: 'ok', ms }));
  } catch (err) {
    const ms = Date.now() - start;
    recordJobRun(task.name, 'failed', ms);
    console.error(
      JSON.stringify({ level: 'error', job: task.name, status: 'failed', ms, message: (err as Error).message }),
    );
  }
}

export function createScheduler(tasks: ScheduledTask[]): Scheduler {
  const timers: ReturnType<typeof setInterval>[] = [];
  return {
    start() {
      for (const task of tasks) {
        timers.push(setInterval(() => void runTask(task), task.intervalMs));
      }
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
  };
}

const MIN = 60_000;

/** Default task set with sensible cadences (override via SCHED_*_MS env vars). */
export function defaultTasks(): ScheduledTask[] {
  return [
    { name: 'ingest-health', intervalMs: Number(process.env.SCHED_INGEST_HEALTH_MS ?? MIN), run: () => runIngestHealthCheck() },
    { name: 'notify-retry', intervalMs: Number(process.env.SCHED_NOTIFY_RETRY_MS ?? MIN), run: () => retryDueDeliveries() },
    { name: 'rollup', intervalMs: Number(process.env.SCHED_ROLLUP_MS ?? 15 * MIN), run: runRollup },
    { name: 'retention', intervalMs: Number(process.env.SCHED_RETENTION_MS ?? 24 * 60 * MIN), run: runRetention },
    { name: 'subscriptions', intervalMs: Number(process.env.SCHED_SUBSCRIPTIONS_MS ?? 60 * MIN), run: () => expireSubscriptions() },
    { name: 'report', intervalMs: Number(process.env.SCHED_REPORT_MS ?? 7 * 24 * 60 * MIN), run: runReport },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scheduler = createScheduler(defaultTasks());
  scheduler.start();
  void startMetricsServer();
  console.log('[scheduler] started');
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      scheduler.stop();
      process.exit(0);
    });
  }
}
