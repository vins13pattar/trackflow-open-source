/**
 * JWT issue/verify using `jose` — chosen over `jsonwebtoken` because it runs
 * unchanged on both Node (the API container) and the edge (Cloudflare Workers),
 * which is core to the "portable Hono API" decision in the plan.
 */
import { SignJWT, jwtVerify } from 'jose';
import { AppError } from './errors.js';

export interface AccessClaims {
  sub: string; // userId
  tid: string; // tenantId
  role: string;
  type: 'access' | 'refresh';
  jti?: string; // refresh-token id (for rotation/revocation)
}

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: number; // seconds
  refreshTtl: number; // seconds
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

async function sign(
  claims: Omit<AccessClaims, 'type'>,
  type: AccessClaims['type'],
  secret: string,
  ttl: number,
): Promise<string> {
  return new SignJWT({ ...claims, type })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(key(secret));
}

export async function issueTokens(
  claims: Omit<AccessClaims, 'type' | 'jti'>,
  cfg: JwtConfig,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; jti: string }> {
  const jti = crypto.randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    sign(claims, 'access', cfg.accessSecret, cfg.accessTtl),
    sign({ ...claims, jti }, 'refresh', cfg.refreshSecret, cfg.refreshTtl),
  ]);
  return { accessToken, refreshToken, expiresIn: cfg.accessTtl, jti };
}

export async function verifyToken(
  token: string,
  type: AccessClaims['type'],
  cfg: JwtConfig,
): Promise<AccessClaims> {
  const secret = type === 'access' ? cfg.accessSecret : cfg.refreshSecret;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    if (payload.type !== type) throw new AppError('INVALID_TOKEN', 'Wrong token type');
    return payload as unknown as AccessClaims;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('TOKEN_EXPIRED', 'Token invalid or expired');
  }
}
