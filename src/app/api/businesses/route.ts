import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') || '';
  const city = searchParams.get('city') || '';
  const hasEmail = searchParams.get('hasEmail') === 'true';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = (page - 1) * limit;

  const conditions: string[] = ['1=1'];
  const params: any[] = [];

  if (category) {
    params.push(`%${category}%`);
    conditions.push(`b.category ILIKE $${params.length}`);
  }
  if (city) {
    params.push(`%${city}%`);
    conditions.push(`b.city ILIKE $${params.length}`);
  }
  if (hasEmail) {
    conditions.push(`c.id IS NOT NULL`);
  }

  const where = conditions.join(' AND ');

  const { rows } = await pool.query(
    `SELECT
       b.id, b.name, b.category, b.address, b.city,
       b.phone, b.website, b.google_rating, b.status, b.last_seen_at,
       c.email, c.confidence_score, c.source, c.verified
     FROM businesses b
     LEFT JOIN contacts c ON c.business_id = b.id
     WHERE ${where}
     ORDER BY b.name ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM businesses b
     LEFT JOIN contacts c ON c.business_id = b.id
     WHERE ${where}`,
    params
  );

  return NextResponse.json({
    data: rows,
    total: parseInt(countRows[0].count),
    page,
    limit,
  });
}
