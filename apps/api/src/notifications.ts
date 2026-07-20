import { buildRegistry } from '@trackflow/notifications';
import { env } from './env.js';

/** Channel registry built once from env-driven config. */
export const channelRegistry = buildRegistry({
  resendApiKey: env.notifications.resendApiKey,
  emailFrom: env.notifications.emailFrom,
  msg91ApiKey: env.notifications.msg91ApiKey,
  smsSender: env.notifications.smsSender,
  whatsappToken: env.notifications.whatsappToken,
  whatsappPhoneId: env.notifications.whatsappPhoneId,
});
