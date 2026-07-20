import { AppError } from '@trackflow/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { env } from './env.js';
import { type AppEnv, authenticate } from './middleware/auth.js';
import { requestLogger } from './middleware/logger.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { renderMetrics } from './metrics.js';
import { reportError } from './observability.js';
import { ipRateLimit, rateLimit } from './middleware/rate-limit.js';
import { adminRoutes } from './routes/admin.js';
import { alertRoutes } from './routes/alerts.js';
import { analyticsRoutes } from './routes/analytics.js';
import { auditLogRoutes } from './routes/audit-logs.js';
import { deviceGroupRoutes } from './routes/device-groups.js';
import { meRoutes } from './routes/me.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes, billingWebhookRoutes, stripeWebhookRoutes } from './routes/billing.js';
import { brandingRoutes, publicRoutes } from './routes/branding.js';
import { deviceRoutes } from './routes/devices.js';
import { docsRoutes } from './routes/docs.js';
import { geofenceRoutes } from './routes/geofences.js';
import { createGraphqlHandler } from './graphql.js';
import { internalRoutes, realtimeRoutes } from './routes/positions.js';
import { privacyRoutes } from './routes/privacy.js';
import { pushRoutes } from './routes/push.js';
import { samlConfigRoutes, samlPublicRoutes } from './routes/saml.js';
import { scimRoutes } from './routes/scim.js';
import { userRoutes } from './routes/users.js';
import { vehicleRoutes } from './routes/vehicles.js';
import { webhookRoutes } from './routes/webhooks.js';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', requestLogger);
  app.use('*', metricsMiddleware);
  // Baseline security headers (nosniff, frame, COOP, …). HSTS only in
  // production — preloading it on localhost would poison local HTTP dev.
  // CORP is relaxed because the dashboard consumes this API cross-origin.
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: env.isProduction ? 'max-age=31536000; includeSubDomains' : false,
      crossOriginResourcePolicy: 'cross-origin',
    }),
  );
  // Only the configured dashboard origin is allowed in production; localhost is
  // permitted in dev/test for local work.
  const allowedOrigins = env.isProduction
    ? [env.webOrigin]
    : [env.webOrigin, 'http://localhost:3000', 'http://127.0.0.1:3000'];
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowHeaders: ['Authorization', 'Content-Type', 'x-ingest-token', 'x-api-key'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok', service: 'trackflow-api' }));

  // Prometheus scrape endpoint. Token-gated when METRICS_TOKEN is set; in
  // production an unset token refuses the scrape so request volumes aren't
  // exposed by default (dev without a token is allowed).
  app.get('/metrics', (c) => {
    const token = env.metricsToken;
    if (token) {
      if (c.req.header('authorization') !== `Bearer ${token}`) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid metrics token' } }, 401);
      }
    } else if (env.isProduction) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'METRICS_TOKEN must be set in production' } }, 403);
    }
    return c.text(renderMetrics(), 200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
  });

  // Public: API docs + branding resolution (unauthenticated).
  app.route('/', docsRoutes);
  app.route('/public', publicRoutes);

  // Throttle unauthenticated auth + operator endpoints per IP in production
  // (login/reset/register abuse, admin-token guessing).
  if (env.isProduction) app.use('/auth/*', ipRateLimit({ limit: 20, windowMs: 60_000 }));
  app.route('/auth', authRoutes);

  // Authenticated + rate-limited groups (JWT or API key).
  const limiter = rateLimit({
    user: env.rateLimit.user,
    apiKey: env.rateLimit.apiKey,
    windowMs: env.rateLimit.windowMs,
  });
  app.use('/devices/*', authenticate, limiter);
  app.use('/vehicles/*', authenticate, limiter);
  app.use('/geofences/*', authenticate, limiter);
  app.use('/alerts/*', authenticate, limiter);
  app.use('/analytics/*', authenticate, limiter);
  app.use('/billing/*', authenticate, limiter);
  app.use('/webhooks/*', authenticate, limiter);
  app.use('/branding', authenticate, limiter);
  app.use('/branding/*', authenticate, limiter);
  app.use('/api-keys/*', authenticate, limiter);
  app.use('/users/*', authenticate, limiter);
  app.use('/push/*', authenticate, limiter);
  app.use('/audit-logs', authenticate, limiter);
  app.use('/audit-logs/*', authenticate, limiter);
  app.use('/device-groups', authenticate, limiter);
  app.use('/device-groups/*', authenticate, limiter);
  app.use('/me/*', authenticate, limiter);
  app.use('/saml-config', authenticate, limiter);
  app.use('/saml-config/*', authenticate, limiter);
  app.use('/graphql', authenticate, limiter);
  // GraphQL (read-only). yoga returns a fetch-style handler; we pass the
  // resolved principal through context so resolvers can RLS-scope queries.
  const yoga = createGraphqlHandler();
  app.all('/graphql', async (c) => yoga.fetch(c.req.raw, { principal: c.get('principal') }));
  app.route('/devices', deviceRoutes);
  app.route('/saml-config', samlConfigRoutes);
  // Public SAML SSO flow (metadata/login/ACS). Tenant resolved from the URL slug.
  app.route('/auth/saml', samlPublicRoutes);
  app.route('/device-groups', deviceGroupRoutes);
  app.route('/audit-logs', auditLogRoutes);
  app.route('/me', meRoutes);
  // Data-subject rights (export + workspace hard-delete) — same /me surface.
  app.route('/me', privacyRoutes);
  app.route('/vehicles', vehicleRoutes);
  app.route('/geofences', geofenceRoutes);
  app.route('/alerts', alertRoutes);
  app.route('/analytics', analyticsRoutes);
  app.route('/billing', billingRoutes);
  app.route('/webhooks', webhookRoutes);
  app.route('/branding', brandingRoutes);
  app.route('/api-keys', apiKeyRoutes);
  app.route('/users', userRoutes);
  app.route('/push', pushRoutes);

  // Trusted / self-authenticating endpoints.
  app.route('/internal', internalRoutes);
  app.route('/internal/billing', billingWebhookRoutes);
  app.route('/internal/billing/stripe', stripeWebhookRoutes);
  // SCIM 2.0 — authenticated via its own bearer-token middleware (scoped API
  // key), so it is mounted outside the JWT/x-api-key authenticate chain.
  app.route('/scim/v2', scimRoutes);
  app.route('/realtime', realtimeRoutes);
  if (env.isProduction) app.use('/admin/*', ipRateLimit({ limit: 30, windowMs: 60_000 }));
  app.route('/admin', adminRoutes);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as never);
    }
    if (err instanceof ZodError) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: err.issues } }, 400);
    }
    const requestId = c.get('requestId');
    reportError(err, {
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      tenantId: c.get('principal')?.tenantId,
    });
    return c.json({ error: { code: 'INTERNAL', message: 'Internal server error', requestId } }, 500);
  });

  return app;
}
