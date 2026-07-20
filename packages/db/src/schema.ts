import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  bigserial,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export type DeviceAttributes = Record<string, number | boolean | string>;
export interface GeofencePoint {
  lat: number;
  lng: number;
}
export interface GeofenceRecipients {
  emails?: string[];
  phones?: string[];
  webhookUrl?: string;
}
export interface AlertDelivery {
  channel: string;
  recipient: string;
  status: string;
  error?: string;
  sentAt: number;
}

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  subscriptionStatus: text('subscription_status').notNull().default('none'),
  billingCycle: text('billing_cycle'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  // Pins the tenant to the exact plan version it subscribed on (grandfathering);
  // null falls back to the plan key's current active version.
  planVersionId: uuid('plan_version_id').references(() => planVersions.id),
  // Preferred locale for notifications and the dashboard. Default 'en'; 'hi' is supported.
  locale: text('locale').notNull().default('en'),
  // When true, members without MFA enrolled are prompted to set it up at login.
  requireMfa: boolean('require_mfa').notNull().default(false),
  // White-label branding
  brandName: text('brand_name'),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color'),
  customDomain: text('custom_domain').unique(),
  // Cloudflare for SaaS custom-hostname tracking. Set when a tenant adds a
  // custom domain via the API; the activation status + DNS ownership
  // challenge come from CF and are refreshed by a poll endpoint.
  customDomainHostnameId: text('custom_domain_hostname_id'),
  customDomainStatus: text('custom_domain_status'),
  customDomainSslStatus: text('custom_domain_ssl_status'),
  customDomainVerification: jsonb('custom_domain_verification').$type<{
    name?: string;
    value?: string;
    type?: string;
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Plan catalog (the product line). Prices + limits live on plan_versions so a
 *  price change never mutates what an existing subscriber agreed to. */
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(), // 'free' | 'starter' | 'professional' | 'enterprise' | …
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublic: boolean('is_public').notNull().default(true), // shown on the public pricing page
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface PlanVersionLimits {
  devices: number;
  users: number;
  geofences: number;
  apiCallsPerMonth: number;
  historyDays: number;
}

/** An immutable, versioned price + limit set for a plan. Editing a plan in admin
 *  archives the old version and inserts a new one; tenants pin to a version. */
export const planVersions = pgTable(
  'plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    priceInrMonthly: integer('price_inr_monthly').notNull().default(0),
    priceInrAnnual: integer('price_inr_annual').notNull().default(0),
    limits: jsonb('limits').$type<PlanVersionLimits>().notNull(),
    // Units bundled into the plan price per cycle (e.g. { sms: 100, whatsapp: 50 }),
    // used by metered overage billing.
    includedUnits: jsonb('included_units').$type<Record<string, number>>().notNull().default({}),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('plan_versions_plan_version_idx').on(t.planId, t.version)],
);

export type Plan = typeof plans.$inferSelect;
export type PlanVersion = typeof planVersions.$inferSelect;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('owner'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // TOTP MFA. A secret with a null enabledAt is a pending enrollment (setup
  // started but the first code not yet confirmed). Recovery codes are stored
  // as SHA-256 hashes and removed as they are consumed.
  mfaSecret: text('mfa_secret'),
  mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
  mfaRecoveryCodes: jsonb('mfa_recovery_codes').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    registration: text('registration'),
    make: text('make'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('vehicles_tenant_idx').on(t.tenantId)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    imei: text('imei').notNull().unique(),
    type: text('type').notNull().default('vehicle'),
    protocol: text('protocol').notNull().default('gt06'),
    registrationNumber: text('registration_number'),
    // Admin/provisioning state (active|inactive|maintenance). Connectivity
    // (online/offline) is derived separately from lastSeen freshness.
    status: text('status').notNull().default('active'),
    // Denormalized last position for instant map loads (updated on each ingest).
    lastLat: doublePrecision('last_lat'),
    lastLon: doublePrecision('last_lon'),
    lastSpeed: doublePrecision('last_speed'),
    lastCourse: doublePrecision('last_course'),
    lastFixTime: timestamp('last_fix_time', { withTimezone: true }),
    lastSeen: timestamp('last_seen', { withTimezone: true }),
    // Persisted connectivity (flips via the offline sweep / on data) to detect transitions.
    online: boolean('online').notNull().default(false),
    // Latest telemetry snapshot (ignition, voltages, temperature, …).
    lastAttributes: jsonb('last_attributes').$type<DeviceAttributes>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('devices_tenant_idx').on(t.tenantId)],
);

/**
 * Time-series hot path. Monthly RANGE-partitioned by fix_time (migration 0006);
 * the retention job (apps/jobs/src/retention.ts) provisions upcoming partitions,
 * drops fully-expired ones, and trims rows past each tenant's plan history window
 * (plans.historyDays: 7/90/365/∞). The (device_id, fix_time) index drives both
 * "latest position" and "history in range" queries. The PK is (id, fix_time)
 * because Postgres requires the partition key in every unique constraint; id
 * stays globally unique via its sequence.
 */
export const positions = pgTable(
  'positions',
  {
    id: bigserial('id', { mode: 'number' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    speedKph: doublePrecision('speed_kph').notNull().default(0),
    course: doublePrecision('course').notNull().default(0),
    gpsValid: boolean('gps_valid').notNull().default(true),
    satellites: integer('satellites'),
    attributes: jsonb('attributes').$type<DeviceAttributes>(),
    fixTime: timestamp('fix_time', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('positions_device_time_idx').on(t.deviceId, sql`${t.fixTime} DESC`),
    // Idempotency: a device can have only one fix per timestamp, so retransmits
    // (common on GT06/H02) collide here and are dropped on insert.
    uniqueIndex('positions_device_fixtime_uq').on(t.deviceId, t.fixTime),
    primaryKey({ columns: [t.id, t.fixTime] }),
  ],
);

/**
 * Programmatic access keys. RLS-protected like other tenant data; the secret is
 * stored only as a SHA-256 hash, with a short non-secret prefix kept for display
 * and fast lookup.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull().unique(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_keys_tenant_idx').on(t.tenantId)],
);

export const geofences = pgTable(
  'geofences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(), // 'circle' | 'polygon'
    centerLat: doublePrecision('center_lat'),
    centerLon: doublePrecision('center_lon'),
    radiusM: doublePrecision('radius_m'),
    points: jsonb('points').$type<GeofencePoint[]>(),
    color: text('color').notNull().default('#6366f1'),
    onEntry: boolean('on_entry').notNull().default(true),
    onExit: boolean('on_exit').notNull().default(true),
    onDwell: boolean('on_dwell').notNull().default(false),
    dwellSeconds: integer('dwell_seconds').notNull().default(300),
    throttleSeconds: integer('throttle_seconds').notNull().default(0),
    channels: jsonb('channels').$type<string[]>().notNull().default(['console']),
    recipients: jsonb('recipients').$type<GeofenceRecipients>().notNull().default({}),
    allDevices: boolean('all_devices').notNull().default(true),
    deviceIds: jsonb('device_ids').$type<string[]>().notNull().default([]),
    // Group-level targeting: a geofence applies to any device in any of these
    // groups (in addition to deviceIds + allDevices).
    groupIds: jsonb('group_ids').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('geofences_tenant_idx').on(t.tenantId)],
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    geofenceId: uuid('geofence_id'),
    type: text('type').notNull(),
    severity: text('severity').notNull().default('medium'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    acknowledged: boolean('acknowledged').notNull().default(false),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    notifications: jsonb('notifications').$type<AlertDelivery[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('alerts_tenant_time_idx').on(t.tenantId, sql`${t.createdAt} DESC`)],
);

/** Per-(device, geofence) transition state for the engine. Times are epoch ms. */
export const geofenceStates = pgTable(
  'geofence_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    geofenceId: uuid('geofence_id')
      .notNull()
      .references(() => geofences.id, { onDelete: 'cascade' }),
    inside: boolean('inside').notNull().default(false),
    enteredAt: bigint('entered_at', { mode: 'number' }),
    dwelled: boolean('dwelled').notNull().default(false),
    lastEventAt: bigint('last_event_at', { mode: 'number' }),
  },
  (t) => [uniqueIndex('geofence_states_device_geofence_idx').on(t.deviceId, t.geofenceId)],
);

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    durationS: integer('duration_s').notNull(),
    distanceKm: doublePrecision('distance_km').notNull(),
    avgSpeedKph: doublePrecision('avg_speed_kph').notNull(),
    maxSpeedKph: doublePrecision('max_speed_kph').notNull(),
    startLat: doublePrecision('start_lat'),
    startLon: doublePrecision('start_lon'),
    endLat: doublePrecision('end_lat'),
    endLon: doublePrecision('end_lon'),
    pointCount: integer('point_count').notNull().default(0),
    speedingSamples: integer('speeding_samples').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trips_device_start_idx').on(t.deviceId, t.startedAt),
    index('trips_tenant_time_idx').on(t.tenantId, sql`${t.startedAt} DESC`),
  ],
);

/** Per-device, per-day aggregates derived from `trips` so analytics over a date
 *  range reads one row per device-day instead of scanning every trip. Rebuilt
 *  idempotently by the rollup job (upsert on device_id + day). */
export const dailyRollups = pgTable(
  'daily_rollups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    trips: integer('trips').notNull().default(0),
    distanceKm: doublePrecision('distance_km').notNull().default(0),
    durationS: integer('duration_s').notNull().default(0),
    maxSpeedKph: doublePrecision('max_speed_kph').notNull().default(0),
    speedingSamples: integer('speeding_samples').notNull().default(0),
    pointCount: integer('point_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('daily_rollups_device_day_idx').on(t.deviceId, t.day),
    index('daily_rollups_tenant_day_idx').on(t.tenantId, t.day),
  ],
);

export type DailyRollup = typeof dailyRollups.$inferSelect;

export interface InvoiceLineItem {
  description: string;
  amountInr: number;
}

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    plan: text('plan').notNull(),
    billingCycle: text('billing_cycle').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    subtotalInr: integer('subtotal_inr').notNull(),
    taxInr: integer('tax_inr').notNull(),
    totalInr: integer('total_inr').notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('paid'),
    provider: text('provider'),
    providerRef: text('provider_ref'),
    lineItems: jsonb('line_items').$type<InvoiceLineItem[]>().notNull().default([]),
    // URL to the archived PDF on object storage (R2/S3); null when storage isn't
    // configured — the PDF endpoint renders on demand in that case.
    pdfUrl: text('pdf_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invoices_tenant_time_idx').on(t.tenantId, sql`${t.createdAt} DESC`)],
);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Geofence = typeof geofences.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type GeofenceStateRow = typeof geofenceStates.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    // Optional per-device filter: empty = all devices (no filter). Events whose
    // payload carries a deviceId outside this list don't fire this webhook.
    deviceIds: jsonb('device_ids').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhooks_tenant_idx').on(t.tenantId)],
);

