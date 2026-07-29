import { z } from 'zod';

/** Min length plus a letters-and-numbers mix; shared by register + reset. */
const strongPassword = z
  .string()
  .min(8)
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), {
    message: 'Password must contain both letters and numbers',
  });

export const registerSchema = z.object({
  email: z.string().email(),
  password: strongPassword,
  name: z.string().min(1).max(120),
  tenantName: z.string().min(1).max(120),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const deviceTypes = ['vehicle', 'personal', 'asset', 'container'] as const;
export const protocols = ['gt06', 'h02', 'teltonika', 'nmea', 'queclink', 'meitrack'] as const;
export const deviceStatuses = ['active', 'inactive', 'maintenance'] as const;

export const createDeviceSchema = z.object({
  name: z.string().min(1).max(120),
  imei: z.string().regex(/^\d{15}$/, 'IMEI must be 15 digits'),
  type: z.enum(deviceTypes).default('vehicle'),
  protocol: z.enum(protocols).default('gt06'),
  registrationNumber: z.string().max(20).optional(),
  status: z.enum(deviceStatuses).default('active'),
});

export const updateDeviceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  type: z.enum(deviceTypes).optional(),
  registrationNumber: z.string().max(20).nullable().optional(),
  status: z.enum(deviceStatuses).optional(),
  vehicleId: z.string().uuid().nullable().optional(),
});

export const createVehicleSchema = z.object({
  name: z.string().min(1).max(120),
  registration: z.string().max(20).optional(),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
});

export const updateVehicleSchema = createVehicleSchema.partial();

export const reportPositionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKph: z.number().min(0).max(1000).optional(),
  course: z.number().min(0).max(360).optional(),
  gpsValid: z.boolean().optional(),
  timestamp: z.number().int().positive().optional(), // epoch ms
});

export const attributesSchema = z.record(z.union([z.number(), z.boolean(), z.string()]));

// Internal ingest payload pushed by the TCP ingest service (trusted, token-gated).
// A message may carry a position, telemetry attributes, or both (a status-only
// packet has attributes but no lat/lon).
export const ingestPositionSchema = z.object({
  imei: z.string().regex(/^\d{6,17}$/),
  protocol: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  speedKph: z.number().optional(),
  course: z.number().optional(),
  gpsValid: z.boolean().optional(),
  satellites: z.number().int().optional(),
  attributes: attributesSchema.optional(),
  fixTime: z.number().int(), // epoch ms
  kind: z.string(),
  alarmType: z.string().optional(),
});

export const ingestAdmissionSchema = z.object({
  imei: z.string().regex(/^\d{6,17}$/),
  protocol: z.enum(protocols),
  transportSecurity: z.enum(['development', 'mtls', 'private_gateway']),
  authenticatedImei: z.string().regex(/^\d{6,17}$/).optional(),
});

export const roles = ['owner', 'admin', 'manager', 'user', 'viewer'] as const;

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).min(1).default(['devices:read']),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(roles).default('user'),
});

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const recipientsSchema = z.object({
  emails: z.array(z.string().email()).optional(),
  phones: z.array(z.string().regex(/^\+?\d{6,15}$/)).optional(),
  webhookUrl: z.string().url().optional(),
});
export const channelNames = ['console', 'email', 'sms', 'webhook', 'push', 'whatsapp'] as const;

export const createGeofenceSchema = z
  .object({
    name: z.string().min(1).max(120),
    type: z.enum(['circle', 'polygon']),
    center: latLng.optional(),
    radiusM: z.number().positive().max(1_000_000).optional(),
    points: z.array(latLng).min(3).optional(),
    color: z.string().max(9).optional(),
    onEntry: z.boolean().default(true),
    onExit: z.boolean().default(true),
    onDwell: z.boolean().default(false),
    dwellSeconds: z.number().int().min(1).max(86_400).default(300),
    throttleSeconds: z.number().int().min(0).max(86_400).default(0),
    channels: z.array(z.enum(channelNames)).min(1).default(['console']),
    recipients: recipientsSchema.default({}),
    allDevices: z.boolean().default(true),
    deviceIds: z.array(z.string().uuid()).default([]),
  })
  .refine((d) => (d.type === 'circle' ? !!d.center && !!d.radiusM : !!d.points && d.points.length >= 3), {
    message: 'circle requires center + radiusM; polygon requires >= 3 points',
  });

