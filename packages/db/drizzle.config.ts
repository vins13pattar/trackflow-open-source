import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations need owner privileges, so prefer the admin URL.
    url:
      process.env.ADMIN_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://trackflow:trackflow@localhost:5432/trackflow',
  },
});
