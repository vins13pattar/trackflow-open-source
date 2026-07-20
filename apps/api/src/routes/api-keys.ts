import { apiKeys, desc, eq, sql, withTenant } from '@trackflow/db';
import { createApiKeySchema, errors, generateApiKey } from '@trackflow/shared';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const apiKeyRoutes = new Hono<AppEnv>();

apiKeyRoutes.use('*', requirePermission('apikeys:manage'));

apiKeyRoutes.get('/', async (c) => {
  const { tenantId } = c.get('principal');
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt)),
  );
  return c.json({ keys: rows, total: rows.length });
});

apiKeyRoutes.post('/', async (c) => {
  const { tenantId } = c.get('principal');
  const body = createApiKeySchema.parse(await c.req.json());
  const generated = await generateApiKey();
  const row = await withTenant(db, tenantId, async (tx) => {
    const [k] = await tx
      .insert(apiKeys)
      .values({
        tenantId,
        name: body.name,
        prefix: generated.prefix,
        keyHash: generated.hash,
        scopes: body.scopes,
      })
      .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes });
    return k!;
  });
  // The full key is returned exactly once.
  return c.json({ ...row, key: generated.key }, 201);
});

apiKeyRoutes.delete('/:id', async (c) => {
  const { tenantId } = c.get('principal');
  const updated = await withTenant(db, tenantId, async (tx) => {
    const [k] = await tx
      .update(apiKeys)
      .set({ revokedAt: sql`now()` })
      .where(eq(apiKeys.id, c.req.param('id')))
      .returning({ id: apiKeys.id });
    return k;
  });
  if (!updated) throw errors.notFound('API key not found');
  return c.body(null, 204);
});
