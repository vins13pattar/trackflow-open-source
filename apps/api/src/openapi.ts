/**
 * OpenAPI 3.1 spec for the TrackFlow public API. Kept hand-written (one
 * source of truth, no decorator magic) so the routes and the spec evolve
 * together. Validated by `openapi.test.ts`.
 *
 * Conventions:
 *  - Auth: every tenant endpoint requires a Bearer JWT *or* `x-api-key`.
 *  - The error envelope is `{ error: { code, message, details? } }`.
 *  - 401/403/404/422/429/402 use shared response components.
 */

const ref = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });
const respRef = (name: string): { $ref: string } => ({ $ref: `#/components/responses/${name}` });
const json = (schema: unknown) => ({ 'application/json': { schema } });
const body = (schema: unknown, required = true) => ({ required, content: json(schema) });
const ok = (description: string, schema?: unknown) => ({ description, ...(schema ? { content: json(schema) } : {}) });

const auth = [{ bearerAuth: [] }, { apiKeyAuth: [] }];
const adminAuth = [{ adminAuth: [] }];
const ingestAuth = [{ ingestAuth: [] }];

const errorResponses = {
  BadRequest: { description: 'Validation error', content: json(ref('Error')) },
  Unauthorized: { description: 'Missing or invalid credentials', content: json(ref('Error')) },
  Forbidden: { description: 'Insufficient permissions', content: json(ref('Error')) },
  NotFound: { description: 'Resource not found', content: json(ref('Error')) },
  Conflict: { description: 'Conflict (e.g. duplicate)', content: json(ref('Error')) },
  Quota: { description: 'Plan quota exceeded', content: json(ref('Error')) },
  RateLimited: { description: 'Rate limit exceeded', content: json(ref('Error')) },
};

const commonErrors = {
  '400': respRef('BadRequest'),
  '401': respRef('Unauthorized'),
  '403': respRef('Forbidden'),
  '404': respRef('NotFound'),
  '429': respRef('RateLimited'),
};

// ---------- schemas ----------

