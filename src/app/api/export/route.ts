import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/client';
import ExcelJS from 'exceljs';
import { cleanEmail } from '@/lib/pipeline/cleanEmail';

function stripUtm(url: string): string {
  try {
    const u = new URL(url);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch { return url; }
}

function formatDate(val: any): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toISOString().split('T')[0];
}

const COLUMNS = [
  { header: 'Business Name', key: 'Business Name', width: 35 },
  { header: 'Category', key: 'Category', width: 15 },
  { header: 'Address', key: 'Address', width: 30 },
  { header: 'City', key: 'City', width: 15 },
  { header: 'Phone', key: 'Phone', width: 15 },
  { header: 'Website', key: 'Website', width: 30 },
  { header: 'Email', key: 'Email', width: 28 },
  { header: 'Confidence', key: 'Confidence', width: 12 },
  { header: 'Source', key: 'Source', width: 10 },
  { header: 'Verified', key: 'Verified', width: 10 },
  { header: 'Google Rating', key: 'Google Rating', width: 14 },
  { header: 'Last Updated', key: 'Last Updated', width: 14 },
];

async function queryRows(category: string, city: string) {
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

  const { rows } = await pool.query(
    `SELECT
       b.name          AS "Business Name",
       b.category      AS "Category",
       b.address       AS "Address",
       b.city          AS "City",
       b.phone         AS "Phone",
       b.website       AS "Website",
       c.email         AS "Email",
       c.confidence_score AS "Confidence",
       c.source        AS "Source",
       c.verified      AS "Verified",
       b.google_rating AS "Google Rating",
       b.last_seen_at  AS "Last Updated"
     FROM businesses b
     LEFT JOIN contacts c ON c.business_id = b.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY b.name ASC`,
    params
  );

  // Clean values
  for (const row of rows) {
    if (row['Website']) row['Website'] = stripUtm(String(row['Website']));
    row['Last Updated'] = formatDate(row['Last Updated']);
  }

  return rows;
}

function buildCsv(rows: any[]): string {
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ),
  ];
  return csvLines.join('\n');
}

