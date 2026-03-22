import 'dotenv/config';
import { pool } from '../lib/db/client';
import { cleanEmail } from '../lib/pipeline/cleanEmail';

async function main() {
  const { rows } = await pool.query('SELECT id, email FROM contacts');
  console.log(`Processing ${rows.length} contacts...`);

  let kept = 0;
  let updated = 0;
  let deleted = 0;

  for (const row of rows) {
    const cleaned = cleanEmail(row.email);

    if (!cleaned) {
      await pool.query('DELETE FROM contacts WHERE id = $1', [row.id]);
      console.log(`  DELETED: ${row.email}`);
      deleted++;
    } else if (cleaned !== row.email) {
      // Check if the cleaned email already exists for this business
      const { rows: existing } = await pool.query(
        'SELECT id FROM contacts WHERE business_id = (SELECT business_id FROM contacts WHERE id = $1) AND email = $2 AND id != $1',
        [row.id, cleaned]
      );
      if (existing.length > 0) {
        // Duplicate after cleaning — delete the dirty one
        await pool.query('DELETE FROM contacts WHERE id = $1', [row.id]);
        console.log(`  DELETED (dup): ${row.email} → ${cleaned} already exists`);
        deleted++;
      } else {
        await pool.query('UPDATE contacts SET email = $1 WHERE id = $2', [cleaned, row.id]);
        console.log(`  UPDATED: ${row.email} → ${cleaned}`);
        updated++;
      }
    } else {
      kept++;
    }
  }

  console.log(`\nDone: ${kept} kept, ${updated} updated, ${deleted} deleted`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