const schemas = {
  Error: {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'NOT_FOUND' },
          message: { type: 'string' },
          details: {},
        },
        required: ['code', 'message'],
      },
    },
    required: ['error'],
  },
  AuthTokens: {
    type: 'object',
    properties: {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      expiresIn: { type: 'integer' },
    },
    required: ['accessToken', 'refreshToken', 'expiresIn'],
  },
  PublicUser: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      role: { type: 'string', enum: ['owner', 'admin', 'manager', 'user', 'viewer'] },
      tenantId: { type: 'string', format: 'uuid' },
    },
    required: ['id', 'email', 'name', 'role', 'tenantId'],
  },
  PlanLimits: {
    type: 'object',
    properties: {
      devices: { type: 'integer', description: '-1 = unlimited' },
      users: { type: 'integer' },
      geofences: { type: 'integer' },
      apiCallsPerMonth: { type: 'integer' },
      historyDays: { type: 'integer' },
    },
  },
  Plan: {
    type: 'object',
    properties: {
      key: { type: 'string', example: 'starter' },
      name: { type: 'string', example: 'Starter' },
      priceInr: { type: 'integer', example: 299 },
      annualInr: { type: 'integer', example: 2999 },
      limits: ref('PlanLimits'),
      includedUnits: { type: 'object', additionalProperties: { type: 'number' } },
      versionId: { type: 'string', format: 'uuid', nullable: true },
      isPublic: { type: 'boolean' },
    },
  },
  Subscription: {
    type: 'object',
    properties: {
      plan: { type: 'string' },
      planName: { type: 'string' },
      status: { type: 'string', enum: ['none', 'trialing', 'active', 'canceled'] },
      billingCycle: { type: 'string', nullable: true, enum: ['monthly', 'annual', null] },
      trialEndsAt: { type: 'string', format: 'date-time', nullable: true },
      trialDaysLeft: { type: 'integer', nullable: true },
      currentPeriodEnd: { type: 'string', format: 'date-time', nullable: true },
      limits: ref('PlanLimits'),
      usage: {
        type: 'object',
        properties: {
          devices: { type: 'integer' },
          users: { type: 'integer' },
          apiCalls: { type: 'integer' },
          smsSent: { type: 'integer' },
          whatsappSent: { type: 'integer' },
          emailSent: { type: 'integer' },
        },
      },
      overages: {
        type: 'object',
        properties: {
          totalInr: { type: 'number' },
          items: { type: 'array', items: ref('OverageItem') },
        },
      },
    },
  },
  OverageItem: {
    type: 'object',
    properties: {
      resource: { type: 'string', example: 'sms' },
      included: { type: 'integer' },
      used: { type: 'integer' },
      overage: { type: 'integer' },
      ratePerUnitInr: { type: 'number' },
      amountInr: { type: 'number' },
    },
  },
  Invoice: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      number: { type: 'string' },
      plan: { type: 'string' },
      billingCycle: { type: 'string' },
      subtotalInr: { type: 'integer' },
      taxInr: { type: 'integer' },
      totalInr: { type: 'integer' },
      currency: { type: 'string', example: 'INR' },
      status: { type: 'string', enum: ['paid', 'due', 'void'] },
      lineItems: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, amountInr: { type: 'integer' } } } },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Device: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      imei: { type: 'string', pattern: '^\\d{15}$' },
      type: { type: 'string', enum: ['vehicle', 'phone', 'asset', 'pet', 'person'] },
      protocol: { type: 'string', enum: ['gt06', 'h02', 'teltonika', 'nmea', 'queclink', 'meitrack'] },
      status: { type: 'string', enum: ['active', 'inactive', 'maintenance'] },
      online: { type: 'boolean' },
      lastLat: { type: 'number', nullable: true },
      lastLon: { type: 'number', nullable: true },
      lastSpeed: { type: 'number', nullable: true },
      lastSeen: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PositionPoint: {
    type: 'object',
    properties: {
      lat: { type: 'number' },
      lon: { type: 'number' },
      speedKph: { type: 'number' },
      course: { type: 'number' },
      fixTime: { type: 'string', format: 'date-time' },
    },
  },
  Vehicle: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      registration: { type: 'string', nullable: true },
      make: { type: 'string', nullable: true },
      model: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Geofence: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      kind: { type: 'string', enum: ['circle', 'polygon'] },
      // `circle` carries center + radiusMeters; `polygon` carries points[].
      center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
      radiusMeters: { type: 'number' },
      points: { type: 'array', items: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
      deviceIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      onEnter: { type: 'boolean' },
      onExit: { type: 'boolean' },
      severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
      channels: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Alert: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      deviceId: { type: 'string', format: 'uuid' },
      geofenceId: { type: 'string', format: 'uuid', nullable: true },
      type: { type: 'string' },
      severity: { type: 'string' },
      title: { type: 'string' },
      message: { type: 'string' },
      lat: { type: 'number', nullable: true },
      lon: { type: 'number', nullable: true },
      acknowledged: { type: 'boolean' },
      acknowledgedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  AlertDeliveryLog: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      alertId: { type: 'string', format: 'uuid' },
      channel: { type: 'string', enum: ['email', 'sms', 'whatsapp', 'webhook', 'push', 'console'] },
      recipient: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'sent', 'failed', 'skipped', 'abandoned'] },
      attempt: { type: 'integer' },
      error: { type: 'string', nullable: true },
      nextRetryAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  Webhook: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      url: { type: 'string', format: 'uri' },
      events: { type: 'array', items: { type: 'string' } },
      deviceIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      secret: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused'] },
      successCount: { type: 'integer' },
      failureCount: { type: 'integer' },
      lastSuccessAt: { type: 'string', format: 'date-time', nullable: true },
      lastFailureAt: { type: 'string', format: 'date-time', nullable: true },
      lastError: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  WebhookDeliveryEntry: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      webhookId: { type: 'string', format: 'uuid' },
      event: { type: 'string' },
      attempt: { type: 'integer' },
      status: { type: 'string', enum: ['sent', 'failed'] },
      httpStatus: { type: 'integer', nullable: true },
      error: { type: 'string', nullable: true },
      durationMs: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  ApiKey: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      prefix: { type: 'string' },
      scopes: { type: 'array', items: { type: 'string' } },
      lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
      revokedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Branding: {
    type: 'object',
    properties: {
      brandName: { type: 'string', nullable: true },
      logoUrl: { type: 'string', format: 'uri', nullable: true },
      primaryColor: { type: 'string', nullable: true },
      customDomain: { type: 'string', nullable: true },
    },
  },
};

// ---------- paths ----------
// Each operation: tags + summary + requestBody (if any) + responses + security.

