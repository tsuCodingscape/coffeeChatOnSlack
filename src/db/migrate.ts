/**
 * Run with: npm run db:migrate
 *
 * Applies every migration in src/db/migrations/, in order, that hasn't
 * already been recorded in schema_migrations. Safe to re-run — already
 * applied migrations are skipped, and each migration's own SQL uses
 * IF NOT EXISTS / IF EXISTS throughout.
 *
 * To add a new migration, create the next-numbered file in
 * src/db/migrations/ (e.g. 007_my_change.ts) exporting `name` and an
 * `up(client)` function, and add it to the MIGRATIONS list below.
 */

import 'dotenv/config';
import type { PoolClient } from 'pg';
import { db } from './pool';

import * as m001 from './migrations/001_init';
import * as m002 from './migrations/002_add_priority';
import * as m003 from './migrations/003_add_nudges';
import * as m004 from './migrations/004_add_icebreaker_feedback';
import * as m005 from './migrations/005_add_exclusion_rules';
import * as m006 from './migrations/006_add_participant_contact_fields';

interface Migration {
  name: string;
  up: (client: PoolClient) => Promise<void>;
}

// Order matters — later migrations may depend on tables/columns
// created by earlier ones.
const MIGRATIONS: Migration[] = [m001, m002, m003, m004, m005, m006];

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM schema_migrations`
  );
  return new Set(rows.map((r) => r.name));
}

async function migrate(): Promise<void> {
  const client = await db.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    let ranCount = 0;

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) {
        console.log(`↷ Skipping already-applied migration: ${migration.name}`);
        continue;
      }

      console.log(`▶ Applying migration: ${migration.name}`);
      try {
        await client.query('BEGIN');
        await migration.up(client);
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ($1)`,
          [migration.name]
        );
        await client.query('COMMIT');
        console.log(`✅ Applied: ${migration.name}`);
        ranCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Migration failed: ${migration.name}`, err);
        throw err;
      }
    }

    console.log(
      ranCount === 0
        ? '✅ Database already up to date — nothing to apply'
        : `✅ Migration complete — ${ranCount} migration(s) applied`
    );
  } catch (err) {
    console.error('❌ Migration run failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

migrate();
