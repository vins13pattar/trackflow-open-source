import { createDb } from '@trackflow/db';
import { env } from './env.js';

export const db = createDb(env.databaseUrl);
