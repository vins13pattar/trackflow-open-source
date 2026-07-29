import type tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import {
  assertSecureIngestConfig,
  ConnectionGate,
  imeiFromPeerCertificate,
  normalizeIp,
  SourceAllowList,
  type TransportSecurityConfig,
} from './transport-security.js';

function config(overrides: Partial<TransportSecurityConfig> = {}): TransportSecurityConfig {
  return {
    mode: 'development',
    allowedCidrs: [],
    maxConnections: 2,
    maxConnectionsPerIp: 1,
    idleTimeoutMs: 1_000,
    handshakeTimeoutMs: 1_000,
    ...overrides,
  };
}

describe('secure ingest configuration', () => {
  it('forbids IMEI-only development mode in production', () => {
    expect(() => assertSecureIngestConfig(config(), true)).toThrow(/forbidden in production/);
  });

  it('requires a source allow-list for private gateway mode', () => {
    expect(() => assertSecureIngestConfig(config({ mode: 'private_gateway' }), true)).toThrow(/INGEST_ALLOWED_CIDRS/);
  });

  it('requires all mTLS trust material in production', () => {
    expect(() => assertSecureIngestConfig(config({ mode: 'mtls' }), true)).toThrow(/requires INGEST_TLS/);
    expect(() =>
      assertSecureIngestConfig(config({ mode: 'mtls', tlsCertPem: 'cert', tlsKeyPem: 'key', tlsCaPem: 'ca' }), true),
    ).not.toThrow();
  });
});

describe('source controls', () => {
  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:10.1.2.3')).toEqual({ address: '10.1.2.3', type: 'ipv4' });
  });

  it('supports IPv4 and IPv6 CIDR ranges', () => {
    const list = new SourceAllowList(['10.0.0.0/8', '2001:db8::/32']);
    expect(list.allows('10.2.3.4')).toBe(true);
    expect(list.allows('::ffff:10.2.3.4')).toBe(true);
    expect(list.allows('2001:db8::123')).toBe(true);
    expect(list.allows('192.168.1.1')).toBe(false);
  });

  it('enforces global and per-source connection limits', () => {
    const gate = new ConnectionGate(config({ mode: 'private_gateway', allowedCidrs: ['10.0.0.0/8'] }));
    expect(gate.tryOpen('192.168.1.1')).toEqual({ accepted: false, reason: 'source_not_allowed' });
    expect(gate.tryOpen('10.0.0.1')).toEqual({ accepted: true, source: '10.0.0.1' });
    expect(gate.tryOpen('10.0.0.1')).toEqual({ accepted: false, reason: 'source_limit' });
    expect(gate.tryOpen('10.0.0.2')).toEqual({ accepted: true, source: '10.0.0.2' });
    expect(gate.tryOpen('10.0.0.3')).toEqual({ accepted: false, reason: 'global_limit' });
    gate.close('10.0.0.1');
    expect(gate.tryOpen('10.0.0.3')).toEqual({ accepted: true, source: '10.0.0.3' });
  });
});

describe('certificate identity', () => {
  it('extracts an IMEI from the certificate SAN URI', () => {
    const cert = { subjectaltname: 'DNS:tracker.example, URI:urn:trackflow:imei:123456789012345' } as tls.PeerCertificate;
    expect(imeiFromPeerCertificate(cert)).toBe('123456789012345');
  });

  it('accepts a scoped CN and rejects an unrelated CN', () => {
    expect(imeiFromPeerCertificate({ subject: { CN: 'imei:123456789012345' } } as tls.PeerCertificate)).toBe(
      '123456789012345',
    );
    expect(imeiFromPeerCertificate({ subject: { CN: 'tracker.example' } } as tls.PeerCertificate)).toBeNull();
  });
});