export type Webhook = typeof webhooks.$inferSelect;

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    platform: text('platform'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_tokens_tenant_idx').on(t.tenantId)],
);

export type PushToken = typeof pushTokens.$inferSelect;

/** Per-tenant, per-month usage meters (API calls, SMS). Drives quota enforcement
 *  and overage reporting; one row per tenant per 'YYYY-MM' period. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    period: text('period').notNull(), // 'YYYY-MM' (UTC)
    apiCalls: integer('api_calls').notNull().default(0),
    smsSent: integer('sms_sent').notNull().default(0),
    whatsappSent: integer('whatsapp_sent').notNull().default(0),
    emailSent: integer('email_sent').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.period] })],
);

/** Operator cost + markup per metered resource; billed rate = unitCostInr × markup.
 *  When a provider's price changes, edit the unit cost here and every client's
 *  overage price recomputes from one place. */
export const billingRates = pgTable('billing_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  resource: text('resource').notNull().unique(), // 'sms' | 'whatsapp' | 'email'
  unitCostInr: doublePrecision('unit_cost_inr').notNull().default(0),
  markup: doublePrecision('markup').notNull().default(2.5),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BillingRate = typeof billingRates.$inferSelect;

/** Per-tenant notification templates by event type + locale; substitution uses
 *  `{{var}}` placeholders. When no row exists, a built-in default is used. */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // 'geofence.enter' | 'device.offline' | …
    locale: text('locale').notNull().default('en'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notification_templates_tenant_event_locale_idx').on(t.tenantId, t.eventType, t.locale)],
);

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;

/** Per-tenant dispatch rules: quiet-hour window (in `timezone`), per-event
 *  throttle, and whether `critical`-severity alerts bypass quiet hours. One
 *  row per tenant (PK = tenant_id); the service falls back to sensible
 *  defaults when no row exists. */
export const tenantNotificationSettings = pgTable('tenant_notification_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  quietStart: text('quiet_start'), // 'HH:MM' or null = no quiet hours
  quietEnd: text('quiet_end'),
  timezone: text('timezone').notNull().default('UTC'),
  throttlePerHour: integer('throttle_per_hour').notNull().default(10),
  criticalBypass: boolean('critical_bypass').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantNotificationSettings = typeof tenantNotificationSettings.$inferSelect;

/** Per-event channel routing: when a row exists for an event type, alerts of
 *  that type fan out to the row's channels regardless of what the alert was
 *  authored with. Lets a tenant say "send geofence enters over whatsapp + email
 *  only, even though the alert is configured with push too". */
export const notificationRoutes = pgTable(
  'notification_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    eventType: text('event_type').notNull(),
    channels: jsonb('channels').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notification_routes_tenant_event_idx').on(t.tenantId, t.eventType)],
);

export type NotificationRoute = typeof notificationRoutes.$inferSelect;

/** One row per dispatch attempt per channel/recipient. Powers the delivery log
 *  in the UI and the retry job (`status='failed'` with `nextRetryAt` due). */
export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(), // 'email' | 'sms' | 'whatsapp' | 'webhook' | 'push' | 'console'
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(), // 'pending' | 'sent' | 'failed' | 'skipped' | 'abandoned'
    attempt: integer('attempt').notNull().default(1),
    error: text('error'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('alert_deliveries_alert_idx').on(t.alertId),
    index('alert_deliveries_retry_idx').on(t.status, t.nextRetryAt),
  ],
);

export type AlertDeliveryRow = typeof alertDeliveries.$inferSelect;

/** Per-attempt log of webhook deliveries (one row per HTTP attempt within a
 *  retry loop). Powers the per-webhook delivery view and audits. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    attempt: integer('attempt').notNull(),
    status: text('status').notNull(), // 'sent' | 'failed'
    httpStatus: integer('http_status'),
    error: text('error'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_deliveries_webhook_time_idx').on(t.webhookId, sql`${t.createdAt} DESC`)],
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

/** Tenant-scoped device groups. A geofence can target any subset of groups in
 *  addition to (or instead of) individual devices. */
export const deviceGroups = pgTable(
  'device_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#6366f1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_groups_tenant_idx').on(t.tenantId)],
);

