export type DeviceStatus = 'active' | 'inactive' | 'offline' | 'maintenance';

export type Attributes = Record<string, number | boolean | string>;

export interface LastPosition {
  latitude: number;
  longitude: number;
  speedKph: number;
  course: number;
  fixTime: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  imei: string;
  type: string;
  protocol: string;
  status: DeviceStatus;
  registrationNumber: string | null;
  vehicleId: string | null;
  lastPosition: LastPosition | null;
  lastSeen: string | null;
  attributes: Attributes | null;
}

export interface VehicleDeviceRef {
  id: string;
  name: string;
  protocol: string;
  status: DeviceStatus;
  lastSeen: string | null;
  hasPosition: boolean;
}

export interface VehicleSummary {
  id: string;
  name: string;
  registration: string | null;
  make: string | null;
  model: string | null;
  deviceCount: number;
  devices: VehicleDeviceRef[];
  lastPosition: LastPosition | null;
  attributes: Attributes | null;
  lastSeen: string | null;
}

export interface HistoryPoint {
  latitude: number;
  longitude: number;
  speedKph: number;
  course: number;
  fixTime: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface GeofenceSummary {
  id: string;
  name: string;
  type: 'circle' | 'polygon';
  center: { lat: number; lng: number } | null;
  radiusM: number | null;
  points: { lat: number; lng: number }[] | null;
  color: string;
  onEntry: boolean;
  onExit: boolean;
  onDwell: boolean;
  dwellSeconds: number;
  throttleSeconds: number;
  channels: string[];
  recipients: { emails?: string[]; phones?: string[]; webhookUrl?: string };
  allDevices: boolean;
  deviceIds: string[];
  groupIds: string[];
  status: string;
  createdAt: string;
}

export interface DeviceGroupSummary {
  id: string;
  name: string;
  description: string | null;
  color: string;
  deviceIds: string[];
  createdAt: string;
}

export interface AlertDelivery {
  channel: string;
  recipient: string;
  status: string;
  error?: string;
  sentAt: number;
}

export interface DeliveryLogEntry {
  id: string;
  alertId: string;
  channel: string;
  recipient: string;
  status: string;
  attempt: number;
  error: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertSummary {
  id: string;
  deviceId: string;
  geofenceId: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  lat: number | null;
  lon: number | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  notifications: AlertDelivery[];
  createdAt: string;
}

export type CreateGeofenceInput =
  | {
      name: string;
      type: 'circle';
      center: { lat: number; lng: number };
      radiusM: number;
      onEntry: boolean;
      onExit: boolean;
      channels: string[];
      recipients?: { emails?: string[]; phones?: string[] };
    }
  | {
      name: string;
      type: 'polygon';
      points: { lat: number; lng: number }[];
      onEntry: boolean;
      onExit: boolean;
      channels: string[];
      recipients?: { emails?: string[]; phones?: string[] };
    };

export interface AlertEventLive {
  id: string;
  deviceId: string;
  geofenceId: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  lat: number | null;
  lon: number | null;
  createdAt: string;
}

export interface AnalyticsSummary {
  trips: number;
  distanceKm: number;
  durationHours: number;
  avgSpeedKph: number;
  maxSpeedKph: number;
  activeDevices: number;
  driverScore: number;
}

export interface DistanceByDay {
  date: string;
  distanceKm: number;
  trips: number;
}

export interface PlanLimits {
  devices: number;
  users: number;
  geofences: number;
  apiCallsPerMonth: number;
  historyDays: number;
}

export interface Plan {
  key: string;
  name: string;
  priceInr: number;
  annualInr: number;
  limits: PlanLimits;
  includedUnits: Record<string, number>;
  versionId: string | null;
  isPublic: boolean;
}

export interface OverageItem {
  resource: string;
  included: number;
  used: number;
  overage: number;
  ratePerUnitInr: number;
  amountInr: number;
}

export interface Subscription {
  plan: string;
  planName: string;
  status: string;
  billingCycle: string | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  limits: PlanLimits;
  usage: { devices: number; users: number; apiCalls: number; smsSent: number; whatsappSent: number; emailSent: number };
  overages: { items: OverageItem[]; totalInr: number };
}

export interface InvoiceSummary {
  id: string;
  number: string;
  plan: string;
  billingCycle: string;
  subtotalInr: number;
  taxInr: number;
  totalInr: number;
  currency: string;
  status: string;
  lineItems: { description: string; amountInr: number }[];
  createdAt: string;
}

export interface WebhookSummary {
  id: string;
  name: string;
  url: string;
  events: string[];
  deviceIds: string[];
  /** Returned only by createWebhook; list/update responses never reveal it. */
  secret?: string;
  status: string;
  successCount: number;
  failureCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface WebhookDeliveryEntry {
  id: string;
  webhookId: string;
  event: string;
  attempt: number;
  status: string;
  httpStatus: number | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

export interface Branding {
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  customDomain: string | null;
}

export const WEBHOOK_EVENTS = [
  'alert.triggered',
  'geofence.entry',
  'geofence.exit',
  'device.online',
  'device.offline',
  'trip.completed',
] as const;

export interface PositionEvent {
  deviceId: string;
  imei: string;
  lat: number;
  lon: number;
  speedKph: number;
  course: number;
  fixTime: string;
  kind: string;
  alarmType?: string;
  attributes?: Attributes;
}
