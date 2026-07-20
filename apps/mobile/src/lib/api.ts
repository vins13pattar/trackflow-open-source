import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const API_BASE =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:8787';

const TOKEN_KEY = 'trackflow.token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function setToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  imei: string;
  status: string;
  lastPosition: { latitude: number; longitude: number; speedKph: number; fixTime: string } | null;
}

export interface ReportInput {
  latitude: number;
  longitude: number;
  speedKph?: number;
  course?: number;
  timestamp?: number;
}

export interface AlertDetail {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  deviceId: string | null;
  geofenceId: string | null;
  lat: number | null;
  lon: number | null;
  acknowledged: boolean;
  createdAt: string;
}

export const api = {
  login: (email: string, password: string) =>
    req<{ user: PublicUser; tokens: { accessToken: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  listDevices: () => req<{ devices: DeviceSummary[]; total: number }>('/devices'),
  reportPosition: (deviceId: string, pos: ReportInput) =>
    req<{ ok: boolean }>(`/devices/${deviceId}/report`, { method: 'POST', body: JSON.stringify(pos) }),
  registerPush: (token: string, platform: string) =>
    req<{ ok: boolean }>('/push/register', { method: 'POST', body: JSON.stringify({ token, platform }) }),
  getAlert: (id: string) => req<AlertDetail>(`/alerts/${id}`),
  ackAlert: (id: string) => req<AlertDetail>(`/alerts/${id}/ack`, { method: 'POST' }),
};