export const deviceGroupMembers = pgTable(
  'device_group_members',
  {
    // Denormalized tenant_id so the standard RLS template applies (every
    // child table in this schema carries its tenant for that reason).
    tenantId: uuid('tenant_id').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => deviceGroups.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.deviceId] }), index('device_group_members_device_idx').on(t.deviceId)],
);

export type DeviceGroup = typeof deviceGroups.$inferSelect;
export type DeviceGroupMember = typeof deviceGroupMembers.$inferSelect;

/** Append-only audit trail of admin/tenant actions (who did what, when, to
 *  which resource). Tenant-scoped via RLS. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id'), // null for system / unauthenticated paths
    actorIp: text('actor_ip'),
    action: text('action').notNull(), // e.g. 'user.invited', 'webhook.deleted'
    target: text('target'), // resource kind (e.g. 'user', 'webhook')
    targetId: text('target_id'), // resource id (text — sometimes non-uuid)
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_tenant_time_idx').on(t.tenantId, sql`${t.createdAt} DESC`)],
);

export type AuditLog = typeof auditLogs.$inferSelect;

/** Two-way device commands: the API queues a command, the device (via the
 *  ingest TCP session for raw protocols, or a polling endpoint for HTTP
 *  devices) picks it up and acks. */
export const deviceCommands = pgTable(
  'device_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    command: text('command').notNull(), // 'immobilize' | 'mobilize' | 'request_location' | 'set_interval' | …
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('queued'), // queued | sent | acked | failed | expired | canceled
    response: text('response'),
    requestedBy: uuid('requested_by'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_commands_device_status_idx').on(t.deviceId, t.status)],
);

export type DeviceCommand = typeof deviceCommands.$inferSelect;

/** Many-to-many membership: a user can belong to multiple tenants. The
 *  existing users.tenantId still carries the "primary" / default org, so
 *  legacy single-tenant paths keep working unchanged. Org switching mints a
 *  fresh JWT with the chosen tenant + the role from the matching row. */
export const orgMemberships = pgTable(
  'org_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('org_memberships_user_tenant_idx').on(t.userId, t.tenantId),
    index('org_memberships_user_idx').on(t.userId),
  ],
);

