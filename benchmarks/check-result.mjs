import { readFile } from 'node:fs/promises';

const [file, expectedDevicesArg = '1'] = process.argv.slice(2);
if (!file) throw new Error('Usage: node benchmarks/check-result.mjs <result.json> [expected-devices]');

const expectedDevices = Number(expectedDevicesArg);
const result = JSON.parse(await readFile(file, 'utf8'));
const failures = [];
const metricsText = result.measurements?.ingestPrometheusText ?? '';

function metric(name, labels = '') {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = metricsText.match(new RegExp(`^${escaped}${labels ? `\\{${labels}\\}` : ''} (\\d+(?:\\.\\d+)?)$`, 'm'));
  return match ? Number(match[1]) : 0;
}

if (result.schemaVersion !== 1) failures.push(`schemaVersion=${result.schemaVersion}`);
if (result.measurement !== 'direct') failures.push(`measurement=${result.measurement}`);
if (result.workload?.syntheticDataOnly !== true) failures.push('syntheticDataOnly is not true');
if ((result.measurements?.peakActiveConnections ?? 0) < expectedDevices) {
  failures.push(`peak connections ${result.measurements?.peakActiveConnections ?? 0} < ${expectedDevices}`);
}
if ((result.measurements?.packetsSent ?? 0) < expectedDevices) failures.push('too few packets sent');
if (Object.keys(result.measurements?.errors ?? {}).length > 0) {
  failures.push(`generator errors=${JSON.stringify(result.measurements.errors)}`);
}
if (metric('ingest_sink_accepted_total') < 1) failures.push('sink accepted no messages');
if (metric('ingest_sink_succeeded_total') < 1) failures.push('sink delivered no messages');

for (const reason of ['queue_full', 'per_key_limit', 'shutting_down']) {
  const count = metric('ingest_sink_dropped_total', `reason="${reason}"`);
  if (count > 0) failures.push(`sink drops reason=${reason} count=${count}`);
}
const decoderExceptions = metric('ingest_decode_errors_total', 'reason="decoder_exception"');
if (decoderExceptions > 0) failures.push(`decoder exceptions=${decoderExceptions}`);

const summary = {
  file,
  expectedDevices,
  peakActiveConnections: result.measurements?.peakActiveConnections,
  packetsPerSecond: result.measurements?.packetsPerSecond,
  connectionP95Ms: result.measurements?.connectionLatency?.p95Ms,
  eventLoopP95Ms: result.measurements?.eventLoopLag?.p95Ms,
  maxMemoryRssBytes: result.measurements?.maxMemoryRssBytes,
  failures,
};
console.log(JSON.stringify(summary));
if (failures.length > 0) process.exitCode = 1;
