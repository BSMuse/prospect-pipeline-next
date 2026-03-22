# ProspectLayer

**Automated lead pipeline for commercial brokers.** Discovers local businesses via Google Places, enriches them with email contacts, and exports campaign-ready spreadsheets — all from a single dark-themed admin dashboard.

Built with Next.js 14 (App Router), PostgreSQL, and TypeScript. Currently Phase 1 (admin operations), with architecture ready for Phase 2 (multi-tenant SaaS).

---

## How It Works

ProspectLayer runs a three-stage pipeline:

1. **Discover** — Queries the Google Places API across multiple geographic zones for a given business category (e.g. "dental", "legal", "HVAC"). De-duplicates by Place ID to avoid counting the same business twice.

2. **Upsert** — New businesses are inserted into PostgreSQL; existing ones are updated with fresh data (phone, website, rating). Every record is timestamped for freshness tracking.

3. **Enrich** — For each business with a website, attempts email lookup via Hunter.io first (with confidence scoring), then falls back to web scraping with Cheerio. Emails are aggressively validated — placeholders, no-reply addresses, and malformed strings are all filtered out.

The dashboard shows live progress logs, run statistics, and a full history of past runs. Results can be exported as multi-sheet Excel workbooks or CSV files, ready for outreach campaigns.

---

## Features

