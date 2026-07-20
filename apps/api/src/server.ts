import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { startOfflineSweep } from './device-events.js';
import { env } from './env.js';
import { assertSecureConfig } from './startup-checks.js';

assertSecureConfig();

serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  console.log(`[api] TrackFlow API listening on http://localhost:${info.port}`);
});

// Periodically flip devices that stopped reporting to offline (single-instance;
// production would run this as a leader-elected cron / Cloud Run Job).
startOfflineSweep();
