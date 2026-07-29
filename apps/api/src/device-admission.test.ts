import { describe, expect, it } from 'vitest';
import { evaluateDeviceAdmission, type DeviceAdmissionRecord } from './routes/positions.js';

const active: DeviceAdmissionRecord = { imei: '123456789012345', protocol: 'gt06', status: 'active' };
const base = {
  imei: active.imei,
  protocol: 'gt06' as const,
  transportSecurity: 'mtls' as const,
  authenticatedImei: active.imei,
};

describe('device ingest admission', () => {
  it('rejects unknown, inactive, and mismatched devices', () => {
    expect(evaluateDeviceAdmission(null, base, true)).toEqual({ allowed: false, reason: 'unknown_imei' });
    expect(evaluateDeviceAdmission({ ...active, status: 'suspended' }, base, true)).toEqual({
      allowed: false,
      reason: 'inactive',
    });
    expect(evaluateDeviceAdmission({ ...active, protocol: 'h02' }, base, true)).toEqual({
      allowed: false,
      reason: 'protocol_mismatch',
    });
  });

  it('requires certificate identity to match the registered IMEI', () => {
    expect(evaluateDeviceAdmission(active, { ...base, authenticatedImei: '999999999999999' }, true)).toEqual({
      allowed: false,
      reason: 'identity_mismatch',
    });
  });

  it('forbids raw development identity in production', () => {
    expect(evaluateDeviceAdmission(active, { ...base, transportSecurity: 'development' }, true)).toEqual({
      allowed: false,
      reason: 'development_forbidden',
    });
  });

  it('allows an active matching device over mTLS', () => {
    expect(evaluateDeviceAdmission(active, base, true)).toEqual({ allowed: true, reason: 'allowed' });
  });
});
