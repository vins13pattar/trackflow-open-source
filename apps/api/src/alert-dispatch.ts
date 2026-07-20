import { alerts, devices, eq, geofences, inArray, pushTokens, withSystem } from '@trackflow/db';
import { type ChannelName, type Recipients, dispatch } from '@trackflow/notifications';
import { type AlertEvent, publishAlert } from './bus.js';
import { db } from './db.js';
import { recordDeliveries } from './delivery-log.js';
import { getDispatchSettings, resolveEventChannels, suppressedByQuiet, throttleAllow } from './dispatch-rules.js';
import type { FiredAlert } from './geofence-service.js';
import { channelRegistry } from './notifications.js';
import { getNotificationContent } from './template-service.js';
import { meterEmail, meterSms, meterWhatsapp } from './usage-service.js';
import { deliverEvent } from './webhook-service.js';

/**
 * Publishes alerts to the live bus (dashboard SSE) and fans them out to the
 * configured channels, recording per-recipient delivery status. Fire-and-forget
 * from the request path; runs after the position transaction has committed.
 */
/** Bulk-loads { deviceName, geofenceName } for the fired alerts so each template
 *  render has structured variables to substitute (vs the pre-rendered title). */
async function loadDispatchVars(fired: FiredAlert[]): Promise<{
  devicesById: Map<string, string>;
  geofencesById: Map<string, string>;
}> {
  const deviceIds = [...new Set(fired.map((a) => a.deviceId))];
  const geofenceIds = [...new Set(fired.map((a) => a.geofenceId).filter((id): id is string => !!id))];
  const [deviceRows, geofenceRows] = await withSystem(db, async (tx) => {
    const d = deviceIds.length > 0
      ? await tx.select({ id: devices.id, name: devices.name }).from(devices).where(inArray(devices.id, deviceIds))
      : [];
    const g = geofenceIds.length > 0
      ? await tx.select({ id: geofences.id, name: geofences.name }).from(geofences).where(inArray(geofences.id, geofenceIds))
      : [];
    return [d, g];
  });
  return {
    devicesById: new Map(deviceRows.map((r) => [r.id, r.name])),
    geofencesById: new Map(geofenceRows.map((r) => [r.id, r.name])),
  };
}

export async function dispatchAlerts(tenantId: string, fired: FiredAlert[]): Promise<void> {
  if (fired.length === 0) return;
  const settings = await getDispatchSettings(tenantId);
  const { devicesById, geofencesById } = await loadDispatchVars(fired);

  for (const a of fired) {
    // Per-tenant dispatch rules: quiet hours (critical may bypass) and a
    // per-(device, event) throttle. The bus + webhook + DB record still fire
    // so the dashboard/audit sees the alert; only outbound channels are skipped.
    const quiet = suppressedByQuiet(a.severity, settings);
    const allowed = quiet ? false : await throttleAllow(tenantId, a.deviceId, a.type, settings);

    // Resolve content via the template engine when the tenant has an override
    // or the engine has a built-in for this event; otherwise fall back to the
    // alert's pre-rendered title/message (e.g. for adhoc/custom events).
    const deviceName = devicesById.get(a.deviceId) ?? '';
    const geofenceName = a.geofenceId ? (geofencesById.get(a.geofenceId) ?? '') : '';
    const rendered = await getNotificationContent(tenantId, a.type, {
      deviceName,
      geofenceName,
      time: a.createdAt,
      severity: a.severity,
    });
    const title = rendered?.subject ?? a.title;
    const body = rendered?.body ?? a.message;

    // Per-event routing override → fall back to the alert's own channels.
    const routeChannels = await resolveEventChannels(tenantId, a.type);
    const channelsForEvent = (routeChannels ?? a.channels) as ChannelName[];

    const event: AlertEvent = {
      id: a.id,
      deviceId: a.deviceId,
      geofenceId: a.geofenceId,
      type: a.type,
      severity: a.severity,
      title,
      message: body,
      lat: a.lat,
      lon: a.lon,
      createdAt: a.createdAt,
    };
    publishAlert(tenantId, event);
    void deliverEvent(tenantId, 'alert.triggered', event);

    // For the push channel, fan out to the tenant's registered device tokens.
    let recipients: Recipients = a.recipients;
    if (channelsForEvent.includes('push' as ChannelName)) {
      const rows = await withSystem(db, (tx) =>
        tx.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.tenantId, tenantId)),
      );
      recipients = { ...a.recipients, pushTokens: rows.map((r) => r.token) };
    }

    const results = allowed
      ? await dispatch(
          channelRegistry,
          channelsForEvent,
          { alertId: a.id, title, body, severity: a.severity, deviceId: a.deviceId, geofenceId: a.geofenceId ?? undefined },
          recipients,
        )
      : channelsForEvent.map((channel) => ({
          channel,
          recipient: 'suppressed',
          status: 'skipped' as const,
          error: quiet ? 'quiet-hours' : 'throttled',
          sentAt: Date.now(),
        }));

    if (allowed) {
      const sentOn = (ch: ChannelName) => results.filter((r) => r.channel === ch && r.status === 'sent').length;
      if (sentOn('sms') > 0) void meterSms(tenantId, sentOn('sms'));
      if (sentOn('whatsapp') > 0) void meterWhatsapp(tenantId, sentOn('whatsapp'));
      if (sentOn('email') > 0) void meterEmail(tenantId, sentOn('email'));
    }

    try {
      await withSystem(db, (tx) => tx.update(alerts).set({ notifications: results }).where(eq(alerts.id, a.id)));
      // Per-attempt delivery log (powers the UI log + the retry job). Records
      // the rendered title/body, so retries replay what we actually tried to send.
      await recordDeliveries(tenantId, a.id, title, body, results);
    } catch (err) {
      console.warn('[alerts] failed to persist delivery status:', (err as Error).message);
    }
  }
}
