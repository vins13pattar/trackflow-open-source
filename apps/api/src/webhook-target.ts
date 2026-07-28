import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type Resolver = (hostname: string) => Promise<Array<{ address: string }>>;

function privateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(input: string): boolean {
  const address = input.toLowerCase().split('%')[0]!;
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) !== 6) return true;
  if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(address) || address.startsWith('ff')) return true;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? privateIpv4(mapped) : false;
}

const systemResolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Validates tenant-configured webhook destinations before an outbound request.
 * Tests may inject a resolver; production callers always use the system DNS
 * result and revalidate on each delivery.
 */
export async function validateWebhookTarget(raw: string, resolve: Resolver = systemResolver): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Webhook URL must use http or https');
  if (url.username || url.password) throw new Error('Webhook URL must not contain credentials');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Production webhook URL must use https');
  }

  // Local HTTP receivers are useful in the DB integration suite, but private
  // destinations are never enabled merely by running in development/staging.
  if (process.env.NODE_ENV === 'test') return url;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Webhook URL must not target a local hostname');
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) throw new Error('Webhook URL must not target a private address');

  const addresses = await resolve(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Webhook hostname must resolve only to public addresses');
  }
  return url;
}
