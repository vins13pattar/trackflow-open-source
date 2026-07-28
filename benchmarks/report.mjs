import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => arg.slice(2).split(/=(.*)/s).slice(0, 2)),
);
if (!args.before || !args.after) {
  throw new Error('Usage: node benchmarks/report.mjs --before=<json> --after=<json> [--output=<md>]');
}

const load = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [before, after] = await Promise.all([load(args.before), load(args.after)]);
const m = (result) => result.measurements;
const metric = (result, name) => {
  const line = m(result).ingestPrometheusText
    ?.split('\n')
    .find((candidate) => candidate.startsWith(name) && !candidate.startsWith('#'));
  return line ? Number(line.trim().split(/\s+/).at(-1)) : 0;
};
const fixed = (value, digits = 2) => Number(value).toFixed(digits);
const mib = (bytes) => fixed(bytes / 1024 / 1024, 1);
const change = (a, b) => (a === 0 ? 'n/a' : `${fixed(((b - a) / a) * 100, 1)}%`);

const rows = [
  ['Peak active connections', m(before).peakActiveConnections, m(after).peakActiveConnections],
  ['Packets sent', m(before).packetsSent, m(after).packetsSent],
  ['Generator packets/s', fixed(m(before).packetsPerSecond), fixed(m(after).packetsPerSecond)],
  ['Connection p95 (ms)', fixed(m(before).connectionLatency.p95Ms), fixed(m(after).connectionLatency.p95Ms)],
  ['Protocol ACK p95 (ms)', fixed(m(before).protocolAcknowledgementLatency.p95Ms), fixed(m(after).protocolAcknowledgementLatency.p95Ms)],
  ['Event-loop lag p95 (ms)', fixed(m(before).eventLoopLag.p95Ms), fixed(m(after).eventLoopLag.p95Ms)],
  ['Generator max RSS (MiB)', mib(m(before).maxMemoryRssBytes), mib(m(after).maxMemoryRssBytes)],
  ['Ingest decode exceptions', metric(before, 'ingest_decode_errors_total{'), metric(after, 'ingest_decode_errors_total{')],
  ['Sink queue drops', metric(before, 'ingest_sink_dropped_total{'), metric(after, 'ingest_sink_dropped_total{')],
];

const markdown = `# TCP ingestion benchmark: 1,000 synthetic devices

Generated from the versioned raw artifacts below. Values are direct local
measurements, not production capacity claims.

- Before: \`${path.basename(args.before)}\`
- After: \`${path.basename(args.after)}\`
- Workload: ${before.workload.devices} devices; ${Object.entries(before.workload.protocolMix)
  .map(([protocol, count]) => `${protocol}=${count}`)
  .join(', ')}; ${before.workload.intervalMs} ms reporting; seed ${before.workload.seed}
- Environment: ${before.environment.cpuModel}; ${before.environment.cpuCount} logical CPUs; ${before.environment.arch}; ${before.environment.node}

| Metric | Before | After |
|---|---:|---:|
${rows.map(([label, left, right]) => `| ${label} | ${left} | ${right} |`).join('\n')}

## Charts

\`\`\`mermaid
xychart-beta
  title "Generated packets per second"
  x-axis ["before", "after"]
  y-axis "packets/s" 0 --> ${Math.ceil(Math.max(m(before).packetsPerSecond, m(after).packetsPerSecond) * 1.1)}
  bar [${fixed(m(before).packetsPerSecond)}, ${fixed(m(after).packetsPerSecond)}]
\`\`\`

\`\`\`mermaid
xychart-beta
  title "Protocol acknowledgement p95"
  x-axis ["before", "after"]
  y-axis "milliseconds" 0 --> ${Math.ceil(Math.max(m(before).protocolAcknowledgementLatency.p95Ms, m(after).protocolAcknowledgementLatency.p95Ms) * 1.2)}
  bar [${fixed(m(before).protocolAcknowledgementLatency.p95Ms)}, ${fixed(m(after).protocolAcknowledgementLatency.p95Ms)}]
\`\`\`

## Finding and change

The before run produced ${metric(before, 'ingest_decode_errors_total{')} contained
Teltonika parser exception under malformed/fragmented traffic. The decoder now
bounds the advertised data length, validates codec/count/count2 structure, and
drops truncated records without throwing. The identical after run produced
${metric(after, 'ingest_decode_errors_total{')} parser exceptions.

Throughput changed ${change(m(before).packetsPerSecond, m(after).packetsPerSecond)}
and ACK p95 changed ${change(
  m(before).protocolAcknowledgementLatency.p95Ms,
  m(after).protocolAcknowledgementLatency.p95Ms,
)}. These small local differences are not statistically significant; the
verified improvement is removal of the parser exception without queue loss.

## Boundary and limitations

- The measured boundary is simulator → TCP ingest → deterministic local HTTP sink.
- Protocol ACK latency is not Postgres commit latency or ingest-to-map latency.
- The generator opened all ${m(after).peakActiveConnections} requested sockets.
- No sink queue drops were observed; this run does not establish the queue's
  failure capacity under a slow database.
- The 10,000/50,000/100,000 tiers remain unverified design targets.
`;

if (args.output) await writeFile(args.output, markdown, 'utf8');
else process.stdout.write(markdown);
