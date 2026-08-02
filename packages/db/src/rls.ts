/**
 * Row-Level Security: tenant isolation enforced by Postgres, not just app code.
 *
 * Each tenant-scoped table gets a policy keyed on the `app.tenant_id` session
 * GUC. Authenticated requests run their queries inside `withTenant`, which sets
 * that GUC transaction-locally — so even a buggy query physically cannot read
 * another tenant's rows. Trusted system paths (the device-ingest endpoint, key
 * lookups) use `withSystem` through a separate database identity that PostgreSQL
 * has explicitly granted `BYPASSRLS`. The tenant runtime role cannot promote
 * itself by setting a custom GUC.
 *
 * FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner, so
 * isolation holds with our single connection role.
 */
import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

/** The transaction handle drizzle hands to a `transaction()` callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const RLS_TABLES = [
  'vehicles',
  'devices',
  'positions',
  'api_keys',
  'geofences',
  'alerts',
  'geofence_states',
  'trips',
  'daily_rollups',
  'invoices',
  'webhooks',
  'push_tokens',
  'usage_counters',
  'notification_templates',
  'tenant_notification_settings',
  'notification_routes',
  'alert_deliveries',
  'webhook_deliveries',
  'device_groups',
  'device_group_members',
  'audit_logs',
  'device_commands',
  'saml_configs',
] as const;

export function rlsStatements(): string[] {
  const stmts: string[] = [];
  for (const table of RLS_TABLES) {
    stmts.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    stmts.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    stmts.push(`DROP POLICY IF EXISTS tenant_isolation ON ${table};`);
    stmts.push(
      `CREATE POLICY tenant_isolation ON ${table}
         USING (
           tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
         )
         WITH CHECK (
           tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
         );`,
    );
  }
  return stmts;
}

/** Idempotently applies all RLS policies. Run after migrations (as the owner). */
export async function applyRls(db: Database): Promise<void> {
  for (const stmt of rlsStatements()) {
    await db.execute(sql.raw(stmt));
  }
}

/**
 * SQL to provision the non-superuser runtime role. RLS is *bypassed* by
 * superusers, so the API must connect as this role for isolation to hold.
 * `role`/`password` come from operator config, not user input.
 */
export function appRoleStatements(role: string, password: string): string[] {
  // PostgreSQL identifiers cannot be parameterized in this bootstrap DDL.
  // Constrain the operator-controlled role to a plain identifier and escape
  // the password literal so a malformed secret cannot change the statement.
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(role)) throw new Error('Invalid PostgreSQL application role name');
  const escapedPassword = password.replaceAll("'", "''");
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
         CREATE ROLE ${role} LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER NOBYPASSRLS;
       END IF;
     END $$;`,
    `ALTER ROLE ${role} WITH LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;`,
    `REVOKE CREATE ON SCHEMA public FROM ${role};`,
    `GRANT USAGE ON SCHEMA public TO ${role};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role};`,
    // The retention job (runs as this role) drives partition maintenance through
    // these SECURITY DEFINER functions, which run with owner privileges.
    `GRANT EXECUTE ON FUNCTION trackflow_provision_positions_partitions(integer, integer) TO ${role};`,
    `GRANT EXECUTE ON FUNCTION trackflow_drop_positions_partitions_before(date) TO ${role};`,
  ];
}

/** SQL to provision the narrowly privileged identity used by reviewed system paths. */
export function systemRoleStatements(role: string, password: string): string[] {
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(role)) throw new Error('Invalid PostgreSQL system role name');
  const escapedPassword = password.replaceAll("'", "''");
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
         CREATE ROLE ${role} LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER BYPASSRLS;
       END IF;
     END $$;`,
    `ALTER ROLE ${role} WITH LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;`,
    `REVOKE CREATE ON SCHEMA public FROM ${role};`,
    `GRANT USAGE ON SCHEMA public TO ${role};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role};`,
    `GRANT EXECUTE ON FUNCTION trackflow_provision_positions_partitions(integer, integer) TO ${role};`,
    `GRANT EXECUTE ON FUNCTION trackflow_drop_positions_partitions_before(date) TO ${role};`,
  ];
}

/** Idempotently provisions the runtime role and its grants. Run as the owner. */
export async function ensureAppRole(db: Database, role: string, password: string): Promise<void> {
  for (const stmt of appRoleStatements(role, password)) {
    await db.execute(sql.raw(stmt));
  }
}

/** Idempotently provisions the privileged runtime role. Run as the owner. */
export async function ensureSystemRole(db: Database, role: string, password: string): Promise<void> {
  for (const stmt of systemRoleStatements(role, password)) {
    await db.execute(sql.raw(stmt));
  }
}

export const SYSTEM_ACCESS_REASONS = [
  'api-key-authentication',
  'audit-write',
  'billing-provider',
  'device-command-routing',
  'device-ingest',
  'device-status',
  'notification-delivery',
  'sso-bootstrap',
  'system-job',
  'test-fixture',
] as const;

export type SystemAccessReason = (typeof SYSTEM_ACCESS_REASONS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const verifiedSystemDatabases = new WeakSet<object>();

/** Runs `fn` with tenant isolation active (RLS sees only `tenantId`'s rows). */
export function withTenant<T>(db: Database, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) return Promise.reject(new Error('Invalid tenant context'));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** Runs a reviewed system path only on a database identity allowed to bypass RLS. */
export function withSystem<T>(
  db: Database,
  reason: SystemAccessReason,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (!verifiedSystemDatabases.has(db as object)) {
      const rows = (await tx.execute(sql`
        select rolbypassrls as "bypassRls", rolsuper as "superuser"
        from pg_roles
        where rolname = current_user
      `)) as unknown as Array<{ bypassRls: boolean; superuser: boolean }>;
      if (!rows[0]?.bypassRls && !rows[0]?.superuser) {
        throw new Error('System database identity is not permitted to bypass row-level security');
      }
      verifiedSystemDatabases.add(db as object);
    }
    await tx.execute(sql`select set_config('application_name', ${`trackflow:${reason}`}, true)`);
    return fn(tx);
  });
}
