/**
 * Push deep-linking — parses the `data` payload our backend sends with
 * each push and exposes a helper that turns a notification response into a
 * route the app can navigate to.
 *
 * Backend (apps/api/src/alert-dispatch.ts → ExpoPushChannel) carries
 * `alertId`, `deviceId`, `geofenceId` in the push payload. On tap, the
 * mobile app calls `parseAlertLink` to decide which screen to open.
 */

export interface AlertLink {
  type: 'alert';
  alertId: string;
  deviceId: string | null;
  geofenceId: string | null;
}

export type DeepLink = AlertLink;

/**
 * Pulls an AlertLink out of an Expo notification response, returning null
 * if the payload didn't carry an alertId (e.g. a generic info push).
 */
export function parseAlertLink(data: Record<string, unknown> | null | undefined): AlertLink | null {
  if (!data) return null;
  const alertId = typeof data.alertId === 'string' ? data.alertId : null;
  if (!alertId) return null;
  return {
    type: 'alert',
    alertId,
    deviceId: typeof data.deviceId === 'string' ? data.deviceId : null,
    geofenceId: typeof data.geofenceId === 'string' ? data.geofenceId : null,
  };
}
