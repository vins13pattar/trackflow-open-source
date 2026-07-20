import { apiKeys, eq, sql, withSystem } from '@trackflow/db';
import type { Role } from '@trackflow/shared';
import { apiKeyParts, errors, verifyToken } from '@trackflow/shared';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db.js';
import { env } from '../env.js';
import { meterApiCall } from '../usage-service.js';

export interface Principal {
  kind: 'user' | 'apikey';
  tenantId: string;
  userId?: string;
  role?: Role;
  scopes?: string[];
  keyId?: string;
}

export type AppEnv = { Variables: { principal: Principal; requestId: string } };

/** Accepts either a Bearer JWT (user) or an `x-api-key` header (programmatic). */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const bearer = c.req.header('authorization');
  if (bearer?.startsWith('Bearer ')) {
    const claims = await verifyToken(bearer.slice(7), 'access', env.jwt);
    c.set('principal', {
      kind: 'user',
      tenantId: claims.tid,
      userId: claims.sub,
      role: claims.role as Role,
    });
    return next();
  }

  const apiKey = c.req.header('x-api-key');
  if (apiKey) {
    const { prefix, hash } = await apiKeyParts(apiKey);
    const principal = await withSystem(db, async (tx) => {
      const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.prefix, prefix));
      if (!row || row.revokedAt || row.keyHash !== hash) return null;
      await tx.update(apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(apiKeys.id, row.id));
      return { kind: 'apikey' as const, tenantId: row.tenantId, scopes: row.scopes, keyId: row.id };
    });
    if (!principal) throw errors.unauthorized('Invalid API key');
    c.set('principal', principal);
    // Meter programmatic usage against the plan's monthly API quota (throws 402 over limit).
    await meterApiCall(principal.tenantId);
    return next();
  }

  throw errors.unauthorized();
};
