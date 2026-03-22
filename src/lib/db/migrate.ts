import * as dotenv from 'dotenv';
dotenv.config();

import { pool } from './client';

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id              SERIAL PRIMARY KEY,
        place_id        TEXT UNIQUE NOT NULL,
        name            TEXT NOT NULL,
        category        TEXT NOT NULL,
        address         TEXT,
        city            TEXT NOT NULL,
        phone           TEXT,
        website         TEXT,
        google_rating   NUMERIC(2,1),
        status          TEXT NOT NULL DEFAULT 'active',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id               SERIAL PRIMARY KEY,
        business_id      INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        email            TEXT NOT NULL,
        confidence_score INTEGER,
        source           TEXT NOT NULL,
        verified         BOOLEAN NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(business_id, email)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id                  SERIAL PRIMARY KEY,
        category            TEXT NOT NULL,
        city                TEXT NOT NULL,
        started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at        TIMESTAMPTZ,
        businesses_found    INTEGER DEFAULT 0,
        businesses_new      INTEGER DEFAULT 0,
        businesses_updated  INTEGER DEFAULT 0,
        contacts_found      INTEGER DEFAULT 0,
        errors              INTEGER DEFAULT 0,
        log                 TEXT DEFAULT '',
        status              TEXT NOT NULL DEFAULT 'running'
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_businesses_category_city ON businesses(category, city);
      CREATE INDEX IF NOT EXISTS idx_contacts_business_id ON contacts(business_id);
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
