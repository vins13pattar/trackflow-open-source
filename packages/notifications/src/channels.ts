import { type Channel, type DeliveryResult, type NotificationMessage, type Recipients, fail, ok, skip } from './types.js';

/** Always-on dev channel: logs and reports delivery. Proves the pipeline without secrets. */
export class ConsoleChannel implements Channel {
  readonly name = 'console' as const;
  async send(message: NotificationMessage): Promise<DeliveryResult[]> {
    console.log(`[notify:console] (${message.severity}) ${message.title} — ${message.body}`);
    return [ok('console', 'console')];
  }
}

/** Email via Resend's HTTP API (works on Node and Workers). Skips if unconfigured. */
export class EmailChannel implements Channel {
  readonly name = 'email' as const;
  constructor(
    private readonly apiKey?: string,
    private readonly from = 'TrackFlow <alerts@trackflow.app>',
  ) {}
  async send(message: NotificationMessage, recipients: Recipients): Promise<DeliveryResult[]> {
    const emails = recipients.emails ?? [];
    if (!this.apiKey) return emails.map((e) => skip('email', e, 'RESEND_API_KEY not set'));
    return Promise.all(
      emails.map(async (to) => {
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: this.from, to, subject: message.title, text: message.body }),
          });
          return res.ok ? ok('email', to) : fail('email', to, `HTTP ${res.status}`);
        } catch (err) {
          return fail('email', to, (err as Error).message);
        }
      }),
    );
  }
}

/** SMS via MSG91 (India). Skips if unconfigured. */
export class SmsChannel implements Channel {
  readonly name = 'sms' as const;
  constructor(
    private readonly apiKey?: string,
    private readonly sender = 'TRKFLW',
  ) {}
  async send(message: NotificationMessage, recipients: Recipients): Promise<DeliveryResult[]> {
    const phones = recipients.phones ?? [];
    if (!this.apiKey) return phones.map((p) => skip('sms', p, 'MSG91_API_KEY not set'));
    return Promise.all(
      phones.map(async (to) => {
        try {
          const res = await fetch('https://control.msg91.com/api/v5/flow/', {
            method: 'POST',
            headers: { authkey: this.apiKey!, 'content-type': 'application/json' },
            body: JSON.stringify({ sender: this.sender, mobiles: to, message: `${message.title}: ${message.body}` }),
          });
          return res.ok ? ok('sms', to) : fail('sms', to, `HTTP ${res.status}`);
        } catch (err) {
          return fail('sms', to, (err as Error).message);
        }
      }),
    );
  }
}

/** Generic outbound webhook (HTTP POST of the alert payload). */
export class WebhookChannel implements Channel {
  readonly name = 'webhook' as const;
  async send(message: NotificationMessage, recipients: Recipients): Promise<DeliveryResult[]> {
    const url = recipients.webhookUrl;
    if (!url) return [skip('webhook', '-', 'no webhookUrl configured')];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-trackflow-event': 'alert.triggered' },
        body: JSON.stringify({ event: 'alert.triggered', alert: message }),
      });
      return [res.ok ? ok('webhook', url) : fail('webhook', url, `HTTP ${res.status}`)];
    } catch (err) {
      return [fail('webhook', url, (err as Error).message)];
    }
  }
}

/** Push via Expo's push service (works for both FCM and APNs under the hood). */
export class ExpoPushChannel implements Channel {
  readonly name = 'push' as const;
  async send(message: NotificationMessage, recipients: Recipients): Promise<DeliveryResult[]> {
    const tokens = recipients.pushTokens ?? [];
    if (tokens.length === 0) return [skip('push', '-', 'no push tokens registered')];
    // Carry alertId/deviceId in the `data` payload so the mobile app can
    // deep-link to the right screen when the user taps the notification.
    const data: Record<string, string> = { alertId: message.alertId };
    if (message.deviceId) data.deviceId = message.deviceId;
    if (message.geofenceId) data.geofenceId = message.geofenceId;
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({ to, title: message.title, body: message.body, sound: 'default', data }))),
      });
      return tokens.map((to) => (res.ok ? ok('push', to) : fail('push', to, `HTTP ${res.status}`)));
    } catch (err) {
      return tokens.map((to) => fail('push', to, (err as Error).message));
    }
  }
}

/** WhatsApp via Meta Cloud API. Skips per-recipient when unconfigured. Sends a
 *  plain text message (works within the 24h customer-service window or when the
 *  recipient initiated; outside that window Meta requires an approved template
 *  — operators configure those at the WhatsApp Business level). */
export class WhatsappChannel implements Channel {
  readonly name = 'whatsapp' as const;
  constructor(
    private readonly accessToken?: string,
    private readonly phoneNumberId?: string,
  ) {}
  async send(message: NotificationMessage, recipients: Recipients): Promise<DeliveryResult[]> {
    const phones = recipients.phones ?? [];
    if (!this.accessToken || !this.phoneNumberId) {
      return phones.map((p) => skip('whatsapp', p, 'WHATSAPP_TOKEN/PHONE_ID not set'));
    }
    const url = `https://graph.facebook.com/v22.0/${this.phoneNumberId}/messages`;
    return Promise.all(
      phones.map(async (to) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to,
              type: 'text',
              text: { body: `${message.title}\n${message.body}` },
            }),
          });
          return res.ok ? ok('whatsapp', to) : fail('whatsapp', to, `HTTP ${res.status}`);
        } catch (err) {
          return fail('whatsapp', to, (err as Error).message);
        }
      }),
    );
  }
}

/** Placeholder for channels not yet wired (kept for future channels). */
export class UnconfiguredChannel implements Channel {
  constructor(readonly name: 'whatsapp') {}
  async send(): Promise<DeliveryResult[]> {
    return [skip(this.name, '-', `${this.name} channel not configured`)];
  }
}