async function buildXlsx(rows: any[], category: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: Prospects ──────────────────────────────────────────────
  const ws = wb.addWorksheet('Prospects');
  ws.columns = COLUMNS;

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.height = 20;
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D0D0D' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
    cell.alignment = { vertical: 'middle' };
  });

  // Freeze top row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Add data rows
  for (const row of rows) {
    const dataRow = ws.addRow(row);
    const email = row['Email'];
    const verified = row['Verified'];
    const source = row['Source'];

    // Conditional row formatting
    if (verified === true && source === 'hunter') {
      dataRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
      });
    } else if (verified === false && source === 'scraped' && email) {
      dataRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };
      });
    } else if (!email) {
      dataRow.eachCell(cell => {
        cell.font = { color: { argb: 'FF999999' } };
      });
    }

    // Website hyperlink
    const websiteVal = row['Website'];
    if (websiteVal) {
      const websiteCell = dataRow.getCell('Website');
      websiteCell.value = { text: websiteVal, hyperlink: websiteVal };
      websiteCell.font = { ...websiteCell.font, color: { argb: 'FF4A86C8' }, underline: true };
    }
  }

  // Auto-filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: rows.length + 1, column: COLUMNS.length },
  };

  // ── Sheet 2: Summary ───────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary');
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 40;

  const totalBusinesses = new Set(rows.map(r => r['Business Name'])).size;
  const withVerifiedEmail = new Set(
    rows.filter(r => r['Verified'] === true && r['Source'] === 'hunter' && (r['Confidence'] ?? 0) >= 70)
      .map(r => r['Business Name'])
  ).size;
  const withScrapedOnly = new Set(
    rows.filter(r => r['Email'] && r['Source'] === 'scraped')
      .map(r => r['Business Name'])
  ).size;
  const withAnyEmail = new Set(rows.filter(r => r['Email']).map(r => r['Business Name'])).size;
  const noEmail = totalBusinesses - withAnyEmail;

  // Top 5 by Google rating
  const ratedMap = new Map<string, number>();
  for (const r of rows) {
    if (r['Google Rating'] != null && !ratedMap.has(r['Business Name'])) {
      ratedMap.set(r['Business Name'], r['Google Rating']);
    }
  }
  const top5 = [...ratedMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, rating]) => `${name} (${rating})`)
    .join(', ');

  const summaryData: [string, string | number][] = [
    ['Report', `Prospects — ${category || 'All Categories'}`],
    ['Date Generated', new Date().toISOString().split('T')[0]],
    ['', ''],
    ['Total Businesses', totalBusinesses],
    ['Businesses with Verified Email (Hunter)', withVerifiedEmail],
    ['Businesses with Scraped Email Only', withScrapedOnly],
    ['Businesses with No Email', noEmail],
    ['', ''],
    ['Top 5 Google Rated', top5 || 'N/A'],
  ];

  for (const [label, value] of summaryData) {
    const row = summary.addRow([label, value]);
    if (label) {
      row.getCell(1).font = { bold: true, size: 11 };
      row.getCell(2).font = { size: 11 };
    }
  }

  // Title row styling
  const titleRow = summary.getRow(1);
  titleRow.getCell(1).font = { bold: true, size: 13 };
  titleRow.getCell(2).font = { bold: true, size: 13 };

  // ── Sheet 3: Email List ─────────────────────────────────────────────
  // Re-apply cleanEmail at export time — don't trust the DB is already clean
  const cleanedEmailRows: typeof rows = [];
  const seenEmails = new Set<string>();
  for (const r of rows) {
    if (!r['Email']) continue;
    const cleaned = cleanEmail(r['Email']);
    if (!cleaned) continue;
    if (seenEmails.has(cleaned)) continue;
    seenEmails.add(cleaned);
    cleanedEmailRows.push({ ...r, 'Email': cleaned });
  }

  const emailList = wb.addWorksheet('Email List');
  emailList.getColumn(1).width = 35;
  emailList.getColumn(2).width = 80;

  // Row 1: title
  emailList.getCell('A1').value = 'Quick Email List';
  emailList.getCell('A1').font = { bold: true, size: 13 };

  // Row 2: description
  emailList.getCell('A2').value = 'Copy cell B4 and paste directly into the BCC or To field of your email client. All emails are separated by semicolons.';
  emailList.getCell('A2').font = { size: 11, color: { argb: 'FF666666' } };

  // Row 3: blank spacer

  // Row 4: count in A4, BCC string in B4
  emailList.getCell('A4').value = `${cleanedEmailRows.length} emails`;
  emailList.getCell('A4').font = { bold: true, size: 11 };
  emailList.getCell('B4').value = cleanedEmailRows.map(r => r['Email']).join('; ');
  emailList.getCell('B4').font = { bold: true };

  // Row 5: blank spacer

  // Row 6: headers
  emailList.getCell('A6').value = 'Business Name';
  emailList.getCell('B6').value = 'Email';
  emailList.getCell('A6').font = { bold: true };
  emailList.getCell('B6').font = { bold: true };

  // Row 7+: cleaned/deduped data — use explicit row numbers to avoid overwriting header cells
  for (let i = 0; i < cleanedEmailRows.length; i++) {
    const row = emailList.getRow(7 + i);
    row.getCell(1).value = cleanedEmailRows[i]['Business Name'];
    row.getCell(2).value = cleanedEmailRows[i]['Email'];
  }

  // ── Sheet 4: Campaign Export ────────────────────────────────────────
  const campaign = wb.addWorksheet('Campaign Export');
  campaign.columns = [
    { header: 'Business Name', key: 'name', width: 35 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Website', key: 'website', width: 30 },
  ];
  // Re-filter with cleanEmail — allow duplicates here (one row per email per business)
  for (const r of rows) {
    if (!r['Email']) continue;
    const cleaned = cleanEmail(r['Email']);
    if (!cleaned) continue;
    campaign.addRow({
      name: r['Business Name'],
      email: cleaned,
      phone: r['Phone'] || '',
      website: r['Website'] || '',
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') || '';
  const city = searchParams.get('city') || '';
  const format = searchParams.get('format') || 'csv';

  const rows = await queryRows(category, city);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No results' }, { status: 404 });
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const slug = (category || 'all').replace(/\s+/g, '_');

  if (format === 'xlsx') {
    const buffer = await buildXlsx(rows, category);
    return new Response(buffer as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="prospects_${slug}_${timestamp}.xlsx"`,
      },
    });
  }

  const csv = buildCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="prospects_${slug}_${timestamp}.csv"`,
    },
  });
}
