import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schema from './schema.js';

// Pool sizing for 300-tester concurrent events. Each submit-report
// request issues ~5 queries (tester lookup, test lookup, dup check,
// report insert, settlement insert, budget update); peak ~30 concurrent
// requests → pool of 30 with 10 min keeps cold-start latency low.
// Override via DB_POOL_MAX / DB_POOL_MIN env if Railway resource tier
// changes.
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  min: env.DB_POOL_MIN,
  idleTimeoutMillis: env.DB_POOL_IDLE_MS,
  connectionTimeoutMillis: env.DB_POOL_CONNECT_MS,
});

// Surface pool errors so Railway logs capture connection issues
// instead of just the request that caught them.
pool.on('error', (err) => {
  console.error('[db.pool] unexpected error on idle client:', err);
});

export const db = drizzle(pool, { schema });
export { schema, pool };
