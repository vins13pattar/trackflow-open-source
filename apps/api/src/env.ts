import type { JwtConfig } from '@trackflow/shared';

export const env = {
  port: Number(process.env.API_PORT ?? 8787),
  // Runtime connects as the non-superuser app role so RLS is enforced.
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://trackflow_app:trackflow_app@localhost:5432/trackflow',
  ingestToken: process.env.INGEST_SINK_TOKEN ?? 'dev-ingest-token-change-me',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  // Platform-operator admin API token (plan/rate management). No default: when
  // unset the /admin API is disabled. Read lazily so it can be set per-process.
  get adminToken(): string | undefined {
    return process.env.ADMIN_API_TOKEN;
  },
  // Sentry DSN for error reporting (read lazily; unset = errors are only logged).
  get sentryDsn(): string | undefined {
    return process.env.SENTRY_DSN;
  },
  // Prometheus /metrics scrape token. When set, scrapers must present it as a
  // Bearer token. Unset is allowed in dev; in production /metrics without a
  // token is refused (so request volumes aren't exposed by default).
  get metricsToken(): string | undefined {
    return process.env.METRICS_TOKEN;
  },
  notifications: {
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM,
    msg91ApiKey: process.env.MSG91_API_KEY,
    smsSender: process.env.SMS_SENDER,
    whatsappToken: process.env.WHATSAPP_TOKEN,
    whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  },
  // Shared rate-limit store (production). When unset, an in-memory store is used.
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  },
  /** Provider-neutral Redis protocol URL. Preferred when both adapters exist. */
  redisUrl: process.env.REDIS_URL,
  // API keys get a separate, higher per-window allowance than interactive users.
  rateLimit: {
    user: Number(process.env.RATE_LIMIT_USER ?? 600),
    apiKey: Number(process.env.RATE_LIMIT_API_KEY ?? 6000),
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  },
  razorpay: {
    get keyId() {
      return process.env.RAZORPAY_KEY_ID;
    },
    get keySecret() {
      return process.env.RAZORPAY_KEY_SECRET;
    },
    get webhookSecret() {
      return process.env.RAZORPAY_WEBHOOK_SECRET;
    },
  },
  stripe: {
    get secretKey() {
      return process.env.STRIPE_SECRET_KEY;
    },
    get webhookSecret() {
      return process.env.STRIPE_WEBHOOK_SECRET;
    },
  },
  // Cloudflare for SaaS custom hostnames. When both are set, the /branding/
  // custom-domain endpoint provisions a CF custom hostname for the tenant.
  // Without them the endpoint accepts the hostname locally but the activation
  // status stays 'mock' (so dev work isn't blocked on CF).
  cloudflare: {
    get apiToken() {
      return process.env.CLOUDFLARE_API_TOKEN;
    },
    get zoneId() {
      return process.env.CLOUDFLARE_ZONE_ID;
    },
    get apiBase() {
      return process.env.CLOUDFLARE_API_BASE ?? 'https://api.cloudflare.com/client/v4';
    },
  },
  // New signups get a time-boxed trial of a paid plan; an expiry job reverts
  // unconverted trials to free.
  trial: {
    plan: process.env.TRIAL_PLAN ?? 'professional',
    days: Number(process.env.TRIAL_DAYS ?? 14),
  },
  // Seller details printed on GST tax invoices (operator config).
  invoice: {
    sellerName: process.env.INVOICE_SELLER_NAME ?? 'TrackFlow Technologies Pvt Ltd',
    sellerGstin: process.env.INVOICE_SELLER_GSTIN ?? '',
    sellerAddress: process.env.INVOICE_SELLER_ADDRESS ?? '',
    sellerState: process.env.INVOICE_SELLER_STATE ?? '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
    accessTtl: Number(process.env.JWT_ACCESS_TTL ?? 3600),
    refreshTtl: Number(process.env.JWT_REFRESH_TTL ?? 2_592_000),
  } satisfies JwtConfig,
  /** True under NODE_ENV=production; gates dev-only endpoints like /billing/confirm. */
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
};
