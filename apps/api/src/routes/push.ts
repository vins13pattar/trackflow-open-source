import { pushTokens, withTenant } from '@trackflow/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';

export const pushRoutes = new Hono<AppEnv>();

const registerSchema = z.object({ token: z.string().min(8).max(200), platform: z.string().max(20).optional() });

pushRoutes.post('/register', async (c) => {
  const { tenantId, userId } = c.get('principal');
  const body = registerSchema.parse(await c.req.json());
  await withTenant(db, tenantId, (tx) =>
    tx
      .insert(pushTokens)
      .values({ tenantId, userId: userId ?? null, token: body.token, platform: body.platform ?? null })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { tenantId, userId: userId ?? null, platform: body.platform ?? null },
      }),
  );
  return c.json({ ok: true });
});
