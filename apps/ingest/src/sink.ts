import type { Attributes, Position } from '@trackflow/protocols';
import { env } from './env.js';
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

/**
 * Forwards a decoded message (position and/or telemetry) to the API's internal
 * ingest endpoint. Failures are logged, never thrown — a flaky sink must not
 * drop the device connection.
 */
export async function forwardMessage(m: MessageForward): Promise<void> {
  const pos = m.position;
  try {
    const res = await fetch(env.sinkUrl, {
      method: 'POST',
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
    if (!res.ok && res.status !== 202) {
      metrics.sinkError();
      console.warn(`[ingest] sink rejected message (${res.status})`);
      reportError(new Error(`Sink rejected message (${res.status})`), { imei: m.imei, protocol: m.protocol });
    }
  } catch (err) {
    metrics.sinkError();
    console.warn(`[ingest] sink unreachable: ${(err as Error).message}`);
    reportError(err, { imei: m.imei, protocol: m.protocol, sink: env.sinkUrl });
  }
}
