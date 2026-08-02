import { createDb } from '@trackflow/db';

// Jobs are reviewed cross-tenant processes. They use the dedicated BYPASSRLS
// identity; the API's tenant role is deliberately unable to self-promote.
const systemDatabaseUrl = process.env.SYSTEM_DATABASE_URL;
if (process.env.NODE_ENV === 'production' && !systemDatabaseUrl) {
  throw new Error('SYSTEM_DATABASE_URL is required for production jobs');
}
export const db = createDb(
  systemDatabaseUrl ?? 'postgres://trackflow_system:trackflow_system@localhost:5432/trackflow',
);
