import type { MiddlewareHandler } from 'hono';
import { recordHttp } from '../metrics.js';

/** Times every request and records it into the Prometheus registry. Skips
 *  `/metrics` (don't instrument the scrape) and `/health` (probe noise). */
export const metricsMiddleware: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/metrics' || path === '/health') return next();
  const start = Date.now();
  await next();
  recordHttp(c.req.method, c.res.status, Date.now() - start);
};
