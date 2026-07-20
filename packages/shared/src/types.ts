export type Role = 'owner' | 'admin' | 'manager' | 'user' | 'viewer';
export type Plan = 'free' | 'starter' | 'professional' | 'enterprise';
export type DeviceStatus = 'active' | 'inactive' | 'offline' | 'maintenance';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
}

export interface LastPosition {
  latitude: number;
  longitude: number;
  speedKph: number;
  course: number;
  fixTime: string; // ISO
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
  attributes: Record<string, number | boolean | string> | null;
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
  /** Position from the device with the most recent fix. */
  lastPosition: LastPosition | null;
  /** Telemetry merged across all attached devices. */
  attributes: Record<string, number | boolean | string> | null;
  lastSeen: string | null;
}
