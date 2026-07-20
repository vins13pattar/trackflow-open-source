/**
 * S3 / Cloudflare R2 object storage with a minimal AWS Signature V4 client.
 *
 * We don't pull in @aws-sdk/client-s3 — it's a 2 MB dep tree for a handful of
 * operations. SigV4 PUT/GET-presign covers everything we need:
 *
 *   - putObject(key, body, contentType)   — upload an invoice PDF or a report
 *   - getSignedUrl(key, expiresInSec)     — share a download link
 *
 * Gated on the standard S3-style env vars:
 *   - S3_ENDPOINT      e.g. https://<accountId>.r2.cloudflarestorage.com
 *   - S3_REGION        usually "auto" for R2, "us-east-1" for AWS
 *   - S3_BUCKET
 *   - S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   - S3_PUBLIC_BASE_URL  (optional) — when set, putObject returns a public URL
 *                                       over this base instead of the
 *                                       endpoint+bucket. Use this when the
 *                                       bucket is fronted by a custom domain.
 *
 * When any required var is missing the helpers degrade to a no-op: `putObject`
 * stores nothing and returns null, so callers fall back to their local-file
 * behaviour and dev work isn't blocked.
 */
import { createHash, createHmac } from 'node:crypto';

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
}

export function loadStorageConfig(): StorageConfig | null {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? 'auto';
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, publicBaseUrl: process.env.S3_PUBLIC_BASE_URL };
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function isoNow(): { amzDate: string; dateStamp: string } {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const amzDate =
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z';
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(cfg: StorageConfig, dateStamp: string): Buffer {
  const kDate = hmacSha256(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, cfg.region);
  const kService = hmacSha256(kRegion, 's3');
  return hmacSha256(kService, 'aws4_request');
}

function encodePath(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/** Uploads an object via SigV4-signed PUT. Returns null when storage isn't
 *  configured (so callers can fall back to a local copy). */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<string | null> {
  const cfg = loadStorageConfig();
  if (!cfg) return null;
  const { amzDate, dateStamp } = isoNow();
  const path = `/${cfg.bucket}/${encodePath(key)}`;
  const host = new URL(cfg.endpoint).host;
  const payloadHash = sha256Hex(body);

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256(signingKey(cfg, dateStamp), stringToSign).toString('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`${cfg.endpoint}${path}`, {
    method: 'PUT',
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization,
      'content-type': contentType,
      'content-length': String(body.length),
    },
    // Newer @types/node tighten BodyInit to ArrayBuffer-backed views only;
    // Buffer is a Uint8Array<ArrayBufferLike> at the type level, so we copy
    // through a fresh ArrayBuffer Blob to satisfy the constraint without
    // changing the wire bytes.
    body: new Blob([new Uint8Array(body)]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 putObject ${key} failed: ${res.status} ${text}`);
  }
  return cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/${encodePath(key)}` : `${cfg.endpoint}${path}`;
}

/** Generates an expiring pre-signed GET URL. Useful for invoice-PDF / report
 *  downloads from a private bucket. Returns null when storage isn't configured. */
export function getSignedUrl(key: string, expiresInSec = 3600): string | null {
  const cfg = loadStorageConfig();
  if (!cfg) return null;
  const { amzDate, dateStamp } = isoNow();
  const path = `/${cfg.bucket}/${encodePath(key)}`;
  const host = new URL(cfg.endpoint).host;
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const credential = `${cfg.accessKeyId}/${credentialScope}`;

  const params = new URLSearchParams();
  params.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  params.set('X-Amz-Credential', credential);
  params.set('X-Amz-Date', amzDate);
  params.set('X-Amz-Expires', String(expiresInSec));
  params.set('X-Amz-SignedHeaders', 'host');
  // URLSearchParams must be in sorted order for canonical request.
  const sorted = Array.from(params.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalQuery = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  const canonicalRequest = `GET\n${path}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256(signingKey(cfg, dateStamp), stringToSign).toString('hex');
  return `${cfg.endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function storageConfigured(): boolean {
  return loadStorageConfig() !== null;
}
