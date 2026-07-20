export type ChannelName = 'console' | 'email' | 'sms' | 'webhook' | 'push' | 'whatsapp';

export interface NotificationMessage {
  alertId: string;
  title: string;
  body: string;
  severity: string;
  deviceName?: string;
  deviceId?: string;
  geofenceId?: string;
  data?: Record<string, unknown>;
}

export interface Recipients {
  emails?: string[];
  phones?: string[];
  webhookUrl?: string;
  pushTokens?: string[];
}

export interface DeliveryResult {
  channel: ChannelName;
  recipient: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  sentAt: number;
}

export interface Channel {
  readonly name: ChannelName;
  send(message: NotificationMessage, recipients: Recipients): Promise<DeliveryResult[]>;
}

export const ok = (channel: ChannelName, recipient: string): DeliveryResult => ({
  channel,
  recipient,
  status: 'sent',
  sentAt: Date.now(),
});
export const fail = (channel: ChannelName, recipient: string, error: string): DeliveryResult => ({
  channel,
  recipient,
  status: 'failed',
  error,
  sentAt: Date.now(),
});
export const skip = (channel: ChannelName, recipient: string, error: string): DeliveryResult => ({
  channel,
  recipient,
  status: 'skipped',
  error,
  sentAt: Date.now(),
});
