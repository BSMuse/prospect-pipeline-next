import axios from 'axios';
import * as cheerio from 'cheerio';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function extractDomain(website: string): string | null {
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function hunterLookup(
  domain: string
): Promise<{ email: string; confidence: number }[]> {
  if (!process.env.HUNTER_API_KEY || process.env.HUNTER_API_KEY === 'disabled') {
    return [];
  }
  try {
    const res = await axios.get('https://api.hunter.io/v2/domain-search', {
      params: { domain, api_key: process.env.HUNTER_API_KEY!, limit: 5 },
    });
    return (res.data?.data?.emails || []).map((e: any) => ({
      email: e.value,
      confidence: e.confidence || 0,
    }));
  } catch (err: any) {
    if (err.response?.status === 429) await sleep(60000);
    return [];
  }
}

export async function scrapeEmails(website: string): Promise<string[]> {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const res = await axios.get(url, {
      timeout: 8000,
      maxContentLength: 2 * 1024 * 1024, // 2MB cap
      maxBodyLength: 2 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectBot/1.0)' },
    });
    const $ = cheerio.load(res.data);
    const emails = new Set<string>();

    $('a[href^="mailto:"]').each((_, el) => {
      const email = ($(el).attr('href') || '')
        .replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (email.includes('@')) emails.add(email);
    });

    const matches = $('body').text().match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
    for (const m of matches) {
      const clean = m.toLowerCase();
      if (!clean.includes('example') && !clean.includes('sentry') && !clean.includes('wixpress')) {
        emails.add(clean);
      }
    }
    return Array.from(emails).slice(0, 3);
  } catch {
    return [];
  }
}
