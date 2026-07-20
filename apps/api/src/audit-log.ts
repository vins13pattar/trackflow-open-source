import { auditLogs, withSystem } from '@trackflow/db';
import type { Context } from 'hono';
import { db } from './db.js';
import type { AppEnv } from './middleware/auth.js';

export interface AuditArgs {
  tenantId: string;
  actorUserId?: string | null;
  actorIp?: string | null;
  action: string;
  target?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget audit write. Swallows errors so a logging failure can't
 *  poison the caller's request. */
export async function recordAudit(args: AuditArgs): Promise<void> {
  try {
    await withSystem(db, (tx) =>
      tx.insert(auditLogs).values({
        tenantId: args.tenantId,
        actorUserId: args.actorUserId ?? null,
        actorIp: args.actorIp ?? null,
        action: args.action,
        target: args.target ?? null,
        targetId: args.targetId ?? null,
        metadata: args.metadata ?? {},
      }),
    );
  } catch (err) {
    console.warn('[audit] failed to record:', (err as Error).message);
  }
}

/** Pulls the caller's IP from the standard proxy/Fly headers (best-effort). */
export function actorIp(c: Context<AppEnv>): string | null {
  return c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/** Pulls the userId out of the principal (null for API-key principals). */
export function actorUserId(c: Context<AppEnv>): string | null {
  return c.get('principal').userId ?? null;
}