export const updateGeofenceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  color: z.string().max(9).optional(),
  onEntry: z.boolean().optional(),
  onExit: z.boolean().optional(),
  onDwell: z.boolean().optional(),
  dwellSeconds: z.number().int().min(1).max(86_400).optional(),
  throttleSeconds: z.number().int().min(0).max(86_400).optional(),
  channels: z.array(z.enum(channelNames)).min(1).optional(),
  recipients: recipientsSchema.optional(),
  allDevices: z.boolean().optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const checkoutSchema = z.object({
  plan: z.enum(['starter', 'professional', 'enterprise']),
  billingCycle: z.enum(['monthly', 'annual']).default('monthly'),
});

/** Self-serve downgrade target (enterprise is sales-led, not a self-serve move). */
export const downgradeSchema = z.object({
  plan: z.enum(['free', 'starter', 'professional']),
});

export const forgotPasswordSchema = z.object({ email: z.string().email() });
export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: strongPassword,
});
export const verifyEmailSchema = z.object({ token: z.string().min(10) });

export const webhookEvents = [
  'alert.triggered',
  'geofence.entry',
  'geofence.exit',
  'device.online',
  'device.offline',
  'trip.completed',
] as const;

export const createWebhookSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  events: z.array(z.enum(webhookEvents)).min(1),
  deviceIds: z.array(z.string().uuid()).optional(),
});

/** Editable fields for a webhook — all optional so PATCH can update any subset. */
export const updateWebhookSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().url().optional(),
  events: z.array(z.enum(webhookEvents)).min(1).optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

export const createDeviceGroupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex colour')
    .optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
});

export const updateDeviceGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(400).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex colour')
    .optional(),
});

export const setGroupMembersSchema = z.object({
  deviceIds: z.array(z.string().uuid()),
});

export const queueDeviceCommandSchema = z.object({
  command: z.enum(['immobilize', 'mobilize', 'request_location', 'set_interval', 'reboot']),
  parameters: z.record(z.string(), z.unknown()).optional(),
  expiresInSeconds: z.number().int().positive().max(7 * 24 * 3600).optional(),
});

export const ackDeviceCommandSchema = z.object({
  status: z.enum(['acked', 'failed']),
  response: z.string().max(2000).optional(),
});

export const switchOrgSchema = z.object({
  tenantId: z.string().uuid(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPassword,
});

/** A 6-digit TOTP code or an XXXXX-XXXXX recovery code. */
const mfaCode = z.string().min(6).max(16);

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(10),
  code: mfaCode,
});

export const mfaCodeSchema = z.object({ code: mfaCode });

export const mfaRequirementSchema = z.object({ required: z.boolean() });

/** Hard-deleting a workspace needs the owner's password + a typed phrase. */
export const deleteTenantSchema = z.object({
  password: z.string().min(1).max(128),
  confirm: z.string().min(1).max(64),
});

export const updateBrandingSchema = z.object({
  brandName: z.string().max(60).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #6366f1')
    .nullable()
    .optional(),
  customDomain: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'must be a valid hostname')
    .nullable()
    .optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type ReportPositionInput = z.infer<typeof reportPositionSchema>;
export type IngestPositionInput = z.infer<typeof ingestPositionSchema>;
export type CreateGeofenceInput = z.infer<typeof createGeofenceSchema>;
export type UpdateGeofenceInput = z.infer<typeof updateGeofenceSchema>;
