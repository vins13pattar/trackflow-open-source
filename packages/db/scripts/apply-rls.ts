import { createDb } from '../src/index.js';
import { applyRls, ensureAppRole, ensureSystemRole } from '../src/rls.js';

// Runs as the owner/superuser: provisions the non-superuser runtime role and
// applies RLS policies. The app then connects as the runtime role.
const adminUrl =
  process.env.ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://trackflow:trackflow@localhost:5432/trackflow';
const appRole = process.env.APP_DB_ROLE ?? 'trackflow_app';
const appPassword = process.env.APP_DB_PASSWORD ?? 'trackflow_app';
const systemRole = process.env.SYSTEM_DB_ROLE ?? 'trackflow_system';
const systemPassword = process.env.SYSTEM_DB_PASSWORD ?? 'trackflow_system';

const db = createDb(adminUrl);
await ensureAppRole(db, appRole, appPassword);
await ensureSystemRole(db, systemRole, systemPassword);
await applyRls(db);
console.log(`[db] tenant role '${appRole}', system role '${systemRole}', and RLS policies ensured`);
process.exit(0);
