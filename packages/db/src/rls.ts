/**
 * Row-Level Security: tenant isolation enforced by Postgres, not just app code.
 *
 * Each tenant-scoped table gets a policy keyed on the `app.tenant_id` session
 * GUC. Authenticated requests run their queries inside `withTenant`, which sets
 * that GUC transaction-locally — so even a buggy query physically cannot read
 * another tenant's rows. Trusted system paths (the device-ingest endpoint, key
 * lookups) use `withSystem`, which sets `app.bypass_rls`.
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
           OR current_setting('app.bypass_rls', true) = 'on'
         )
         WITH CHECK (
           tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
           OR current_setting('app.bypass_rls', true) = 'on'
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
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
         CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS;
       END IF;
     END $$;`,
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

/** Idempotently provisions the runtime role and its grants. Run as the owner. */
export async function ensureAppRole(db: Database, role: string, password: string): Promise<void> {
  for (const stmt of appRoleStatements(role, password)) {
    await db.execute(sql.raw(stmt));
  }
}

/** Runs `fn` with tenant isolation active (RLS sees only `tenantId`'s rows). */
export function withTenant<T>(db: Database, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** Runs `fn` as a trusted system path that bypasses RLS (ingest, key lookups). */
export function withSystem<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
