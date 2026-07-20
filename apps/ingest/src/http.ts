import http from 'node:http';
import { env } from './env.js';
import { handleHttp } from './metrics.js';

/** Boots the ingest health + metrics HTTP server (separate from the TCP
 *  protocol listeners). Lets a load balancer / status page probe ingest
 *  liveness and lets Prometheus scrape throughput + connection gauges. */
export function startHttpServer(): http.Server {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const { status, body, contentType } = handleHttp(req.method ?? 'GET', path, req.headers.authorization);
    res.writeHead(status, { 'content-type': contentType });
    res.end(body);
  });
  server.on('error', (err) => console.warn(`[ingest:http] ${err.message}`));
  server.listen(env.httpPort, () => console.log(`[ingest] health+metrics on http/${env.httpPort}`));
  return server;
}
