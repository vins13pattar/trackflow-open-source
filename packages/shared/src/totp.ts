/**
 * TOTP (RFC 6238) over the Web Crypto API — dependency-free and portable to
 * both Node and Cloudflare Workers, mirroring the password.ts / jwt.ts choice.
 *
 * Secrets are RFC 4648 base32 (the format authenticator apps expect in
 * otpauth:// URIs). Codes are HMAC-SHA1 HOTP truncations over a 30s step.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 160-bit random secret, base32-encoded (the size RFC 4226 recommends for SHA-1). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const keyBuf = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  const dataBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const k = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dataBuf));
}

export interface TotpOptions {
  digits?: number; // default 6
  stepSeconds?: number; // default 30
  timestampMs?: number; // default Date.now()
}

/** The TOTP code for a base32 secret at a moment in time. */
export async function totpCode(secretB32: string, opts: TotpOptions = {}): Promise<string> {
  const digits = opts.digits ?? 6;
  const step = opts.stepSeconds ?? 30;
  const counter = Math.floor((opts.timestampMs ?? Date.now()) / 1000 / step);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const mac = await hmacSha1(base32Decode(secretB32), msg);
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Verifies a code within ±`window` time steps (default ±1 → 90s of clock skew). */
export async function verifyTotp(
  secretB32: string,
  code: string,
  opts: TotpOptions & { window?: number } = {},
): Promise<boolean> {
  const window = opts.window ?? 1;
  const step = (opts.stepSeconds ?? 30) * 1000;
  const now = opts.timestampMs ?? Date.now();
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6,8}$/.test(normalized)) return false;
  let match = false;
  // Check every step in the window (no early exit) to keep timing uniform.
  for (let i = -window; i <= window; i++) {
    const expected = await totpCode(secretB32, { ...opts, timestampMs: now + i * step });
    let diff = expected.length ^ normalized.length;
    for (let j = 0; j < Math.min(expected.length, normalized.length); j++) {
      diff |= expected.charCodeAt(j) ^ normalized.charCodeAt(j);
    }
    if (diff === 0) match = true;
  }
  return match;
}

/** otpauth:// URI for authenticator-app enrollment (QR or manual entry). */
export function otpauthUri(input: { secret: string; accountName: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------- Recovery codes ----------

/** Unambiguous alphabet (no 0/O/1/I/L) for codes a human reads back. */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** One-time recovery codes in the form XXXXX-XXXXX. Store only their hashes. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let raw = '';
    for (const b of bytes) raw += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** SHA-256 hex of a normalized (case/space/dash-insensitive) recovery code. */
export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = code.toUpperCase().replace(/[\s-]/g, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
