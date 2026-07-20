import { createDb } from '../src/index.js';
import { applyRls, ensureAppRole } from '../src/rls.js';

// Runs as the owner/superuser: provisions the non-superuser runtime role and
// applies RLS policies. The app then connects as the runtime role.
const adminUrl =
  process.env.ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://trackflow:trackflow@localhost:5432/trackflow';
const appRole = process.env.APP_DB_ROLE ?? 'trackflow_app';
const appPassword = process.env.APP_DB_PASSWORD ?? 'trackflow_app';

const db = createDb(adminUrl);
await ensureAppRole(db, appRole, appPassword);
await applyRls(db);
console.log(`[db] runtime role '${appRole}' ensured and RLS policies applied`);
process.exit(0);