const paths: Record<string, Record<string, unknown>> = {
  // ===== Auth =====
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a tenant + owner',
      security: [],
      requestBody: body({
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8, maxLength: 128, description: 'Must contain letters and numbers' },
          name: { type: 'string' },
          tenantName: { type: 'string' },
        },
        required: ['email', 'password', 'name', 'tenantName'],
      }),
      responses: {
        '201': ok('Registered', { type: 'object', properties: { user: ref('PublicUser'), tokens: ref('AuthTokens') } }),
        '400': respRef('BadRequest'),
        '409': respRef('Conflict'),
        '429': respRef('RateLimited'),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Log in',
      security: [],
      requestBody: body({
        type: 'object',
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
        required: ['email', 'password'],
        example: { email: 'owner@acme.in', password: 'password123' },
      }),
      responses: {
        '200': ok('Logged in', { type: 'object', properties: { user: ref('PublicUser'), tokens: ref('AuthTokens') } }),
        '401': respRef('Unauthorized'),
        '429': respRef('RateLimited'),
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Rotate the refresh token',
      security: [],
      requestBody: body({ type: 'object', properties: { refreshToken: { type: 'string' } }, required: ['refreshToken'] }),
      responses: { '200': ok('Rotated', { type: 'object', properties: { tokens: ref('AuthTokens') } }), '401': respRef('Unauthorized') },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Revoke the refresh-token session (idempotent)',
      security: [],
      requestBody: body({ type: 'object', properties: { refreshToken: { type: 'string' } }, required: ['refreshToken'] }),
      responses: { '200': ok('Revoked') },
    },
  },
  '/auth/password/forgot': {
    post: {
      tags: ['Auth'],
      summary: 'Request a password-reset email (always 200; no account enumeration)',
      security: [],
      requestBody: body({ type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] }),
      responses: { '200': ok('Accepted') },
    },
  },
  '/auth/password/reset': {
    post: {
      tags: ['Auth'],
      summary: 'Reset the password using the emailed token (revokes all sessions)',
      security: [],
      requestBody: body({
        type: 'object',
        properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } },
        required: ['token', 'password'],
      }),
      responses: { '200': ok('Password reset'), '401': respRef('Unauthorized') },
    },
  },
  '/auth/verify-email': {
    post: {
      tags: ['Auth'],
      summary: 'Verify the email address using the emailed token',
      security: [],
      requestBody: body({ type: 'object', properties: { token: { type: 'string' } }, required: ['token'] }),
      responses: { '200': ok('Verified'), '401': respRef('Unauthorized') },
    },
  },
  '/auth/mfa/verify': {
    post: {
      tags: ['Auth'],
      summary: 'Complete an MFA login: exchange the challenge + TOTP/recovery code for tokens',
      description:
        'When a user with MFA enabled logs in, /auth/login returns `{ mfaRequired: true, mfaToken }` instead of tokens. A wrong code does not consume the challenge (valid 5 minutes); a recovery code is consumed on use.',
      security: [],
      requestBody: body({
        type: 'object',
        properties: { mfaToken: { type: 'string' }, code: { type: 'string', description: '6-digit TOTP or XXXXX-XXXXX recovery code' } },
        required: ['mfaToken', 'code'],
      }),
      responses: {
        '200': ok('Verified', { type: 'object', properties: { user: ref('PublicUser'), tokens: ref('AuthTokens') } }),
        '401': respRef('Unauthorized'),
        '429': respRef('RateLimited'),
      },
    },
  },

  // ===== Devices =====
  '/devices': {
    get: { tags: ['Devices'], summary: 'List devices', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { devices: { type: 'array', items: ref('Device') }, total: { type: 'integer' } } }), ...commonErrors } },
    post: {
      tags: ['Devices'],
      summary: 'Create a device',
      security: auth,
      requestBody: body({
        type: 'object',
        properties: {
          name: { type: 'string' },
          imei: { type: 'string', pattern: '^\\d{15}$' },
          type: { type: 'string', enum: ['vehicle', 'phone', 'asset', 'pet', 'person'] },
          protocol: { type: 'string', enum: ['gt06', 'h02', 'teltonika', 'nmea', 'queclink', 'meitrack'] },
          vehicleId: { type: 'string', format: 'uuid', nullable: true },
        },
        required: ['name', 'imei'],
        example: { name: 'Bus-42', imei: '865432019876543', protocol: 'gt06' },
      }),
      responses: { '201': ok('Created', ref('Device')), '402': respRef('Quota'), '409': respRef('Conflict'), ...commonErrors },
    },
  },
  '/devices/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    get: { tags: ['Devices'], summary: 'Get a device', security: auth, responses: { '200': ok('OK', ref('Device')), ...commonErrors } },
    put: { tags: ['Devices'], summary: 'Update a device', security: auth, requestBody: body({ type: 'object' }), responses: { '200': ok('OK', ref('Device')), ...commonErrors } },
    delete: { tags: ['Devices'], summary: 'Delete a device', security: auth, responses: { '204': { description: 'Deleted' }, ...commonErrors } },
  },
  '/devices/{id}/report': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    post: {
      tags: ['Devices'],
      summary: 'Report a position (HTTP-only / mobile devices)',
      security: auth,
      requestBody: body({
        type: 'object',
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          speedKph: { type: 'number' },
          course: { type: 'number' },
          fixTime: { type: 'integer', description: 'Epoch millis' },
        },
        required: ['latitude', 'longitude'],
      }),
      responses: { '201': ok('Recorded'), ...commonErrors },
    },
  },
  '/devices/{id}/history': {
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'from', in: 'query', schema: { type: 'integer', description: 'Epoch millis' } },
      { name: 'to', in: 'query', schema: { type: 'integer' } },
    ],
    get: { tags: ['Devices'], summary: 'Position history', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { points: { type: 'array', items: ref('PositionPoint') } } }), ...commonErrors } },
  },
  '/devices/{id}/trips': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    get: { tags: ['Devices'], summary: 'Device trips', security: auth, responses: { '200': ok('OK'), ...commonErrors } },
  },

  // ===== Vehicles =====
  '/vehicles': {
    get: { tags: ['Vehicles'], summary: 'List vehicles', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { vehicles: { type: 'array', items: ref('Vehicle') } } }), ...commonErrors } },
    post: { tags: ['Vehicles'], summary: 'Create a vehicle', security: auth, requestBody: body({ type: 'object', properties: { name: { type: 'string' }, registration: { type: 'string' } }, required: ['name'] }), responses: { '201': ok('Created', ref('Vehicle')), ...commonErrors } },
  },
  '/vehicles/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    get: { tags: ['Vehicles'], summary: 'Get a vehicle', security: auth, responses: { '200': ok('OK', ref('Vehicle')), ...commonErrors } },
    put: { tags: ['Vehicles'], summary: 'Update a vehicle', security: auth, requestBody: body({ type: 'object' }), responses: { '200': ok('OK', ref('Vehicle')), ...commonErrors } },
    delete: { tags: ['Vehicles'], summary: 'Delete a vehicle', security: auth, responses: { '204': { description: 'Deleted' }, ...commonErrors } },
  },

  // ===== Geofences =====
  '/geofences': {
    get: { tags: ['Geofences'], summary: 'List geofences', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { geofences: { type: 'array', items: ref('Geofence') } } }), ...commonErrors } },
    post: { tags: ['Geofences'], summary: 'Create a geofence', security: auth, requestBody: body(ref('Geofence')), responses: { '201': ok('Created', ref('Geofence')), '402': respRef('Quota'), ...commonErrors } },
  },
  '/geofences/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    get: { tags: ['Geofences'], summary: 'Get a geofence', security: auth, responses: { '200': ok('OK', ref('Geofence')), ...commonErrors } },
    patch: { tags: ['Geofences'], summary: 'Update a geofence', security: auth, requestBody: body({ type: 'object' }), responses: { '200': ok('OK', ref('Geofence')), ...commonErrors } },
    delete: { tags: ['Geofences'], summary: 'Delete a geofence', security: auth, responses: { '204': { description: 'Deleted' }, ...commonErrors } },
  },

  // ===== Alerts =====
  '/alerts': {
    get: { tags: ['Alerts'], summary: 'List alerts', security: auth, parameters: [{ name: 'acknowledged', in: 'query', schema: { type: 'boolean' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } }], responses: { '200': ok('OK', { type: 'object', properties: { alerts: { type: 'array', items: ref('Alert') }, total: { type: 'integer' } } }), ...commonErrors } },
  },
  '/alerts/deliveries': {
    get: {
      tags: ['Alerts'],
      summary: 'Per-attempt notification delivery log',
      security: auth,
      parameters: [
        { name: 'alertId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'sent', 'failed', 'skipped', 'abandoned'] } },
        { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
      ],
      responses: { '200': ok('OK', { type: 'object', properties: { deliveries: { type: 'array', items: ref('AlertDeliveryLog') }, total: { type: 'integer' } } }), ...commonErrors },
    },
  },
  '/alerts/{id}/ack': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    post: { tags: ['Alerts'], summary: 'Acknowledge an alert', security: auth, responses: { '200': ok('Acked', ref('Alert')), ...commonErrors } },
  },

  // ===== Analytics =====
  '/analytics/summary': {
    get: { tags: ['Analytics'], summary: 'Fleet summary (rollup-backed)', security: auth, parameters: [{ name: 'from', in: 'query', schema: { type: 'integer' } }, { name: 'to', in: 'query', schema: { type: 'integer' } }], responses: { '200': ok('OK'), ...commonErrors } },
  },
  '/analytics/distance-by-day': {
    get: { tags: ['Analytics'], summary: 'Daily distance + trips (rollup-backed)', security: auth, responses: { '200': ok('OK'), ...commonErrors } },
  },
  '/analytics/export': {
    get: { tags: ['Analytics'], summary: 'CSV export of trips in the range', security: auth, responses: { '200': { description: 'CSV', content: { 'text/csv': {} } }, ...commonErrors } },
  },

  // ===== API keys =====
  '/api-keys': {
    get: { tags: ['API Keys'], summary: 'List API keys (without secrets)', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { apiKeys: { type: 'array', items: ref('ApiKey') } } }), ...commonErrors } },
    post: { tags: ['API Keys'], summary: 'Create an API key (returns the raw secret once)', security: auth, requestBody: body({ type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } } }, required: ['name', 'scopes'] }), responses: { '201': ok('Created'), ...commonErrors } },
  },
  '/api-keys/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    delete: { tags: ['API Keys'], summary: 'Revoke an API key', security: auth, responses: { '204': { description: 'Revoked' }, ...commonErrors } },
  },

  // ===== Billing =====
  '/billing/plans': {
    get: { tags: ['Billing'], summary: 'List the plan catalog', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { plans: { type: 'array', items: ref('Plan') } } }), ...commonErrors } },
  },
  '/billing/subscription': {
    get: { tags: ['Billing'], summary: 'Current subscription, usage, and pending overages', security: auth, responses: { '200': ok('OK', ref('Subscription')), ...commonErrors } },
  },
  '/billing/invoices': {
    get: { tags: ['Billing'], summary: 'List invoices', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { invoices: { type: 'array', items: ref('Invoice') } } }), ...commonErrors } },
  },
  '/billing/invoices/{id}/pdf': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    get: { tags: ['Billing'], summary: 'Downloadable GST invoice PDF', security: auth, responses: { '200': { description: 'PDF', content: { 'application/pdf': {} } }, ...commonErrors } },
  },
  '/billing/checkout': {
    post: {
      tags: ['Billing'],
      summary: 'Create a Razorpay order for a plan upgrade',
      security: auth,
      requestBody: body({ type: 'object', properties: { plan: { type: 'string' }, billingCycle: { type: 'string', enum: ['monthly', 'annual'] } }, required: ['plan', 'billingCycle'] }),
      responses: { '200': ok('OK', { type: 'object', properties: { orderId: { type: 'string' }, amountInr: { type: 'integer' }, currency: { type: 'string' }, keyId: { type: 'string', nullable: true }, mock: { type: 'boolean' } } }), ...commonErrors },
    },
  },
  '/billing/confirm': {
    post: { tags: ['Billing'], summary: 'Confirm an upgrade (dev only; disabled under NODE_ENV=production)', security: auth, requestBody: body({ type: 'object', properties: { plan: { type: 'string' }, billingCycle: { type: 'string' } } }), responses: { '200': ok('Upgraded'), ...commonErrors } },
  },
  '/billing/downgrade': {
    post: { tags: ['Billing'], summary: 'Self-serve downgrade (no charge; blocks if usage would exceed the target plan)', security: auth, requestBody: body({ type: 'object', properties: { plan: { type: 'string' } } }), responses: { '200': ok('Downgraded', ref('Subscription')), '402': respRef('Quota'), ...commonErrors } },
  },
  '/billing/cancel': {
    post: { tags: ['Billing'], summary: 'Cancel the subscription (paid access continues until period end)', security: auth, responses: { '200': ok('Canceled', ref('Subscription')), ...commonErrors } },
  },

  // ===== Webhooks =====
  '/webhooks': {
    get: { tags: ['Webhooks'], summary: 'List webhooks', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { webhooks: { type: 'array', items: ref('Webhook') } } }), ...commonErrors } },
    post: { tags: ['Webhooks'], summary: 'Create a webhook', security: auth, requestBody: body({ type: 'object', properties: { name: { type: 'string' }, url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string' } }, deviceIds: { type: 'array', items: { type: 'string', format: 'uuid' } } }, required: ['name', 'url', 'events'] }), responses: { '201': ok('Created', ref('Webhook')), ...commonErrors } },
  },
  '/webhooks/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    patch: { tags: ['Webhooks'], summary: 'Update editable fields (name/url/events/deviceIds/status)', security: auth, requestBody: body({ type: 'object' }), responses: { '200': ok('OK', ref('Webhook')), ...commonErrors } },
    delete: { tags: ['Webhooks'], summary: 'Delete a webhook', security: auth, responses: { '204': { description: 'Deleted' }, ...commonErrors } },
  },
  '/webhooks/{id}/test': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    post: { tags: ['Webhooks'], summary: 'Send a test event', security: auth, responses: { '200': ok('Outcome', { type: 'object', properties: { ok: { type: 'boolean' }, status: { type: 'integer' }, error: { type: 'string' }, attempts: { type: 'integer' } } }), ...commonErrors } },
  },
  '/webhooks/{id}/deliveries': {
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['sent', 'failed'] } },
      { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
    ],
    get: { tags: ['Webhooks'], summary: 'Per-attempt delivery log', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { deliveries: { type: 'array', items: ref('WebhookDeliveryEntry') } } }), ...commonErrors } },
  },

  // ===== Branding =====
  '/branding': {
    get: { tags: ['Branding'], summary: 'Get current branding (tenant)', security: auth, responses: { '200': ok('OK', ref('Branding')), ...commonErrors } },
    put: { tags: ['Branding'], summary: 'Update branding (white-label)', security: auth, requestBody: body(ref('Branding')), responses: { '200': ok('Updated', ref('Branding')), ...commonErrors } },
  },
  '/public/branding': {
    get: { tags: ['Branding'], summary: 'Public branding lookup (no auth) — used by the dashboard at custom domains', security: [], responses: { '200': ok('OK', ref('Branding')) } },
  },

  // ===== Users =====
  '/users': {
    get: { tags: ['Users'], summary: 'List members of the workspace', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { users: { type: 'array', items: ref('PublicUser') } } }), ...commonErrors } },
    post: { tags: ['Users'], summary: 'Invite a member (returns a temp password + emails an invite)', security: auth, requestBody: body({ type: 'object', properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' }, role: { type: 'string' } }, required: ['email', 'name'] }), responses: { '201': ok('Invited', { type: 'object', properties: { user: ref('PublicUser'), tempPassword: { type: 'string' } } }), '402': respRef('Quota'), ...commonErrors } },
  },
  '/users/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    delete: { tags: ['Users'], summary: 'Remove a member (last owner is refused)', security: auth, responses: { '204': { description: 'Removed' }, ...commonErrors } },
  },

  '/users/mfa-requirement': {
    put: { tags: ['Users'], summary: 'Set the workspace MFA policy (un-enrolled members are prompted at login)', security: auth, requestBody: body({ type: 'object', properties: { required: { type: 'boolean' } }, required: ['required'] }), responses: { '200': ok('Updated', { type: 'object', properties: { required: { type: 'boolean' } } }), ...commonErrors } },
  },

  // ===== Me (current account) =====
  '/me/memberships': {
    get: { tags: ['Me'], summary: 'List org memberships of the current user', security: auth, responses: { '200': ok('OK'), ...commonErrors } },
  },
  '/me/switch-org': {
    post: { tags: ['Me'], summary: 'Mint tokens scoped to another org the user is a member of', security: auth, requestBody: body({ type: 'object', properties: { tenantId: { type: 'string', format: 'uuid' } }, required: ['tenantId'] }), responses: { '200': ok('Switched', { type: 'object', properties: { tokens: ref('AuthTokens') } }), ...commonErrors } },
  },
  '/me/password': {
    post: { tags: ['Me'], summary: 'Change password (verifies the current one; revokes all refresh sessions)', security: auth, requestBody: body({ type: 'object', properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } }, required: ['currentPassword', 'newPassword'] }), responses: { '200': ok('Changed'), ...commonErrors } },
  },
  '/me/sessions': {
    get: { tags: ['Me'], summary: 'List refresh-token sessions (active devices)', security: auth, responses: { '200': ok('OK'), ...commonErrors } },
  },
  '/me/sessions/revoke-all': {
    post: { tags: ['Me'], summary: 'Sign out everywhere (revoke all refresh sessions)', security: auth, responses: { '200': ok('Revoked'), ...commonErrors } },
  },
  '/me/mfa': {
    get: { tags: ['Me'], summary: 'MFA status (enabled, pending setup, recovery codes remaining, tenant policy)', security: auth, responses: { '200': ok('OK', { type: 'object', properties: { enabled: { type: 'boolean' }, pendingSetup: { type: 'boolean' }, recoveryCodesRemaining: { type: 'integer' }, requiredByTenant: { type: 'boolean' } } }), ...commonErrors } },
  },
  '/me/mfa/setup': {
    post: { tags: ['Me'], summary: 'Start TOTP enrollment: returns the secret + otpauth:// URI (shown once)', security: auth, responses: { '200': ok('Pending', { type: 'object', properties: { secret: { type: 'string' }, otpauthUri: { type: 'string' } } }), ...commonErrors } },
  },
  '/me/mfa/enable': {
    post: { tags: ['Me'], summary: 'Confirm enrollment with the first code; returns recovery codes ONCE', security: auth, requestBody: body({ type: 'object', properties: { code: { type: 'string' } }, required: ['code'] }), responses: { '200': ok('Enabled', { type: 'object', properties: { enabled: { type: 'boolean' }, recoveryCodes: { type: 'array', items: { type: 'string' } } } }), ...commonErrors } },
  },
  '/me/mfa/disable': {
    post: { tags: ['Me'], summary: 'Disable MFA (requires a valid TOTP or recovery code)', security: auth, requestBody: body({ type: 'object', properties: { code: { type: 'string' } }, required: ['code'] }), responses: { '200': ok('Disabled'), ...commonErrors } },
  },
  '/me/export': {
    get: { tags: ['Me'], summary: 'Export all workspace data as JSON (owner only; DPDP/GDPR data portability)', description: 'Includes tenant, members, devices, vehicles, groups, geofences, alerts, trips, invoices, audit logs, API-key/webhook metadata (never secrets), and the newest 50k positions (`positionsTruncated` flags older history).', security: auth, responses: { '200': ok('Export bundle'), ...commonErrors } },
  },
  '/me/tenant': {
    delete: { tags: ['Me'], summary: 'Hard-delete the whole workspace (owner only; irreversible)', description: 'Requires the owner password and the typed phrase "delete my workspace". Purges positions and cascades every tenant-scoped table.', security: auth, requestBody: body({ type: 'object', properties: { password: { type: 'string' }, confirm: { type: 'string', description: 'Must be exactly "delete my workspace"' } }, required: ['password', 'confirm'] }), responses: { '204': { description: 'Workspace deleted' }, ...commonErrors } },
  },

  // ===== Push =====
  '/push/register': {
    post: { tags: ['Push'], summary: 'Register an Expo push token for the current user', security: auth, requestBody: body({ type: 'object', properties: { token: { type: 'string' }, platform: { type: 'string', enum: ['ios', 'android'] } }, required: ['token'] }), responses: { '201': ok('Registered'), ...commonErrors } },
  },

  // ===== Admin (operator-only; x-admin-token) =====
  '/admin/plans': {
    get: { tags: ['Admin'], summary: 'List the full plan catalog with all versions', security: adminAuth, responses: { '200': ok('OK'), '401': respRef('Unauthorized'), '403': respRef('Forbidden') } },
    post: { tags: ['Admin'], summary: 'Create a plan + its initial version', security: adminAuth, requestBody: body({ type: 'object' }), responses: { '201': ok('Created'), ...commonErrors } },
  },
  '/admin/plans/{key}': {
    parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    patch: { tags: ['Admin'], summary: 'Update plan metadata (name, visibility, sort order, active)', security: adminAuth, requestBody: body({ type: 'object' }), responses: { '200': ok('Updated'), ...commonErrors } },
  },
  '/admin/plans/{key}/version': {
    parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    put: { tags: ['Admin'], summary: 'Versioning-on-edit: archive the active version and add a new one', security: adminAuth, requestBody: body({ type: 'object' }), responses: { '201': ok('New version'), ...commonErrors } },
  },
  '/admin/rates': {
    get: { tags: ['Admin'], summary: 'List metered billing rates', security: adminAuth, responses: { '200': ok('OK'), ...commonErrors } },
  },
  '/admin/rates/{resource}': {
    parameters: [{ name: 'resource', in: 'path', required: true, schema: { type: 'string' } }],
    put: { tags: ['Admin'], summary: 'Upsert a metered rate (unit cost × markup)', security: adminAuth, requestBody: body({ type: 'object' }), responses: { '200': ok('Upserted'), ...commonErrors } },
  },
  '/admin/billing/close/{period}': {
    parameters: [{ name: 'period', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}$', example: '2026-05' } }],
    post: { tags: ['Admin'], summary: "Bill every tenant's metered overages for a closed period (idempotent)", security: adminAuth, responses: { '200': ok('OK'), ...commonErrors } },
  },
  '/admin/margin-check': {
    get: { tags: ['Admin'], summary: 'Flag any plan priced below its included-unit cost', security: adminAuth, responses: { '200': ok('OK'), ...commonErrors } },
  },

  // ===== Ingest (TCP gateway → internal HTTP) =====
  '/internal/positions': {
    post: {
      tags: ['Ingest'],
      summary: 'Internal position sink for the TCP ingest service (token-gated)',
      security: ingestAuth,
      requestBody: body({
        type: 'object',
        properties: {
          imei: { type: 'string' },
          protocol: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          speedKph: { type: 'number' },
          course: { type: 'number' },
          gpsValid: { type: 'boolean' },
          satellites: { type: 'integer' },
          fixTime: { type: 'integer' },
          kind: { type: 'string', enum: ['location', 'status', 'alarm'] },
          alarmType: { type: 'string' },
        },
        required: ['imei', 'fixTime'],
      }),
      responses: { '200': ok('OK'), '202': ok('Accepted but unknown IMEI'), '401': respRef('Unauthorized') },
    },
  },

  // ===== Health =====
  '/health': {
    get: { tags: ['Health'], summary: 'Liveness check', security: [], responses: { '200': ok('OK', { type: 'object', properties: { status: { type: 'string' }, service: { type: 'string' } } }) } },
  },
  '/metrics': {
    get: {
      tags: ['Health'],
      summary: 'Prometheus metrics (text exposition format)',
      description: 'Golden-signal metrics. Token-gated when METRICS_TOKEN is set (Bearer); refused in production without a token.',
      security: [{ bearerAuth: [] }, {}],
      responses: { '200': { description: 'Prometheus text', content: { 'text/plain': { schema: { type: 'string' } } } }, '401': respRef('Unauthorized'), '403': respRef('Forbidden') },
    },
  },
};

// ---------- root ----------

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'TrackFlow API',
    version: '1.0.0',
    description: 'REST API for the TrackFlow GPS tracking platform. Authenticate with a Bearer JWT or an `x-api-key`; admin endpoints use `x-admin-token`; the TCP ingest sink uses `x-ingest-token`.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth', description: 'Login, refresh rotation, logout, password reset, email verification' },
    { name: 'Devices' },
    { name: 'Vehicles' },
    { name: 'Geofences' },
    { name: 'Alerts' },
    { name: 'Analytics' },
    { name: 'Billing' },
    { name: 'API Keys' },
    { name: 'Webhooks' },
    { name: 'Branding' },
    { name: 'Users' },
    { name: 'Push' },
    { name: 'Admin', description: 'Operator-only catalog/rates/billing administration. Gated by `x-admin-token`.' },
    { name: 'Ingest', description: 'Internal position sink hit by the TCP ingest service.' },
    { name: 'Health' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      adminAuth: { type: 'apiKey', in: 'header', name: 'x-admin-token' },
      ingestAuth: { type: 'apiKey', in: 'header', name: 'x-ingest-token' },
    },
    schemas,
    responses: errorResponses,
  },
  security: auth,
  paths,
} as const;
