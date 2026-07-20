import type { Permission } from '@trackflow/shared';
import { errors, hasPermission } from '@trackflow/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './auth.js';

export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const p = c.get('principal');
    if (!hasPermission({ role: p.role, scopes: p.scopes }, permission)) {
      throw errors.forbidden(`Missing permission: ${permission}`);
    }
    await next();
  };
}
