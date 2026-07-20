import { eq, tenants } from '@trackflow/db';
import { totpCode } from '@trackflow/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

type Tokens = { accessToken: string; refreshToken: string };

describe.skipIf(!enabled)('mfa: TOTP enrollment + login challenge', () => {
  const app = createApp();
  const tenantIds: string[] = [];

  const json = (body: unknown, token?: string) => ({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  async function register() {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `mfa-${stamp}@example.com`;
    const password = 'password123';
    const res = await app.request('/auth/register', json({ email, password, name: 'MFA User', tenantName: `Org ${stamp}` }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { id: string; tenantId: string }; tokens: Tokens };
    tenantIds.push(body.user.tenantId);
    return { email, password, ...body };
  }

  /** Enrolls + enables MFA for a registered user; returns the secret + recovery codes. */
  async function enroll(accessToken: string) {
    const setup = await app.request('/me/mfa/setup', json({}, accessToken));
    expect(setup.status).toBe(200);
    const { secret, otpauthUri } = (await setup.json()) as { secret: string; otpauthUri: string };
    expect(otpauthUri).toContain('otpauth://totp/');
    const enable = await app.request('/me/mfa/enable', json({ code: await totpCode(secret) }, accessToken));
    expect(enable.status).toBe(200);
    const { recoveryCodes } = (await enable.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes.length).toBe(10);
    return { secret, recoveryCodes };
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('enables MFA, then login demands a code; the right code mints tokens', async () => {
    const { email, password, tokens } = await register();
    const { secret } = await enroll(tokens.accessToken);

    const status = await app.request('/me/mfa', { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    expect(((await status.json()) as { enabled: boolean }).enabled).toBe(true);

    const login = await app.request('/auth/login', json({ email, password }));
    expect(login.status).toBe(200);
    const challenge = (await login.json()) as { mfaRequired?: boolean; mfaToken?: string; tokens?: Tokens };
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.tokens).toBeUndefined();

    // A wrong code is rejected but does NOT burn the challenge…
    const bad = await app.request('/auth/mfa/verify', json({ mfaToken: challenge.mfaToken, code: '000000' }));
    expect(bad.status).toBe(401);
    // …so the right code on the same challenge still succeeds.
    const good = await app.request('/auth/mfa/verify', json({ mfaToken: challenge.mfaToken, code: await totpCode(secret) }));
    expect(good.status).toBe(200);
    const verified = (await good.json()) as { tokens: Tokens };
    expect(verified.tokens.accessToken).toBeTruthy();

    // The challenge is single-use once verified.
    const replay = await app.request('/auth/mfa/verify', json({ mfaToken: challenge.mfaToken, code: await totpCode(secret) }));
    expect(replay.status).toBe(401);
  });

  it('recovery codes work exactly once', async () => {
    const { email, password, tokens } = await register();
    const { recoveryCodes } = await enroll(tokens.accessToken);

    async function challengeLogin(): Promise<string> {
      const res = await app.request('/auth/login', json({ email, password }));
      return ((await res.json()) as { mfaToken: string }).mfaToken;
    }

    const first = await app.request('/auth/mfa/verify', json({ mfaToken: await challengeLogin(), code: recoveryCodes[0] }));
    expect(first.status).toBe(200);
    const second = await app.request('/auth/mfa/verify', json({ mfaToken: await challengeLogin(), code: recoveryCodes[0] }));
    expect(second.status).toBe(401);
  });

  it('disable requires a valid code and restores plain logins', async () => {
    const { email, password, tokens } = await register();
    const { secret } = await enroll(tokens.accessToken);

    const bad = await app.request('/me/mfa/disable', json({ code: '000000' }, tokens.accessToken));
    expect(bad.status).toBe(401);
    const ok = await app.request('/me/mfa/disable', json({ code: await totpCode(secret) }, tokens.accessToken));
    expect(ok.status).toBe(200);

    const login = await app.request('/auth/login', json({ email, password }));
    const body = (await login.json()) as { tokens?: Tokens; mfaRequired?: boolean };
    expect(body.mfaRequired).toBeUndefined();
    expect(body.tokens?.accessToken).toBeTruthy();
  });

  it('tenant MFA requirement flags un-enrolled logins for setup', async () => {
    const { email, password, tokens } = await register();
    const set = await app.request('/users/mfa-requirement', {
      ...json({ required: true }, tokens.accessToken),
      method: 'PUT',
    });
    expect(set.status).toBe(200);

    const login = await app.request('/auth/login', json({ email, password }));
    const body = (await login.json()) as { mfaSetupRequired?: boolean; tokens?: Tokens };
    expect(body.mfaSetupRequired).toBe(true);
    expect(body.tokens?.accessToken).toBeTruthy(); // still signed in — setup happens in-app
  });

  it('enable without setup, or with a wrong first code, is rejected', async () => {
    const { tokens } = await register();
    const noSetup = await app.request('/me/mfa/enable', json({ code: '123456' }, tokens.accessToken));
    expect(noSetup.status).toBe(400);
    await app.request('/me/mfa/setup', json({}, tokens.accessToken));
    const wrong = await app.request('/me/mfa/enable', json({ code: '000000' }, tokens.accessToken));
    expect(wrong.status).toBe(401);
  });
});
