import { createDb } from '@trackflow/db';
import { env } from './env.js';

export const db = createDb(env.databaseUrl);
export const systemDb = createDb(env.systemDatabaseUrl);
