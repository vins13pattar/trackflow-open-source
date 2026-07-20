/**
 * Password hashing with PBKDF2 over the Web Crypto API.
 *
 * Deliberately dependency-free and portable: `globalThis.crypto.subtle` exists
 * on Node 22 and Cloudflare Workers, so auth works identically in the API
 * container and at the edge. (Native bcrypt would not run on Workers.)
 */
const ITERATIONS = 100_000;
const KEY_LEN = 32;

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  // Copy the Uint8Array into a fresh ArrayBuffer so the type narrows to the
  // ArrayBuffer-only BufferSource that newer Web Crypto type definitions require
  // (a SharedArrayBuffer-backed view isn't assignable). Runtime behaviour is
  // unchanged — PBKDF2 reads the same bytes either way.
  const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-256' },
    key,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
  const expected = fromB64(hashB64);
  const actual = await derive(password, fromB64(saltB64), Number(iterStr));
  if (actual.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
