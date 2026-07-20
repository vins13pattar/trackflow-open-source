/**
 * API key generation and hashing. Keys are high-entropy random tokens, so a
 * fast SHA-256 (not a slow KDF) is the right hash; only the hash is stored. A
 * short non-secret `prefix` is kept for display and indexed lookup.
 */
const PREFIX_LEN = 16; // "tf_live_" + 8 chars

function randomToken(bytes = 24): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(buf).toString('base64url');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Buffer.from(new Uint8Array(digest)).toString('hex');
}

export interface GeneratedApiKey {
  key: string; // shown to the user once
  prefix: string;
  hash: string;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const key = `tf_live_${randomToken(24)}`;
  return { key, prefix: key.slice(0, PREFIX_LEN), hash: await sha256Hex(key) };
}

export async function apiKeyParts(key: string): Promise<{ prefix: string; hash: string }> {
  return { prefix: key.slice(0, PREFIX_LEN), hash: await sha256Hex(key) };
}
