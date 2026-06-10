import { Pool } from 'pg';

// Single shared connection pool for the entire app.
// pg.Pool handles connection reuse and limits automatically.
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,               // max concurrent connections
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Verify DB connectivity on startup
export async function connectDB(): Promise<void> {
  const client = await db.connect();
  client.release();
  console.log('✅ Database connected');
}
