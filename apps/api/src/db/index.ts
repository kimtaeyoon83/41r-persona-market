import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import dotenv from 'dotenv';
import * as schema from './schema.js';

// Ensure .env is loaded before DB connection (ESM imports run before index.ts dotenv.config)
dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. Set it in .env file.');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export { schema };