export type OrgMembership = typeof orgMemberships.$inferSelect;

/** Per-tenant SAML 2.0 SSO config. One row per tenant (uniqueness enforced on
 *  `tenant_id`). The runtime resolves the tenant from the URL slug; the IdP's
 *  signing cert is held here so we can verify SAMLResponses without per-request
 *  metadata fetches. The `default_role` is what we assign to a brand-new
 *  just-in-time-provisioned user when an unknown email signs in via the IdP. */
export const samlConfigs = pgTable(
  'saml_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    // IdP-side
    entityId: text('entity_id').notNull(),
    ssoUrl: text('sso_url').notNull(),
    certificate: text('certificate').notNull(),
    // SP-side identifiers (derived from `${webOrigin}/auth/saml/${slug}/…`)
    audience: text('audience').notNull(),
    acsUrl: text('acs_url').notNull(),
    // Attribute names in the SAML assertion that carry the email + display name.
    attributeEmail: text('attribute_email').notNull().default('email'),
    attributeName: text('attribute_name').notNull().default('displayName'),
    // Role assigned to new just-in-time users.
    defaultRole: text('default_role').notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saml_configs_tenant_idx').on(t.tenantId)],
);

export type SamlConfig = typeof samlConfigs.$inferSelect;

export type UsageCounter = typeof usageCounters.$inferSelect;

/** Refresh-token sessions for rotation + revocation. The row id is the refresh
 *  token's jti; rotating a token revokes its row and inserts a fresh one, so a
 *  replayed (already-rotated) token is detected and the chain can be killed. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export type Session = typeof sessions.$inferSelect;

/** Single-use, hashed tokens for password reset + email verification. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'password_reset' | 'email_verify'
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_tokens_hash_idx').on(t.tokenHash)],
);

export type AuthToken = typeof authTokens.$inferSelect;