- **18 built-in category groups** — dental, legal, accounting, HVAC, landscaping, and more, each with multiple search keywords for thorough coverage
- **Multi-zone geographic sweep** — queries 5 overlapping quadrants to work around the 20-result-per-query API limit
- **Dual enrichment strategy** — Hunter.io for high-confidence verified emails, Cheerio scraping as fallback
- **Smart email validation** — rejects placeholders, no-reply addresses, image references, CSS artifacts, and malformed strings
- **Real-time pipeline monitoring** — live log output with 3-second polling
- **Rich Excel exports** — 4 sheets: full prospect list (color-coded by verification), summary stats, BCC-ready email list, and CRM campaign export
- **Filterable business browser** — search by category, city, or email availability with pagination
- **CLI mode** — run the pipeline from the command line without the web UI

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.3 |
| Database | PostgreSQL |
| Discovery | Google Places API (v1) |
| Email Enrichment | Hunter.io API |
| Web Scraping | Cheerio |
| Excel Export | ExcelJS |
| Logging | Winston |
| HTTP Client | Axios |
| UI | React 18, custom CSS (dark theme, no UI library) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- API keys for [Google Places](https://console.cloud.google.com) and [Hunter.io](https://hunter.io/api)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/prospect_pipeline
GOOGLE_PLACES_API_KEY=your_google_places_key
HUNTER_API_KEY=your_hunter_key
PIPELINE_DELAY_MS=500
ADMIN_SECRET=change_this_to_a_secret_passphrase
```

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) — [enable here](https://console.cloud.google.com) |
| `HUNTER_API_KEY` | Hunter.io — free tier gives 25 lookups/month, Starter ($49/mo) gives 500 |
| `PIPELINE_DELAY_MS` | Delay between API calls in ms (rate-limiting). Default `500` |
| `ADMIN_SECRET` | Reserved for Phase 2 auth |

### 3. Create the database

```bash
npm run db:migrate
```

This creates three tables: `businesses`, `contacts`, and `pipeline_runs` with appropriate indexes.

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

### Dashboard (`/`)

1. Select a **category** from the dropdown (or type a custom one)
2. Enter a **city** (e.g. `Edmonton, AB`)
3. Click **Run Pipeline**
4. Watch live logs as businesses are discovered, saved, and enriched
5. Export results as **Excel** or **CSV** when the run completes

### Business Browser (`/businesses`)

- Filter by category, city, or "has email only"
- Paginated table with 50 results per page
- Click the arrow icon to open any business website
- Export filtered results

### CLI

Run the pipeline directly without the web UI:

```bash
npm run pipeline:run -- "dentist" "Edmonton, AB"
```

### Data Cleanup

Re-validate and clean all existing emails in the database:

```bash
npm run db:clean-emails
```

---

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/pipeline` | Start a pipeline run (`{ category, city }`) |
| `GET` | `/api/pipeline` | Poll current run state (status, logs, stats) |
| `GET` | `/api/businesses` | List businesses — supports `category`, `city`, `hasEmail`, `page`, `limit` |
| `GET` | `/api/export` | Download results — supports `format=xlsx\|csv` and the same filters |
| `GET` | `/api/runs` | Last 20 pipeline runs with status and stats |
| `GET` | `/api/categories` | Available category groups and their keywords |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Dashboard — pipeline control, stats, live logs
│   ├── businesses/page.tsx         # Filterable business browser with pagination
│   ├── layout.tsx                  # Root layout (Syne + DM Mono fonts)
│   ├── globals.css                 # Dark theme (lime accent, custom scrollbars)
│   └── api/
│       ├── pipeline/route.ts       # POST to start, GET to poll
│       ├── businesses/route.ts     # Paginated business listing
│       ├── export/route.ts         # Excel/CSV generation
│       ├── runs/route.ts           # Run history
│       └── categories/route.ts     # Category group definitions
├── lib/
│   ├── db/
│   │   ├── client.ts               # PostgreSQL connection pool (singleton)
│   │   └── migrate.ts              # Schema creation script
│   └── pipeline/
│       ├── runner.ts               # Main orchestration (discover → upsert → enrich)
│       ├── places.ts               # Google Places multi-zone discovery
│       ├── enrichment.ts           # Hunter.io + Cheerio email lookup
│       └── cleanEmail.ts           # Email validation and normalization
└── scripts/
    └── cleanExistingEmails.ts      # Bulk email cleanup utility
```

---

## Database Schema

**businesses** — Discovered businesses with Google Places metadata

| Column | Type | Notes |
|--------|------|-------|
| `place_id` | `TEXT UNIQUE` | Google Places identifier |
| `name`, `category`, `city` | `TEXT` | Core fields |
| `address`, `phone`, `website` | `TEXT` | Contact info |
| `google_rating` | `NUMERIC(2,1)` | Star rating from Google |
| `status` | `TEXT` | `active` / `inactive` |

**contacts** — Enriched email contacts linked to businesses

| Column | Type | Notes |
|--------|------|-------|
| `business_id` | `FK → businesses` | Cascading delete |
| `email` | `TEXT` | Validated email address |
| `confidence_score` | `INTEGER` | 0–100 from Hunter.io |
| `source` | `TEXT` | `hunter` or `scraped` |
| `verified` | `BOOLEAN` | `true` if confidence >= 70% |

**pipeline_runs** — Execution history and stats

| Column | Type | Notes |
|--------|------|-------|
| `category`, `city` | `TEXT` | Run parameters |
| `businesses_found`, `businesses_new`, `contacts_found` | `INTEGER` | Run statistics |
| `status` | `TEXT` | `running` / `complete` / `failed` |
| `started_at`, `completed_at` | `TIMESTAMPTZ` | Duration tracking |

---

## Category Groups

ProspectLayer ships with 18 pre-configured category groups, each containing multiple search keywords for comprehensive coverage:

`dental` · `physiotherapy` · `optometry` · `chiropractic` · `legal` · `accounting` · `real-estate` · `veterinary` · `massage` · `mental-health` · `pharmacy` · `financial-planning` · `insurance` · `home-services` · `auto-repair` · `landscaping` · `cleaning` · `digital-marketing`

You can also enter any custom keyword — if it doesn't match a group, it's used as a direct search term.

---

## Excel Export Details

Exported workbooks include four sheets:

| Sheet | Contents |
|-------|----------|
| **Prospects** | Full data table with auto-filter and frozen header. Rows color-coded: green = Hunter-verified, yellow = scraped only, gray text = no email |
| **Summary** | Run statistics and top 5 businesses by Google rating |
| **Email List** | Semicolon-separated email list, ready for BCC |
| **Campaign Export** | Name, email, phone, website — formatted for CRM import |

---

## Deployment

### Railway (recommended)

1. Push to GitHub
2. Create a new Railway project → Deploy from GitHub
3. Add the **PostgreSQL** plugin
4. Set environment variables in the Railway dashboard
5. Deploy — Railway auto-detects Next.js

Estimated cost: ~$10–15/month.

### Monthly Auto-Refresh

Set up a cron job or GitHub Action to trigger the pipeline on a schedule:

```bash
curl -X POST https://your-app.railway.app/api/pipeline \
  -H "Content-Type: application/json" \
  -d '{"category":"dental","city":"Edmonton, AB"}'
```

---

## Roadmap (Phase 2)

- [ ] NextAuth user login for client-facing access
- [ ] Per-user saved searches and alerts
- [ ] Alberta Corporate Registry monitoring for new business registrations
- [ ] LinkedIn decision-maker enrichment
- [ ] CRM integration (Outlook contacts, Salesforce)
- [ ] Branded client portal
- [ ] Multi-city, multi-tenant support

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run db:migrate` | Create/update database schema |
| `npm run pipeline:run` | Run pipeline from CLI |
| `npm run db:clean-emails` | Re-validate all stored emails |
| `npm run clean` | Delete `.next` build cache |
