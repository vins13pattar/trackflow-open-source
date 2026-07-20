import type {
  AlertSummary,
  DeliveryLogEntry,
  AnalyticsSummary,
  ApiKeySummary,
  AuthTokens,
  Branding,
  CreateGeofenceInput,
  DeviceGroupSummary,
  DeviceSummary,
  DistanceByDay,
  GeofenceSummary,
  HistoryPoint,
  InvoiceSummary,
  Plan,
  PublicUser,
  Subscription,
  TeamMember,
  VehicleSummary,
  WebhookDeliveryEntry,
  WebhookSummary,
} from './types';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787';
export const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';

/** Where GPS devices connect (the ingest server) — shown in the connection guide. */
export const INGEST_HOST = process.env.NEXT_PUBLIC_INGEST_HOST ?? 'your-trackflow-host';
export const PROTOCOL_PORTS: Record<string, number> = { gt06: 5023, h02: 5013, teltonika: 5027, nmea: 5004 };

const TOKEN_KEY = 'trackflow.accessToken';
export const USER_KEY = 'trackflow.user';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Clears the stored session (token + user). */
export function clearSession(): void {
  setToken(null);
  if (typeof window !== 'undefined') window.localStorage.removeItem(USER_KEY);
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    // Expired/invalid session on an authenticated call → clear and bounce to login.
    // (Auth endpoints are excluded so login failures still surface their error.)
    if (res.status === 401 && !path.startsWith('/auth/')) {
      clearSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login?expired=1');
      }
    }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const err = new ApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`);
    // Forward server errors (5xx) to Sentry; 4xx are user/client errors.
    if (res.status >= 500) {
      void import('./observability').then(({ reportError }) => reportError(err, { path, status: res.status }));
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface AuthResponse {
  user: PublicUser;
  tokens: AuthTokens;
  /** Set when the workspace requires MFA and this user has not enrolled yet. */
  mfaSetupRequired?: boolean;
}

/** Returned by /auth/login instead of tokens when the user has MFA enabled. */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

export interface MfaStatus {
  enabled: boolean;
  pendingSetup: boolean;
  recoveryCodesRemaining: number;
  requiredByTenant: boolean;
}

export const api = {
  register: (input: { email: string; password: string; name: string; tenantName: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<AuthResponse | MfaChallenge>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  verifyMfa: (input: { mfaToken: string; code: string }) =>
    request<AuthResponse>('/auth/mfa/verify', { method: 'POST', body: JSON.stringify(input) }),

  mfaStatus: () => request<MfaStatus>('/me/mfa'),
  mfaSetup: () => request<{ secret: string; otpauthUri: string }>('/me/mfa/setup', { method: 'POST', body: '{}' }),
  mfaEnable: (code: string) =>
    request<{ enabled: boolean; recoveryCodes: string[] }>('/me/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  mfaDisable: (code: string) =>
    request<{ enabled: boolean }>('/me/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  setMfaRequirement: (required: boolean) =>
    request<{ required: boolean }>('/users/mfa-requirement', { method: 'PUT', body: JSON.stringify({ required }) }),
  deleteWorkspace: (input: { password: string; confirm: string }) =>
    request<void>('/me/tenant', { method: 'DELETE', body: JSON.stringify(input) }),
  listDevices: () => request<{ devices: DeviceSummary[]; total: number }>('/devices'),
  createDevice: (input: {
    name: string;
    imei: string;
    type: string;
    protocol: string;
    registrationNumber?: string;
    status?: string;
  }) => request<DeviceSummary>('/devices', { method: 'POST', body: JSON.stringify(input) }),
  updateDevice: (
    id: string,
    patch: { name?: string; type?: string; status?: string; registrationNumber?: string | null; vehicleId?: string | null },
  ) => request<DeviceSummary>(`/devices/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteDevice: (id: string) => request<void>(`/devices/${id}`, { method: 'DELETE' }),

  listVehicles: () => request<{ vehicles: VehicleSummary[]; total: number }>('/vehicles'),
  createVehicle: (input: { name: string; registration?: string; make?: string; model?: string }) =>
    request<VehicleSummary>('/vehicles', { method: 'POST', body: JSON.stringify(input) }),
  deleteVehicle: (id: string) => request<void>(`/vehicles/${id}`, { method: 'DELETE' }),
  history: (deviceId: string, fromMs: number, toMs: number) =>
    request<{ deviceId: string; points: HistoryPoint[]; total: number }>(
      `/devices/${deviceId}/history?from=${fromMs}&to=${toMs}&limit=2000`,
    ),

  listApiKeys: () => request<{ keys: ApiKeySummary[]; total: number }>('/api-keys'),
  createApiKey: (input: { name: string; scopes: string[] }) =>
    request<ApiKeySummary & { key: string }>('/api-keys', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  revokeApiKey: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),

  listUsers: () => request<{ users: TeamMember[]; total: number }>('/users'),
  inviteUser: (input: { email: string; name: string; role: string }) =>
    request<{ user: TeamMember; tempPassword: string }>('/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listGeofences: () => request<{ geofences: GeofenceSummary[]; total: number }>('/geofences'),
  createGeofence: (input: CreateGeofenceInput) =>
    request<GeofenceSummary>('/geofences', { method: 'POST', body: JSON.stringify(input) }),
  updateGeofence: (
    id: string,
    patch: { status?: string; name?: string; color?: string; onEntry?: boolean; onExit?: boolean; channels?: string[]; recipients?: { emails?: string[] } },
  ) =>
    request<GeofenceSummary>(`/geofences/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteGeofence: (id: string) => request<void>(`/geofences/${id}`, { method: 'DELETE' }),

  listDeviceGroups: () => request<{ groups: DeviceGroupSummary[]; total: number }>('/device-groups'),
  createDeviceGroup: (input: { name: string; description?: string; color?: string; deviceIds?: string[] }) =>
    request<DeviceGroupSummary>('/device-groups', { method: 'POST', body: JSON.stringify(input) }),
  updateDeviceGroup: (id: string, patch: { name?: string; description?: string; color?: string }) =>
    request<DeviceGroupSummary>(`/device-groups/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteDeviceGroup: (id: string) => request<void>(`/device-groups/${id}`, { method: 'DELETE' }),
  setGroupMembers: (id: string, deviceIds: string[]) =>
    request<DeviceGroupSummary>(`/device-groups/${id}/devices`, { method: 'PUT', body: JSON.stringify({ deviceIds }) }),

  listAlerts: (onlyUnack = false) =>
    request<{ alerts: AlertSummary[]; total: number }>(`/alerts${onlyUnack ? '?acknowledged=false' : ''}`),
  ackAlert: (id: string) => request<AlertSummary>(`/alerts/${id}/ack`, { method: 'POST' }),
  listDeliveries: (params: { alertId?: string; status?: string } = {}) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ deliveries: DeliveryLogEntry[]; total: number }>(`/alerts/deliveries${q ? `?${q}` : ''}`);
  },

  analyticsSummary: () => request<AnalyticsSummary>('/analytics/summary'),
  distanceByDay: () => request<{ days: DistanceByDay[] }>('/analytics/distance-by-day'),

  getPlans: () => request<{ plans: Plan[] }>('/billing/plans'),
  getSubscription: () => request<Subscription>('/billing/subscription'),
  listInvoices: () => request<{ invoices: InvoiceSummary[]; total: number }>('/billing/invoices'),
  checkout: (plan: string, billingCycle: 'monthly' | 'annual' = 'monthly') =>
    request<{ orderId: string; amountInr: number; currency: string; keyId: string | null; mock: boolean }>(
      '/billing/checkout',
      { method: 'POST', body: JSON.stringify({ plan, billingCycle }) },
    ),
  upgradePlan: (plan: string, billingCycle: 'monthly' | 'annual' = 'monthly') =>
    request<{ subscription: Subscription; invoice: InvoiceSummary }>('/billing/confirm', {
      method: 'POST',
      body: JSON.stringify({ plan, billingCycle }),
    }),
  downgradePlan: (plan: string) =>
    request<Subscription>('/billing/downgrade', { method: 'POST', body: JSON.stringify({ plan }) }),
  cancelSubscription: () => request<Subscription>('/billing/cancel', { method: 'POST' }),

  listWebhooks: () => request<{ webhooks: WebhookSummary[]; total: number }>('/webhooks'),
  createWebhook: (input: { name: string; url: string; events: string[]; deviceIds?: string[] }) =>
    request<WebhookSummary>('/webhooks', { method: 'POST', body: JSON.stringify(input) }),
  updateWebhook: (id: string, input: Partial<{ name: string; url: string; events: string[]; deviceIds: string[]; status: 'active' | 'paused' }>) =>
    request<WebhookSummary>(`/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteWebhook: (id: string) => request<void>(`/webhooks/${id}`, { method: 'DELETE' }),
  testWebhook: (id: string) =>
    request<{ ok: boolean; status?: number; error?: string; attempts?: number }>(`/webhooks/${id}/test`, { method: 'POST' }),
  listWebhookDeliveries: (id: string, params: { status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ deliveries: WebhookDeliveryEntry[]; total: number }>(`/webhooks/${id}/deliveries${q ? `?${q}` : ''}`);
  },

  getBranding: () => request<Branding>('/branding'),
  updateBranding: (patch: Partial<Branding>) =>
    request<Branding>('/branding', { method: 'PUT', body: JSON.stringify(patch) }),
};

/** Downloads the trips CSV (auth header can't ride on a plain <a>, so fetch+blob). */
export async function downloadTripsCsv(): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/analytics/export`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trips.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Downloads the full workspace data export (DPDP/GDPR) as a JSON file. */
export async function downloadWorkspaceExport(): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/me/export`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trackflow-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Downloads a GST invoice PDF (auth header can't ride on a plain <a>, so fetch+blob). */
export async function downloadInvoicePdf(id: string, number: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/billing/invoices/${id}/pdf`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Failed to download invoice (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${number}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export { ApiError };
