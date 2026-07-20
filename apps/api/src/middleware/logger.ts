import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Principal } from './auth.js';

/** Structured JSON access log (one line per request) with a request id and, for
 *  authenticated requests, tenant/principal context for observability. The
 *  request id is echoed in the `x-request-id` response header so clients and
 *  error responses can be correlated to a log line. */
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  const path = new URL(c.req.url).pathname;
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);

  await next();

  if (path === '/health' || path === '/metrics') return; // skip probe/scrape noise
  const principal = c.get('principal') as Principal | undefined;
  console.log(
    JSON.stringify({
      level: 'info',
      ts: new Date().toISOString(),
      requestId,
      method: c.req.method,
      path,
      status: c.res.status,
      ms: Date.now() - start,
      tenantId: principal?.tenantId,
      principal: principal?.kind,
      userId: principal?.userId,
    }),
  );
};
