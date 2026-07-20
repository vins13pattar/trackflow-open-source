import { describe, expect, it } from 'vitest';
import { parseAlertLink } from './deep-link';

describe('parseAlertLink', () => {
  it('returns null for missing data', () => {
    expect(parseAlertLink(null)).toBeNull();
    expect(parseAlertLink(undefined)).toBeNull();
    expect(parseAlertLink({})).toBeNull();
  });

  it('returns null when alertId is missing or wrong type', () => {
    expect(parseAlertLink({ deviceId: 'd1' })).toBeNull();
    expect(parseAlertLink({ alertId: 42 })).toBeNull();
  });

  it('extracts alertId + deviceId + geofenceId', () => {
    const link = parseAlertLink({ alertId: 'a-1', deviceId: 'd-1', geofenceId: 'g-1' });
    expect(link).toEqual({ type: 'alert', alertId: 'a-1', deviceId: 'd-1', geofenceId: 'g-1' });
  });

  it('returns null deviceId / geofenceId when absent', () => {
    expect(parseAlertLink({ alertId: 'a-1' })).toEqual({ type: 'alert', alertId: 'a-1', deviceId: null, geofenceId: null });
  });

  it('ignores non-string deviceId / geofenceId values', () => {
    expect(parseAlertLink({ alertId: 'a-1', deviceId: 99, geofenceId: false })).toEqual({
      type: 'alert',
      alertId: 'a-1',
      deviceId: null,
      geofenceId: null,
    });
  });
});
