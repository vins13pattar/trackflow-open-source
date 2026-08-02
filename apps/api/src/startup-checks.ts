/** Dev-default secret values that must never be used in production. */
const DEV_DEFAULTS: Record<string, string> = {
  JWT_ACCESS_SECRET: 'dev-access-secret-change-me',
  JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me',
  INGEST_SINK_TOKEN: 'dev-ingest-token-change-me',
};

/**
 * Refuses to boot in production with built-in dev secrets — a predictable JWT
 * signing key or ingest token would let anyone forge access tokens or push
 * positions. No-op outside production. Reads process.env at call time.
 */
export function assertSecureConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const unset = Object.entries(DEV_DEFAULTS)
    .filter(([k, dflt]) => (process.env[k] ?? dflt) === dflt)
    .map(([k]) => k);
  if (unset.length > 0) {
    throw new Error(`Refusing to start in production with default dev secret(s): ${unset.join(', ')}. Set strong values.`);
  }

  const tenantUrl = process.env.DATABASE_URL;
  const systemUrl = process.env.SYSTEM_DATABASE_URL;
  if (!tenantUrl || !systemUrl) {
    throw new Error('Refusing to start in production without distinct DATABASE_URL and SYSTEM_DATABASE_URL values.');
  }
  if (tenantUrl === systemUrl) {
    throw new Error('Refusing to start in production: tenant and system database identities must be distinct.');
  }
}
