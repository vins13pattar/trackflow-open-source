import http from 'node:http';

const port = Number(process.env.MOCK_SINK_PORT ?? 18787);
const latencyMs = Number(process.env.MOCK_SINK_LATENCY_MS ?? 0);
const failureRate = Number(process.env.MOCK_SINK_FAILURE_RATE ?? 0);
let requests = 0;

const server = http.createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    requests += 1;
    setTimeout(() => {
      const fail = Math.random() < failureRate;
      if (request.method === 'POST' && request.url === '/internal/devices/admission' && !fail) {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ allowed: true, reason: 'allowed' }));
        return;
      }
      response.writeHead(fail ? 503 : 204);
      response.end();
    }, latencyMs);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'mock_sink_ready', port, latencyMs, failureRate }));
});

function shutdown() {
  console.log(JSON.stringify({ event: 'mock_sink_stopped', requests }));
  server.close(() => process.exit(0));
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
