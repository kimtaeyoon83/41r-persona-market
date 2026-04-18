import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import dotenv from 'dotenv';
import * as schema from './schema.js';

// Ensure .env is loaded before DB connection (ESM imports run before index.ts dotenv.config)
dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. Set it in .env file.');
}

// Pool sizing for 300-tester concurrent events. Each submit-report
// request issues ~5 queries (tester lookup, test lookup, dup check,
// report insert, settlement insert, budget update); peak ~30 concurrent
// requests → pool of 30 with 10 min keeps cold-start latency low.
// Override via DB_POOL_MAX / DB_POOL_MIN env if Railway resource tier
// changes.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 30),
  min: Number(process.env.DB_POOL_MIN ?? 2),
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECT_MS ?? 5_000),
});

// Surface pool errors so Railway logs capture connection issues
// instead of just the request that caught them.
pool.on('error', (err) => {
  console.error('[db.pool] unexpected error on idle client:', err);
});

export const db = drizzle(pool, { schema });
export { schema, pool };
