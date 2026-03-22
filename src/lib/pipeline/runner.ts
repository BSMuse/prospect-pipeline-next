import 'dotenv/config';
import { pool } from '../db/client';
import { discoverBusinesses } from './places';
import { hunterLookup, scrapeEmails, extractDomain } from './enrichment';
import { cleanEmail } from './cleanEmail';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Global state for polling — one run at a time for Phase 1
export type RunState = {
  runId: number | null;
  status: 'idle' | 'running' | 'complete' | 'failed';
  log: string[];
  stats: {
    businessesFound: number;
    businessesNew: number;
    contactsFound: number;
  };
};

export const runState: RunState = {
  runId: null,
  status: 'idle',
  log: [],
  stats: { businessesFound: 0, businessesNew: 0, contactsFound: 0 },
};

function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  runState.log.push(line);
  console.log(line);
}

export async function runPipeline(category: string, city: string): Promise<void> {
  if (runState.status === 'running') throw new Error('Pipeline already running');

  runState.status = 'running';
  runState.log = [];
  runState.stats = { businessesFound: 0, businessesNew: 0, contactsFound: 0 };

  const { rows } = await pool.query(
    `INSERT INTO pipeline_runs (category, city) VALUES ($1, $2) RETURNING id`,
    [category, city]
  );
  runState.runId = rows[0].id;

  try {
    // ── Step 1: Discover ────────────────────────────────────────────────────
    log(`Starting discovery: ${category} in ${city}`);
    const businesses = await discoverBusinesses(category, log);
    runState.stats.businessesFound = businesses.length;
    log(`Found ${businesses.length} businesses`);

    // ── Step 2: Upsert ──────────────────────────────────────────────────────
    log('Saving to database...');
    let newCount = 0;
    for (const biz of businesses) {
      const existing = await pool.query(
        'SELECT id FROM businesses WHERE place_id = $1', [biz.place_id]
      );
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO businesses (place_id, name, category, address, city, phone, website, google_rating)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [biz.place_id, biz.name, category, biz.address, city, biz.phone, biz.website, biz.rating]
        );
        newCount++;
      } else {
        await pool.query(
          `UPDATE businesses SET phone=COALESCE($1,phone), website=COALESCE($2,website),
           google_rating=COALESCE($3,google_rating), last_seen_at=NOW(), status='active'
           WHERE place_id=$4`,
          [biz.phone, biz.website, biz.rating, biz.place_id]
        );
      }
    }
    runState.stats.businessesNew = newCount;
    log(`${newCount} new businesses added`);

    // ── Step 3: Enrich ──────────────────────────────────────────────────────
    const { rows: toEnrich } = await pool.query(`
      SELECT b.id, b.website FROM businesses b
      LEFT JOIN contacts c ON c.business_id = b.id
      WHERE b.website IS NOT NULL AND b.status = 'active' AND c.id IS NULL
    `);

    log(`Enriching ${toEnrich.length} businesses for emails...`);
    let contactsFound = 0;
    const delay = parseInt(process.env.PIPELINE_DELAY_MS || '500');

    for (const [i, biz] of toEnrich.entries()) {
      if (i % 10 === 0) log(`Enriching ${i + 1}/${toEnrich.length}...`);
      await sleep(delay);

      const domain = extractDomain(biz.website);
      if (!domain) continue;

      const hunterResults = await hunterLookup(domain);
      let emails: { email: string; confidence?: number; source: string; verified: boolean }[] = [];

      if (hunterResults.length > 0) {
        emails = hunterResults.map(h => ({
          email: h.email,
          confidence: h.confidence,
          source: 'hunter',
          verified: h.confidence >= 70,
        }));
      } else {
        const scraped = await scrapeEmails(biz.website);
        emails = scraped.map(email => ({ email, source: 'scraped', verified: false }));
      }

      for (const contact of emails) {
        const cleaned = cleanEmail(contact.email);
        if (!cleaned) continue;
        try {
          await pool.query(
            `INSERT INTO contacts (business_id, email, confidence_score, source, verified)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (business_id, email) DO NOTHING`,
            [biz.id, cleaned, contact.confidence || null, contact.source, contact.verified]
          );
          contactsFound++;
        } catch { /* ignore */ }
      }
    }

    runState.stats.contactsFound = contactsFound;
    log(`Enrichment complete: ${contactsFound} emails found`);

    // ── Finalize ────────────────────────────────────────────────────────────
    await pool.query(
      `UPDATE pipeline_runs SET completed_at=NOW(), status='complete',
       businesses_found=$1, businesses_new=$2, contacts_found=$3
       WHERE id=$4`,
      [businesses.length, newCount, contactsFound, runState.runId]
    );

    runState.status = 'complete';
    log('✅ Pipeline complete');
  } catch (err: any) {
    runState.status = 'failed';
    log(`❌ Pipeline failed: ${err.message}`);
    await pool.query(
      `UPDATE pipeline_runs SET status='failed', completed_at=NOW() WHERE id=$1`,
      [runState.runId]
    );
  }
}

// CLI entry point
if (require.main === module) {
  const category = process.argv[2] || 'dentist';
  const city = process.argv[3] || 'Edmonton, AB';
  runPipeline(category, city)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
