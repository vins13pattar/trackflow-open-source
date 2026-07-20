import {
  ConsoleChannel,
  EmailChannel,
  ExpoPushChannel,
  SmsChannel,
  WebhookChannel,
  WhatsappChannel,
} from './channels.js';
import type { Channel, ChannelName, DeliveryResult, NotificationMessage, Recipients } from './types.js';

export interface NotificationConfig {
  resendApiKey?: string;
  emailFrom?: string;
  msg91ApiKey?: string;
  smsSender?: string;
  whatsappToken?: string;
  whatsappPhoneId?: string;
}

/** Builds the channel registry from environment-driven config. */
export function buildRegistry(cfg: NotificationConfig = {}): Record<ChannelName, Channel> {
  return {
    console: new ConsoleChannel(),
    email: new EmailChannel(cfg.resendApiKey, cfg.emailFrom),
    sms: new SmsChannel(cfg.msg91ApiKey, cfg.smsSender),
    webhook: new WebhookChannel(),
    push: new ExpoPushChannel(),
    whatsapp: new WhatsappChannel(cfg.whatsappToken, cfg.whatsappPhoneId),
  };
}

/** Fans a message out to the requested channels, collecting per-recipient results. */
export async function dispatch(
  registry: Record<ChannelName, Channel>,
  channels: ChannelName[],
  message: NotificationMessage,
  recipients: Recipients,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  for (const name of channels) {
    const channel = registry[name];
    if (!channel) continue;
    try {
      results.push(...(await channel.send(message, recipients)));
    } catch (err) {
      results.push({ channel: name, recipient: '-', status: 'failed', error: (err as Error).message, sentAt: Date.now() });
    }
  }
  return results;
}
