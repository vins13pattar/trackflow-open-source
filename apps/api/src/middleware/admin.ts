import { timingSafeEqual } from 'node:crypto';
import { errors } from '@trackflow/shared';
import type { MiddlewareHandler } from 'hono';
import { env } from '../env.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Gates the platform-operator admin API. Disabled (403) unless ADMIN_API_TOKEN
 *  is configured; otherwise requires a matching `x-admin-token` header. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const token = env.adminToken;
  if (!token) throw errors.forbidden('Admin API is not configured');
  if (!safeEqual(c.req.header('x-admin-token') ?? '', token)) throw errors.unauthorized('Invalid admin token');
  await next();
};
