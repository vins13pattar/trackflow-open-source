import { createHash, randomBytes } from 'node:crypto';
import { and, authTokens, eq, gt, isNull } from '@trackflow/db';
import { db } from './db.js';

export type AuthTokenKind = 'password_reset' | 'email_verify' | 'mfa_challenge';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Issues a single-use token; stores only its hash and returns the raw token. */
export async function issueAuthToken(userId: string, kind: AuthTokenKind, ttlSeconds: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.insert(authTokens).values({
    userId,
    kind,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
  return token;
}

async function findValidToken(kind: AuthTokenKind, token: string) {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.kind, kind),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/** Validates a token WITHOUT consuming it. Used by the MFA challenge, where a
 *  mistyped code must not burn the challenge (it stays valid until its TTL). */
export async function peekAuthToken(kind: AuthTokenKind, token: string): Promise<string | null> {
  const row = await findValidToken(kind, token);
  return row?.userId ?? null;
}

/** Validates and consumes a token (single-use). Returns the userId, or null if
 *  the token is unknown, of the wrong kind, expired, or already used. */
export async function consumeAuthToken(kind: AuthTokenKind, token: string): Promise<string | null> {
  const row = await findValidToken(kind, token);
  if (!row) return null;
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  return row.userId;
}
