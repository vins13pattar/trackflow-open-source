import { createDb } from '@trackflow/db';

// Jobs are system processes: they connect as the app role and use withSystem()
// to bypass RLS for cross-tenant rollups.
export const db = createDb(
  process.env.DATABASE_URL ?? 'postgres://trackflow_app:trackflow_app@localhost:5432/trackflow',
);
