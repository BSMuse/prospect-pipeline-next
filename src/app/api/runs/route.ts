import { NextResponse } from 'next/server';
import { pool } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await pool.query(`
    SELECT id, category, city, status,
           businesses_found, businesses_new, contacts_found, errors,
           started_at, completed_at
    FROM pipeline_runs
    ORDER BY started_at DESC
    LIMIT 20
  `);
  return NextResponse.json(rows);
}
