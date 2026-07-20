import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  totpCode,
  verifyTotp,
} from './totp.js';

// RFC 6238 Appendix B test secret: ASCII "12345678901234567890".
const RFC_TOTP_VECTOR_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 17, 42, 99, 128]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('encodes the RFC secret', () => {
    expect(base32Encode(new TextEncoder().encode('12345678901234567890'))).toBe(RFC_TOTP_VECTOR_B32);
  });
});

describe('totp (RFC 6238 SHA-1 vectors)', () => {
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it('matches the published 8-digit vectors', async () => {
    for (const [t, expected] of vectors) {
      expect(await totpCode(RFC_TOTP_VECTOR_B32, { digits: 8, timestampMs: t * 1000 })).toBe(expected);
    }
  });

  it('6-digit codes are the truncation of the 8-digit ones', async () => {
    expect(await totpCode(RFC_TOTP_VECTOR_B32, { timestampMs: 59 * 1000 })).toBe('287082');
  });

  it('verifies within the skew window and rejects outside it', async () => {
    const now = 1111111111 * 1000;
    const code = await totpCode(RFC_TOTP_VECTOR_B32, { timestampMs: now });
    expect(await verifyTotp(RFC_TOTP_VECTOR_B32, code, { timestampMs: now })).toBe(true);
    // One step earlier still passes (±1 window)…
    expect(await verifyTotp(RFC_TOTP_VECTOR_B32, code, { timestampMs: now + 30_000 })).toBe(true);
    // …two steps later does not.
    expect(await verifyTotp(RFC_TOTP_VECTOR_B32, code, { timestampMs: now + 90_000 })).toBe(false);
    expect(await verifyTotp(RFC_TOTP_VECTOR_B32, '000000', { timestampMs: now })).toBe(false);
    expect(await verifyTotp(RFC_TOTP_VECTOR_B32, 'not-a-code', { timestampMs: now })).toBe(false);
  });
});

describe('secrets, URIs and recovery codes', () => {
  it('generates a 32-char base32 secret', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s).length).toBe(20);
  });

  it('builds an otpauth URI apps can parse', () => {
    const uri = otpauthUri({ secret: RFC_TOTP_VECTOR_B32, accountName: 'a@b.co', issuer: 'TrackFlow' });
    expect(uri).toContain('otpauth://totp/TrackFlow:a%40b.co?');
    expect(uri).toContain(`secret=${RFC_TOTP_VECTOR_B32}`);
    expect(uri).toContain('issuer=TrackFlow');
  });

  it('recovery codes are unique, well-formed, and hash case/dash-insensitively', async () => {
    const codes = generateRecoveryCodes();
    expect(codes.length).toBe(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    const h1 = await hashRecoveryCode(codes[0]!);
    expect(await hashRecoveryCode(codes[0]!.toLowerCase().replace('-', ' '))).toBe(h1);
    expect(await hashRecoveryCode(codes[1]!)).not.toBe(h1);
  });
});
