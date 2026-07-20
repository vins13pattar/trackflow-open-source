import type { Role } from './types.js';

export type Permission =
  | 'devices:read'
  | 'devices:write'
  | 'geofences:read'
  | 'geofences:write'
  | 'alerts:read'
  | 'reports:read'
  | 'apikeys:manage'
  | 'users:manage'
  | 'billing:manage'
  | 'webhooks:manage'
  | 'branding:manage';

export const ALL_PERMISSIONS: Permission[] = [
  'devices:read',
  'devices:write',
  'geofences:read',
  'geofences:write',
  'alerts:read',
  'reports:read',
  'apikeys:manage',
  'users:manage',
  'billing:manage',
  'webhooks:manage',
  'branding:manage',
];

const READ_ONLY: Permission[] = ['devices:read', 'geofences:read', 'alerts:read', 'reports:read'];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  manager: [...READ_ONLY, 'devices:write', 'geofences:write'],
  user: READ_ONLY,
  viewer: READ_ONLY,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** A principal is either a user (role-based) or an API key (scope-based). */
export function hasPermission(
  principal: { role?: Role; scopes?: string[] },
  permission: Permission,
): boolean {
  if (principal.scopes) {
    return principal.scopes.includes('*') || principal.scopes.includes(permission);
  }
  if (principal.role) {
    return permissionsForRole(principal.role).includes(permission);
  }
  return false;
}
