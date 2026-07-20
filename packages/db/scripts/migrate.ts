import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Applies committed SQL migrations as the owner (CI-safe; non-interactive).
const url =
  process.env.ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://trackflow:trackflow@localhost:5432/trackflow';

const client = postgres(url, { max: 1 });
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

await migrate(drizzle(client), { migrationsFolder });
await client.end();
console.log('[db] migrations applied');
process.exit(0);
