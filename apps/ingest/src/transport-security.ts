import { readFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

export type IngestSecurityMode = 'development' | 'mtls' | 'private_gateway';
export type TransportIdentity =
  | { kind: 'development' }
  | { kind: 'private_gateway' }
  | { kind: 'mtls'; imei: string; fingerprint256: string };

export interface TransportSecurityConfig {
  mode: IngestSecurityMode;
  allowedCidrs: string[];
  maxConnections: number;
  maxConnectionsPerIp: number;
  idleTimeoutMs: number;
  handshakeTimeoutMs: number;
  tlsCertPem?: string;
  tlsKeyPem?: string;
  tlsCaPem?: string;
}

const IMEI = /^\d{6,17}$/;

function positiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

export function loadPem(envName: string, fileEnvName: string): string | undefined {
  const inline = process.env[envName];
  const file = process.env[fileEnvName];
  if (inline && file) throw new Error(`Set only one of ${envName} or ${fileEnvName}`);
  if (inline) return inline.replaceAll('\\n', '\n');
  if (file) return readFileSync(file, 'utf8');
  return undefined;
}

export function assertSecureIngestConfig(config: TransportSecurityConfig, production: boolean): void {
  positiveInteger('INGEST_MAX_CONNECTIONS', config.maxConnections);
  positiveInteger('INGEST_MAX_CONNECTIONS_PER_IP', config.maxConnectionsPerIp);
  positiveInteger('INGEST_SOCKET_IDLE_TIMEOUT_MS', config.idleTimeoutMs);
  positiveInteger('INGEST_TLS_HANDSHAKE_TIMEOUT_MS', config.handshakeTimeoutMs);

  if (!production) return;
  if (config.mode === 'development') {
    throw new Error('INGEST_SECURITY_MODE=development is forbidden in production; use mtls or private_gateway');
  }
  if (config.mode === 'private_gateway' && config.allowedCidrs.length === 0) {
    throw new Error('INGEST_ALLOWED_CIDRS is required for private_gateway mode');
  }
  if (config.mode === 'mtls' && (!config.tlsCertPem || !config.tlsKeyPem || !config.tlsCaPem)) {
    throw new Error('mTLS mode requires INGEST_TLS_CERT/KEY/CA_PEM or their *_FILE variants');
  }
}

export function normalizeIp(input: string | undefined): { address: string; type: 'ipv4' | 'ipv6' } | null {
  if (!input) return null;
  const zoneFree = input.split('%')[0]!;
  const mapped = zoneFree.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const address = mapped ?? zoneFree;
  const version = net.isIP(address);
  if (version === 4) return { address, type: 'ipv4' };
  if (version === 6) return { address, type: 'ipv6' };
  return null;
}

export class SourceAllowList {
  private readonly blocks = new net.BlockList();
  readonly configured: boolean;

  constructor(cidrs: string[]) {
    this.configured = cidrs.length > 0;
    for (const raw of cidrs) {
      const [address, prefixRaw] = raw.trim().split('/');
      const normalized = normalizeIp(address);
      if (!normalized) throw new Error(`Invalid CIDR address: ${raw}`);
      const maxPrefix = normalized.type === 'ipv4' ? 32 : 128;
      const prefix = prefixRaw === undefined ? maxPrefix : Number(prefixRaw);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        throw new Error(`Invalid CIDR prefix: ${raw}`);
      }
      this.blocks.addSubnet(normalized.address, prefix, normalized.type);
    }
  }

  allows(remoteAddress: string | undefined): boolean {
    if (!this.configured) return true;
    const normalized = normalizeIp(remoteAddress);
    return !!normalized && this.blocks.check(normalized.address, normalized.type);
  }
}

export type ConnectionRejection = 'invalid_source' | 'source_not_allowed' | 'global_limit' | 'source_limit';

export class ConnectionGate {
  private total = 0;
  private readonly perSource = new Map<string, number>();
  private readonly allowList: SourceAllowList;

  constructor(private readonly config: TransportSecurityConfig) {
    this.allowList = new SourceAllowList(config.allowedCidrs);
  }

  tryOpen(remoteAddress: string | undefined): { accepted: true; source: string } | { accepted: false; reason: ConnectionRejection } {
    const normalized = normalizeIp(remoteAddress);
    if (!normalized) return { accepted: false, reason: 'invalid_source' };
    if (this.config.mode === 'private_gateway' && !this.allowList.allows(remoteAddress)) {
      return { accepted: false, reason: 'source_not_allowed' };
    }
    if (this.total >= this.config.maxConnections) return { accepted: false, reason: 'global_limit' };
    const count = this.perSource.get(normalized.address) ?? 0;
    if (count >= this.config.maxConnectionsPerIp) return { accepted: false, reason: 'source_limit' };
    this.total += 1;
    this.perSource.set(normalized.address, count + 1);
    return { accepted: true, source: normalized.address };
  }

  close(source: string): void {
    const count = this.perSource.get(source) ?? 0;
    if (count <= 1) this.perSource.delete(source);
    else this.perSource.set(source, count - 1);
    if (this.total > 0) this.total -= 1;
  }
}

export function imeiFromPeerCertificate(cert: tls.PeerCertificate): string | null {
  const san = cert.subjectaltname ?? '';
  const uriMatch = san.match(/(?:^|,\s*)URI:urn:trackflow:imei:(\d{6,17})(?:,|$)/i)?.[1];
  if (uriMatch && IMEI.test(uriMatch)) return uriMatch;
  const rawCn = cert.subject?.CN;
  const cn = (Array.isArray(rawCn) ? rawCn[0] : rawCn)?.trim() ?? '';
  const cnMatch = cn.match(/^imei:(\d{6,17})$/i)?.[1] ?? (IMEI.test(cn) ? cn : undefined);
  return cnMatch && IMEI.test(cnMatch) ? cnMatch : null;
}

export function identifyTransport(socket: net.Socket, mode: IngestSecurityMode): TransportIdentity {
  if (mode === 'development') return { kind: 'development' };
  if (mode === 'private_gateway') return { kind: 'private_gateway' };
  if (!(socket instanceof tls.TLSSocket) || !socket.authorized) {
    throw new Error('Client certificate was not authorized');
  }
  const cert = socket.getPeerCertificate();
  const imei = imeiFromPeerCertificate(cert);
  if (!imei) throw new Error('Client certificate must contain URI urn:trackflow:imei:<imei> or CN imei:<imei>');
  if (!cert.fingerprint256) throw new Error('Client certificate fingerprint is unavailable');
  return { kind: 'mtls', imei, fingerprint256: cert.fingerprint256 };
}

export function createTransportServer(config: TransportSecurityConfig, onConnection: (socket: net.Socket) => void): net.Server {
  if (config.mode !== 'mtls') return net.createServer(onConnection);
  return tls.createServer(
    {
      cert: config.tlsCertPem,
      key: config.tlsKeyPem,
      ca: config.tlsCaPem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      handshakeTimeout: config.handshakeTimeoutMs,
    },
    onConnection,
  );
}
