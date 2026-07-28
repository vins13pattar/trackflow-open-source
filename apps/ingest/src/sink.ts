import type { Attributes, Position } from '@trackflow/protocols';
import { env } from './env.js';
import { ForwardQueue } from './forward-queue.js';
import { updateIngestHealth } from './health.js';
import { metrics } from './metrics.js';
import { reportError } from './observability.js';

export interface MessageForward {
  imei: string;
  protocol: string;
  kind: string;
  position?: Position;
  attributes?: Attributes;
  alarmType?: string;
}

export class SinkError extends Error {
  constructor(
    message: string,
    readonly category: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function sendMessage(m: MessageForward, signal: AbortSignal): Promise<void> {
  const pos = m.position;
  const res = await fetch(env.sinkUrl, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-ingest-token': env.sinkToken },
    body: JSON.stringify({
      imei: m.imei,
      protocol: m.protocol,
      latitude: pos?.latitude,
      longitude: pos?.longitude,
      speedKph: pos?.speedKph,
      course: pos?.course,
      gpsValid: pos?.gpsValid,
      satellites: pos?.satellites,
      attributes: m.attributes,
      fixTime: (pos?.fixTime ?? new Date()).getTime(),
      kind: m.kind,
      alarmType: m.alarmType,
    }),
  });
  if (res.ok || res.status === 202) return;
  throw new SinkError(`Sink rejected message (${res.status})`, `http_${res.status}`, res.status === 408 || res.status === 429 || res.status >= 500);
}

export function createForwardQueue(sender = sendMessage): ForwardQueue<MessageForward> {
  return new ForwardQueue(sender, {
    capacity: env.sinkQueueCapacity,
    perKeyCapacity: env.sinkPerDeviceCapacity,
    concurrency: env.sinkConcurrency,
    timeoutMs: env.sinkTimeoutMs,
    maxAttempts: env.sinkMaxAttempts,
    retryBaseMs: env.sinkRetryBaseMs,
    keyOf: (message) => message.imei,
    classifyError: (error) => {
      if (error instanceof SinkError) return { category: error.category, retryable: error.retryable };
      if (error instanceof Error && (error.name === 'AbortError' || error.message === 'sink_timeout')) {
        return { category: 'timeout', retryable: true };
      }
      return { category: 'network', retryable: true };
    },
    hooks: {
      state: ({ accepting, depth, capacity, inFlight }) => {
        updateIngestHealth({ accepting, queueDepth: depth, queueCapacity: capacity, inFlight });
        metrics.sinkQueueState(depth, inFlight, capacity);
      },
      accepted: metrics.sinkAccepted,
      succeeded: metrics.sinkSucceeded,
      retry: metrics.sinkRetry,
      dropped: metrics.sinkDropped,
      failed: (category, error) => {
        metrics.sinkError(category);
        reportError(error, { where: 'sink.forward', category, sink: env.sinkUrl });
      },
    },
  });
}

export const forwardQueue = createForwardQueue();

/** Enqueues without blocking device ACKs. False means the overload policy shed it. */
export function forwardMessage(m: MessageForward): boolean {
  return forwardQueue.enqueue(m);
}

export function drainForwarder(timeoutMs = env.shutdownTimeoutMs): Promise<boolean> {
  return forwardQueue.closeAndDrain(timeoutMs);
}
