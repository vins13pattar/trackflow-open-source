import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };
export { eq, and, or, desc, asc, gte, gt, lte, lt, ilike, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
export {
  applyRls,
  ensureAppRole,
  ensureSystemRole,
  withTenant,
  withSystem,
  rlsStatements,
  appRoleStatements,
  systemRoleStatements,
  RLS_TABLES,
  SYSTEM_ACCESS_REASONS,
  type SystemAccessReason,
  type Tx,
} from './rls.js';

export type Database = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle client over postgres.js for the Node API/ingest services.
 * (On Cloudflare Workers this is swapped for `drizzle-orm/neon-http` + the Neon
 * serverless driver — same schema, same queries.)
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}
