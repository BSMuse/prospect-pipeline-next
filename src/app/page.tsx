'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// === Types ===

type RunState = {
  runId: number | null;
  status: 'idle' | 'running' | 'complete' | 'failed';
  log: string[];
  stats: { businessesFound: number; businessesNew: number; contactsFound: number };
};

type Business = {
  id: number;
  name: string;
  category: string;
  address: string;
  city: string;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  email: string | null;
  confidence_score: number | null;
  source: string | null;
  verified: boolean | null;
};

type RunRecord = {
  id: number;
  category: string;
  city: string;
  status: string;
  businesses_found: number;
  businesses_new: number;
  contacts_found: number;
  started_at: string;
  completed_at: string | null;
};

// === Helpers ===

const ZONE_NAMES = ['Core Edmonton', 'NW Edmonton', 'NE Edmonton', 'SW Edmonton', 'SE Edmonton'];

function formatCat(cat: string): string {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function stars(rating: number | null): string {
  if (!rating) return '';
  return '★'.repeat(Math.min(Math.round(rating), 5));
}

function estimateProgress(logs: string[]): number {
  let p = 0;
  for (const l of logs) {
    if (l.includes('Starting discovery')) p = Math.max(p, 5);
    const zm = l.match(/Zone (\d+)\/(\d+)/);
    if (zm) p = Math.max(p, 5 + parseInt(zm[1]) * 9);
    if ((l.includes('Found') || l.includes('identified')) && l.includes('businesses')) p = Math.max(p, 52);
    if (l.includes('Saving to database')) p = Math.max(p, 55);
    if (l.includes('new businesses added')) p = Math.max(p, 60);
    if (l.includes('Enriching') && l.includes('for emails')) p = Math.max(p, 62);
    const em = l.match(/Enriching (\d+)\/(\d+)/);
    if (em) p = Math.max(p, 62 + Math.round(33 * parseInt(em[1]) / parseInt(em[2])));
    if (l.includes('Enrichment complete')) p = Math.max(p, 97);
    if (l.includes('Pipeline complete') || l.includes('Pipeline failed')) p = 100;
  }
  return p;
}

function logClass(line: string): string {
  if (line.includes('✅') || line.includes('complete')) return 'tok';
  if (line.includes('❌') || line.includes('error')) return 'twarn';
  if (line.includes('Found') || line.includes('new businesses') || line.includes('emails found') || line.includes('identified')) return 'tcounter';
  return 'tdim';
}

function distributeCount(total: number, n: number): number[] {
  const w = Array.from({ length: n }, (_, i) => 0.7 + ((total * (i + 1) * 37) % 100) / 166);
  const s = w.reduce((a, b) => a + b, 0);
  const c = w.map(v => Math.round(total * v / s));
  c[0] += total - c.reduce((a, b) => a + b, 0);
  return c;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// === Component ===

export default function App() {
  // View
  const [view, setView] = useState('dashboard');

  // Data
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [totalProspects, setTotalProspects] = useState(0);
  const [totalEmails, setTotalEmails] = useState(0);

  // Prospects
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessTotal, setBusinessTotal] = useState(0);
  const [bizPage, setBizPage] = useState(1);
  const [catFilter, setCatFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [emailOnly, setEmailOnly] = useState(false);

  // Pipeline
  const [runState, setRunState] = useState<RunState>({
    runId: null, status: 'idle', log: [],
    stats: { businessesFound: 0, businessesNew: 0, contactsFound: 0 },
  });
  const [runCategory, setRunCategory] = useState('dental');
  const [runCity, setRunCity] = useState('Edmonton, AB');
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runPhase, setRunPhase] = useState<'setup' | 'running'>('setup');
  const [zoneStates, setZoneStates] = useState<string[]>(Array(5).fill('idle'));
  const [zoneCounts, setZoneCounts] = useState<string[]>(Array(5).fill('—'));
  const [progress, setProgress] = useState(0);

  // Email draft
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftBizName, setDraftBizName] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftDone, setDraftDone] = useState(false);

  // Listings toggle
  const [listingOpen, setListingOpen] = useState<Record<string, boolean>>({ manning: true, hat: true });

  // Modals
  const [listingModalOpen, setListingModalOpen] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // Refs
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxZoneRef = useRef(0);

  // --- Toast ---
  function toast(msg: string) {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3000);
  }

  // --- API ---

  async function fetchCategories() {
    try { setCategories(await (await fetch('/api/categories', { cache: 'no-store' })).json()); } catch {}
  }

  async function fetchRuns() {
    try {
      const data = await (await fetch('/api/runs', { cache: 'no-store' })).json();
      setRuns(data);
    } catch {}
  }

  async function fetchStats() {
    try {
      const [bR, eR] = await Promise.all([
        fetch('/api/businesses?limit=1', { cache: 'no-store' }),
        fetch('/api/businesses?hasEmail=true&limit=1', { cache: 'no-store' }),
      ]);
      const bD = await bR.json();
      const eD = await eR.json();
      setTotalProspects(bD.total || 0);
      setTotalEmails(eD.total || 0);
    } catch {}
  }

  async function fetchPipelineState() {
    try {
      const data: RunState = await (await fetch('/api/pipeline', { cache: 'no-store' })).json();
      setRunState(data);
      if (data.status === 'running') {
        setRunModalOpen(true);
        setRunPhase('running');
        startPolling();
      }
    } catch {}
  }

  const fetchBusinesses = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(bizPage), limit: '50',
      ...(catFilter && { category: catFilter }),
      ...(cityFilter && { city: cityFilter }),
      ...(emailOnly && { hasEmail: 'true' }),
    });
    try {
      const data = await (await fetch(`/api/businesses?${params}`, { cache: 'no-store' })).json();
      setBusinesses(data.data || []);
      setBusinessTotal(data.total || 0);
    } catch {}
  }, [bizPage, catFilter, cityFilter, emailOnly]);

  // --- Polling ---

  function startPolling() {
    // Clear any existing polling first
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    // Immediate first poll
    (async () => {
      try {
        const data: RunState = await (await fetch('/api/pipeline')).json();
        setRunState(data);
        parseLogsForZones(data.log);
        setProgress(estimateProgress(data.log));
      } catch {}
    })();
    // Then poll every 2s
    pollingRef.current = setInterval(async () => {
      try {
        const data: RunState = await (await fetch('/api/pipeline')).json();
        setRunState(data);
        parseLogsForZones(data.log);
        setProgress(estimateProgress(data.log));
        if (data.status !== 'running') {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          fetchRuns();
          fetchStats();
        }
      } catch {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
      }
    }, 2000);
  }

  function parseLogsForZones(logs: string[]) {
    let maxZone = 0;
    let discoveryDone = false;
    let totalBiz = 0;

    for (const line of logs) {
      const m = line.match(/Zone (\d+)\/(\d+)/);
      if (m) maxZone = Math.max(maxZone, parseInt(m[1]));
      if (line.includes('Found') && line.includes('businesses') && !line.includes('Zone')) {
        discoveryDone = true;
        const cm = line.match(/(\d+) businesses/);
        if (cm) totalBiz = parseInt(cm[1]);
      }
    }

    if (maxZone > maxZoneRef.current) {
      maxZoneRef.current = maxZone;
      setZoneStates(prev => {
        const next = [...prev];
        for (let i = 0; i < Math.min(maxZone - 1, 5); i++) next[i] = 'done';
        if (maxZone - 1 < 5) next[maxZone - 1] = 'scanning';
        return next;
      });
    }

    if (discoveryDone) {
      setZoneStates(Array(5).fill('done'));
      if (totalBiz > 0) setZoneCounts(distributeCount(totalBiz, 5).map(String));
    }
  }

  // --- Pipeline control ---

  async function startPipeline() {
    setRunPhase('running');
    setProgress(0);
    setZoneStates(Array(5).fill('idle'));
    setZoneCounts(Array(5).fill('—'));
    maxZoneRef.current = 0;

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: runCategory, city: runCity }),
      });
      if (res.ok) {
        startPolling();
      } else {
        const d = await res.json();
        toast(d.error || 'Failed to start pipeline');
        setRunPhase('setup');
      }
    } catch {
      toast('Failed to connect to server');
      setRunPhase('setup');
    }
  }

  function closeRunModal() {
    setRunModalOpen(false);
    setRunPhase('setup');
  }

  // --- Export ---

  function handleExport(format: 'xlsx' | 'csv', cat?: string, city?: string) {
    const params = new URLSearchParams({ format });
    if (cat || catFilter) params.set('category', cat || catFilter);
    if (city || cityFilter) params.set('city', city || cityFilter);
    window.location.href = `/api/export?${params}`;
    toast(`Downloading ${format.toUpperCase()}...`);
  }

  // --- Email draft ---

  function startDraft(name: string, email: string | null, city: string = 'Edmonton') {
    if (draftTimerRef.current) clearInterval(draftTimerRef.current);
    setView('prospects');
    setDraftOpen(true);
    setDraftDone(false);
    setDraftBizName(name);
    setDraftTo(email || '');
    setDraftSubject(`Retail Space Opportunity — ${city}`);
    setDraftBody('');

    const tpl = `Hi there,\n\nMy name is Devan Ramage — I'm the Head of Retail at Cushman & Wakefield Edmonton, and I specialize in connecting growing businesses with the right retail spaces across the city.\n\nI came across ${name} and noticed some signals that suggested you might be thinking about your space situation in the near future. Whether that's expansion, relocation, or just keeping your options open — I'd love to have a conversation.\n\nWe have a few spaces right now that I think could be a strong fit for a business like yours. Nothing pushy — I just like to get these conversations started early so you have options when the time is right.\n\nWould you be open to a quick 15-minute call this week? Happy to work around your schedule.\n\nDevan Ramage\nHead of Retail\nCushman & Wakefield Edmonton\n780-702-9479`;

    let i = 0;
    draftTimerRef.current = setInterval(() => {
      if (i >= tpl.length) {
        clearInterval(draftTimerRef.current!);
        draftTimerRef.current = null;
        setDraftDone(true);
        return;
      }
      const chunk = tpl.slice(i, i + 3);
      setDraftBody(prev => prev + chunk);
      i += 3;
    }, 20);
  }

  // --- Effects ---

  useEffect(() => {
    fetchCategories();
    fetchRuns();
    fetchStats();
    fetchPipelineState();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (draftTimerRef.current) clearInterval(draftTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view === 'prospects') fetchBusinesses();
  }, [view, fetchBusinesses]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [runState.log]);

  // --- Derived ---

  const lastRun = runs[0];
  const bizPages = Math.ceil(businessTotal / 50) || 1;
  const pipelineDone = runPhase === 'running' && (runState.status === 'complete' || runState.status === 'failed');


  // ==============================
  // RENDER
  // ==============================

  return (
    <>
      {/* ──── TOPBAR ──── */}
      <header className="topbar">
        <div className="logo-group">
          <div className="logo"><div className="logo-dot" />PROSPECTLAYER</div>
          <div className="logo-divider" />
          <div className="logo-org">CUSHMAN &amp; WAKEFIELD<br />EDMONTON</div>
        </div>
        <nav className="topbar-nav">
          {(['dashboard', 'prospects', 'listings', 'opportunities'] as const).map(v => (
            <button key={v} className={`nav-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
        <div className="user-area" onClick={() => setView('settings')} style={{ cursor: 'pointer' }} title="Settings">
          <div className="user-info">
            <div className="user-name">Devan Ramage</div>
            <div className="user-role">Head of Retail</div>
          </div>
          <div className={`avatar ${view === 'settings' ? 'avatar-active' : ''}`}>DR</div>
        </div>
      </header>

      {/* ──── SHELL ──── */}
      <div className="shell">

        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="nav-section-label">Overview</div>
          <button className={`side-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>
            <span className="side-icon">◈</span>Dashboard
          </button>
          <button className={`side-btn ${view === 'opportunities' ? 'active' : ''}`} onClick={() => setView('opportunities')}>
            <span className="side-icon">◍</span>Opportunities<span className="side-count">7</span>
          </button>
          <div className="nav-section-label">Prospecting</div>
          <button className={`side-btn ${view === 'prospects' ? 'active' : ''}`} onClick={() => setView('prospects')}>
            <span className="side-icon">◎</span>Prospects<span className="side-count">{totalProspects}</span>
          </button>
          <div className="nav-section-label">Listings</div>
          <button className={`side-btn ${view === 'listings' ? 'active' : ''}`} onClick={() => setView('listings')}>
            <span className="side-icon">▣</span>Active Listings<span className="side-count">3</span>
          </button>
          <button className="side-btn" onClick={() => setListingModalOpen(true)}>
            <span className="side-icon">+</span>Add Listing
          </button>
          <div className="nav-section-label" style={{ marginTop: 'auto' }}>Account</div>
          <button className={`side-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <span className="side-icon">⚙</span>Settings
          </button>
          <button className="run-btn-side" onClick={() => setRunModalOpen(true)}>▷ Run Pipeline</button>
        </aside>

        {/* ── Main ── */}
        <main className="main">

          {/* ────── DASHBOARD ────── */}
          {view === 'dashboard' && (
            <div className="view" key="dashboard">
              <div className="page-hd">
                <div>
                  <div className="page-title">{greeting()}, Devan.</div>
                  <div className="page-sub">
                    {lastRun
                      ? `Last pipeline: ${formatCat(lastRun.category)} · ${lastRun.city} — ${lastRun.status}`
                      : 'No pipeline runs yet — click Run Pipeline to get started.'}
                  </div>
                </div>
                <button className="btn btn-p" onClick={() => setRunModalOpen(true)}>▷ Run Pipeline</button>
              </div>

              {/* Stats */}
              <div className="stats">
                <div className="stat">
                  <div className="stat-label">Total Prospects</div>
                  <div className="stat-val">{totalProspects}</div>
                  {lastRun && <div className="stat-delta">↑ +{lastRun.businesses_new} last run</div>}
                </div>
                <div className="stat">
                  <div className="stat-label">Verified Emails</div>
                  <div className="stat-val">{totalEmails}</div>
                  {lastRun && <div className="stat-delta">↑ +{lastRun.contacts_found} last run</div>}
                </div>
                <div className="stat">
                  <div className="stat-label">Active Listings</div>
                  <div className="stat-val">3</div>
                  <div className="stat-delta">↑ 8 new matches</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Opportunities</div>
                  <div className="stat-val">7</div>
                  <div className="stat-delta">↑ 3 new signals</div>
                </div>
              </div>

              {/* Two-column: Matches + Signals */}
              <div className="g2">
                <div className="card">
                  <div className="card-hd">
                    <div className="card-title">New Listing Matches</div>
                    <button className="btn btn-g btn-sm" onClick={() => setView('listings')}>View All →</button>
                  </div>
                  <div className="card-body">
                    <div className="match-list">
                      <div className="match-item">
                        <div>
                          <div className="match-biz">Westend Family Dental</div>
                          <div className="match-meta">Manning Town Centre · 1,200 SF unit</div>
                          <div className="signals"><span className="sig sg">✓ Dental category</span><span className="sig sw">⚡ Hiring 2 hygienists</span><span className="sig sg">✓ Lease expiring Q2</span></div>
                        </div>
                        <div><div className="score">94<span>match</span></div></div>
                      </div>
                      <div className="match-item">
                        <div>
                          <div className="match-biz">Apollonia Dental Clinic</div>
                          <div className="match-meta">Manning Town Centre · 1,200 SF unit</div>
                          <div className="signals"><span className="sig sg">✓ Dental category</span><span className="sig sg">✓ 4 yrs at address</span><span className="sig sg">★ 4.8 stars</span></div>
                        </div>
                        <div><div className="score">88<span>match</span></div></div>
                      </div>
                      <div className="match-item">
                        <div>
                          <div className="match-biz">Smilezone Dental</div>
                          <div className="match-meta">Five Corners · 2,400 SF unit</div>
                          <div className="signals"><span className="sig sg">✓ Dental category</span><span className="sig sw">⚡ 2nd location pattern</span></div>
                        </div>
                        <div><div className="score">81<span>match</span></div></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="card-hd">
                    <div className="card-title">Opportunity Signals</div>
                    <button className="btn btn-g btn-sm" onClick={() => setView('opportunities')}>View All →</button>
                  </div>
                  <div className="card-body" style={{ padding: '12px 18px' }}>
                    <div className="opp">
                      <div className="opp-dot" style={{ background: 'var(--accent)' }} />
                      <div><div className="opp-title">New Corp: Zenith Physiotherapy Inc.</div><div className="opp-detail">Registered Mar 4 · No lease detected · Medical</div></div>
                      <div className="opp-time">2d ago</div>
                    </div>
                    <div className="opp">
                      <div className="opp-dot" style={{ background: 'var(--warn)' }} />
                      <div><div className="opp-title">Hiring spike: NW Dental Group</div><div className="opp-detail">3 new postings · Est. outgrowing current space</div></div>
                      <div className="opp-time">3d ago</div>
                    </div>
                    <div className="opp">
                      <div className="opp-dot" style={{ background: 'var(--accent)' }} />
                      <div><div className="opp-title">Lease window: Kingsway Optometry</div><div className="opp-detail">Est. expiry Q3 2026 · 5yr term</div></div>
                      <div className="opp-time">5d ago</div>
                    </div>
                    <div className="opp">
                      <div className="opp-dot" style={{ background: 'var(--danger)' }} />
                      <div><div className="opp-title">Closed: Millwoods Law Centre</div><div className="opp-detail">Gone from 34 Ave · Possible corridor vacancy</div></div>
                      <div className="opp-time">1w ago</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Last Run */}
              {lastRun && (
                <div className="card">
                  <div className="card-hd">
                    <div className="card-title">Last Run — {formatCat(lastRun.category)} · {lastRun.city}</div>
                    <span style={{ fontSize: 11, color: lastRun.status === 'complete' ? 'var(--accent)' : 'var(--warn)' }}>
                      {lastRun.status === 'complete' ? '✓' : '●'} {lastRun.status.charAt(0).toUpperCase() + lastRun.status.slice(1)} {new Date(lastRun.started_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="card-body">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20 }}>
                      <div><div className="stat-label">Discovered</div><div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>{lastRun.businesses_found}</div></div>
                      <div><div className="stat-label">New This Run</div><div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>{lastRun.businesses_new}</div></div>
                      <div><div className="stat-label">Emails Found</div><div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>{lastRun.contacts_found}</div></div>
                      <div><div className="stat-label">Total Runs</div><div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>{runs.length}</div></div>
                      <div><div className="stat-label">Listing Matches</div><div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>8</div></div>
                    </div>
                    <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                      <button className="btn btn-g btn-sm" onClick={() => handleExport('xlsx', lastRun.category, lastRun.city)}>↓ Download Excel</button>
                      <button className="btn btn-g btn-sm" onClick={() => handleExport('csv', lastRun.category, lastRun.city)}>↓ CSV</button>
                      <button className="btn btn-g btn-sm" onClick={() => setView('prospects')}>View Prospects →</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ────── PROSPECTS ────── */}
          {view === 'prospects' && (
            <div className="view" key="prospects">
              <div className="page-hd">
                <div>
                  <div className="page-title">Prospects</div>
                  <div className="page-sub">{businessTotal} businesses · Click any row to draft an outreach email</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-g btn-sm" onClick={() => handleExport('xlsx')}>↓ Export Excel</button>
                  <button className="btn btn-p btn-sm" onClick={() => handleExport('csv')}>↓ Export CSV</button>
                </div>
              </div>

              {/* Draft panel */}
              {draftOpen && (
                <div className="prospect-panel">
                  <div className="panel-title">Drafting email for {draftBizName}</div>
                  <div className="gen-row">
                    {!draftDone && <div className="gen-dot" />}
                    <span>{draftDone ? 'Email ready — copy or edit before sending' : 'AI is writing your outreach email...'}</span>
                  </div>
                  <div className="email-draft">
                    <div className="email-field"><span className="efl">TO</span> <span style={{ color: 'var(--text)' }}>{draftTo}</span></div>
                    <div className="email-field"><span className="efl">FROM</span> <span style={{ color: 'var(--text)' }}>devan.ramage@cwedm.com</span></div>
                    <div className="email-field"><span className="efl">RE</span> <span style={{ color: 'var(--text)' }}>{draftSubject}</span></div>
                    <div className="email-body-text">{draftBody}</div>
                    {!draftDone && <span className="email-cursor" />}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn btn-p btn-sm" onClick={() => { navigator.clipboard.writeText(draftBody); toast('Email copied to clipboard.'); }}>Copy Email</button>
                    <button className="btn btn-g btn-sm" onClick={() => setDraftOpen(false)}>Dismiss</button>
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="filter-bar">
                <input type="text" placeholder="Category..." value={catFilter} onChange={e => { setCatFilter(e.target.value); setBizPage(1); }} />
                <input type="text" placeholder="City..." value={cityFilter} onChange={e => { setCityFilter(e.target.value); setBizPage(1); }} />
                <label>
                  <input type="checkbox" checked={emailOnly} onChange={e => { setEmailOnly(e.target.checked); setBizPage(1); }} />
                  Has email only
                </label>
              </div>

              {/* Table */}
              <div className="card">
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Business</th>
                        <th>Address</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Rating</th>
                        <th>Source</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {businesses.length === 0 && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>No data yet. Run the pipeline first.</td></tr>
                      )}
                      {businesses.map(b => (
                        <tr key={`${b.id}-${b.email}`} className="prospect-row" onClick={() => b.email && startDraft(b.name, b.email, b.city)}>
                          <td><strong>{b.name}</strong></td>
                          <td style={{ color: 'var(--muted)' }}>{b.address}</td>
                          <td style={{ color: 'var(--muted)' }}>{b.phone || '—'}</td>
                          <td>
                            {b.email ? (
                              <span className={`etag ${b.verified ? 'ev' : 'es'}`}>
                                {b.verified ? '✓' : '~'} {b.email}
                              </span>
                            ) : (
                              <span className="etag en">— none</span>
                            )}
                          </td>
                          <td>
                            {b.google_rating ? (
                              <><span className="stars">{stars(b.google_rating)}</span> <span style={{ color: 'var(--muted)', fontSize: 11 }}>{b.google_rating}</span></>
                            ) : '—'}
                          </td>
                          <td style={{ color: 'var(--muted)', fontSize: 11 }}>{b.source || '—'}</td>
                          <td>
                            {b.email && (
                              <button className="btn btn-g btn-xs" onClick={e => { e.stopPropagation(); startDraft(b.name, b.email, b.city); }}>
                                Draft →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '11px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    Showing {businesses.length} of {businessTotal} · Page {bizPage} of {bizPages}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-g btn-sm" disabled={bizPage <= 1} onClick={() => setBizPage(p => p - 1)}>← Prev</button>
                    <button className="btn btn-g btn-sm" disabled={bizPage >= bizPages} onClick={() => setBizPage(p => p + 1)}>Next →</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ────── LISTINGS ────── */}
          {view === 'listings' && (
            <div className="view" key="listings">
              <div className="page-hd">
                <div>
                  <div className="page-title">Listing Intelligence</div>
                  <div className="page-sub">Upload a listing — tenants match automatically every time the pipeline runs.</div>
                </div>
                <button className="btn btn-p" onClick={() => setListingModalOpen(true)}>+ Add Listing</button>
              </div>

              <div className="upload-zone" onClick={() => setListingModalOpen(true)}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--text)' }}>Drop a listing PDF or paste a LoopNet URL</strong><br />
                  AI extracts sq ft, zoning, price, floor, and permitted uses automatically.
                </div>
              </div>

              {/* Listing 1: Manning */}
              <div className="listing-card">
                <div className="listing-hd" onClick={() => setListingOpen(p => ({ ...p, manning: !p.manning }))}>
                  <div>
                    <div className="listing-name">Manning Town Centre — Unit C12</div>
                    <div className="listing-meta">1,200 SF · Ground Floor · $28/SF · DC1 Zoning · Medical / Retail</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="lbadge lb-active">● Active</span>
                    <span style={{ color: 'var(--accent)', fontSize: 16 }}>{listingOpen.manning ? '▾' : '▸'}</span>
                  </div>
                </div>
                {listingOpen.manning && (
                  <div className="listing-body">
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                      Watching: <span style={{ color: 'var(--accent)' }}>Dental · Medical · Optometry · Pharmacy</span> &nbsp;·&nbsp; 3 new matches this week
                    </div>
                    <div className="match-list">
                      <div className="match-item">
                        <div>
                          <div className="match-biz">Westend Family Dental</div>
                          <div className="match-meta">8882 170 St NW · ★ 4.9</div>
                          <div className="signals"><span className="sig sg">✓ Dental</span><span className="sig sw">⚡ Hiring 2 hygienists</span><span className="sig sg">✓ Lease expiring Q2</span><span className="sig sg">✓ Verified email</span></div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="score">94<span>match</span></div>
                          <button className="btn btn-p btn-xs" style={{ marginTop: 8 }} onClick={() => startDraft('Westend Family Dental', 'info@westendfamilydental.ca')}>Draft Email</button>
                        </div>
                      </div>
                      <div className="match-item">
                        <div>
                          <div className="match-biz">Apollonia Dental Clinic</div>
                          <div className="match-meta">5120 Rabbit Hill Rd · ★ 4.8</div>
                          <div className="signals"><span className="sig sg">✓ Dental</span><span className="sig sg">✓ 4 yrs at address</span><span className="sig sg">★ Single location</span></div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="score">88<span>match</span></div>
                          <button className="btn btn-p btn-xs" style={{ marginTop: 8 }} onClick={() => startDraft('Apollonia Dental Clinic', 'hello@apolloniadental.ca')}>Draft Email</button>
                        </div>
                      </div>
                      <div className="match-item">
                        <div>
                          <div className="match-biz">Kingsway Optometry</div>
                          <div className="match-meta">10411 Kingsway Ave · ★ 4.5</div>
                          <div className="signals"><span className="sig sg">✓ Medical category</span><span className="sig sw">⚡ Lease window Q3 2026</span><span className="sig sg">✓ Verified email</span></div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="score">76<span>match</span></div>
                          <button className="btn btn-g btn-xs" style={{ marginTop: 8 }} onClick={() => startDraft('Kingsway Optometry', 'info@kingswayoptometry.ca')}>Draft Email</button>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button className="btn btn-g btn-sm" onClick={() => toast('Drafting 3 outreach emails...')}>Draft All 3</button>
                      <button className="btn btn-g btn-sm" onClick={() => toast('Marked as leased.')}>Mark Leased</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Listing 2: Five Corners */}
              <div className="listing-card">
                <div className="listing-hd" onClick={() => setListingOpen(p => ({ ...p, hat: !p.hat }))}>
                  <div>
                    <div className="listing-name">The Hat at Five Corners — Suite 101</div>
                    <div className="listing-meta">2,400 SF · Ground Floor · $35/SF · DC2 Zoning · Retail / Restaurant / Medical</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="lbadge lb-active">● Active</span>
                    <span style={{ color: 'var(--accent)', fontSize: 16 }}>{listingOpen.hat ? '▾' : '▸'}</span>
                  </div>
                </div>
                {listingOpen.hat && (
                  <div className="listing-body">
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                      Watching: <span style={{ color: 'var(--accent)' }}>Dental · Physiotherapy · Legal · QSR</span> &nbsp;·&nbsp; 5 new matches this week
                    </div>
                    <div className="match-list">
                      <div className="match-item">
                        <div>
                          <div className="match-biz">Smilezone Dental</div>
                          <div className="match-meta">3803 Calgary Trail · ★ 4.6</div>
                          <div className="signals"><span className="sig sg">✓ Dental</span><span className="sig sw">⚡ 2nd location pattern</span><span className="sig sg">✓ Est. 1,800–2,500 SF need</span></div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="score">81<span>match</span></div>
                          <button className="btn btn-p btn-xs" style={{ marginTop: 8 }} onClick={() => startDraft('Smilezone Dental', 'contact@smilezonedental.ca')}>Draft Email</button>
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 12 }}>+ 4 more matches — run physiotherapy pipeline to surface them</div>
                    <div style={{ marginTop: 10 }}>
                      <button className="btn btn-g btn-sm" onClick={() => { setRunCategory('physiotherapy'); setRunModalOpen(true); }}>Run Physio Pipeline →</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ────── OPPORTUNITIES ────── */}
          {view === 'opportunities' && (
            <div className="view" key="opportunities">
              <div className="page-hd">
                <div>
                  <div className="page-title">Opportunity Signals</div>
                  <div className="page-sub">New businesses, hiring spikes, and lease windows — surfaced automatically.</div>
                </div>
              </div>
              <div className="card">
                <div className="card-hd"><div className="card-title">This Week · 7 Signals</div></div>
                <div className="card-body" style={{ padding: '0 18px' }}>
                  <div className="opp">
                    <div className="opp-dot" style={{ background: 'var(--accent)' }} />
                    <div style={{ flex: 1 }}>
                      <div className="opp-title">New Corp: Zenith Physiotherapy Inc.</div>
                      <div className="opp-detail">Registered Mar 4, 2026 · No lease detected · Medical / Physiotherapy</div>
                      <div style={{ marginTop: 8 }}><button className="btn btn-g btn-xs" onClick={() => startDraft('Zenith Physiotherapy Inc.', 'info@zenithphysio.ca')}>Draft Outreach</button></div>
                    </div>
                    <div className="opp-time">2d ago</div>
                  </div>
                  <div className="opp">
                    <div className="opp-dot" style={{ background: 'var(--warn)' }} />
                    <div style={{ flex: 1 }}>
                      <div className="opp-title">Hiring spike: NW Dental Group</div>
                      <div className="opp-detail">3 new job postings · Currently at 1,200 SF · Est. outgrowing space</div>
                      <div style={{ marginTop: 8 }}><button className="btn btn-g btn-xs" onClick={() => startDraft('NW Dental Group', 'info@nwdentalgroup.ca')}>Draft Outreach</button></div>
                    </div>
                    <div className="opp-time">3d ago</div>
                  </div>
                  <div className="opp">
                    <div className="opp-dot" style={{ background: 'var(--accent)' }} />
                    <div style={{ flex: 1 }}>
                      <div className="opp-title">Lease window: Kingsway Optometry</div>
                      <div className="opp-detail">Estimated lease expiry Q3 2026 · 5yr term at current address</div>
                      <div style={{ marginTop: 8 }}><button className="btn btn-g btn-xs" onClick={() => startDraft('Kingsway Optometry', 'info@kingswayoptometry.ca')}>Draft Outreach</button></div>
                    </div>
                    <div className="opp-time">5d ago</div>
                  </div>
                  <div className="opp">
                    <div className="opp-dot" style={{ background: 'var(--accent)' }} />
                    <div style={{ flex: 1 }}>
                      <div className="opp-title">New Corp: Summit Legal Group</div>
                      <div className="opp-detail">Registered Feb 28, 2026 · Legal services · No lease detected</div>
                      <div style={{ marginTop: 8 }}><button className="btn btn-g btn-xs" onClick={() => startDraft('Summit Legal Group', 'info@summitlegal.ca')}>Draft Outreach</button></div>
                    </div>
                    <div className="opp-time">1w ago</div>
                  </div>
                  <div className="opp">
                    <div className="opp-dot" style={{ background: 'var(--warn)' }} />
                    <div style={{ flex: 1 }}>
                      <div className="opp-title">Hiring spike: Gateway Orthodontics</div>
                      <div className="opp-detail">2 orthodontist positions posted · Single location · Possible expansion</div>
                      <div style={{ marginTop: 8 }}><button className="btn btn-g btn-xs" onClick={() => startDraft('Gateway Orthodontics', 'info@gatewayortho.ca')}>Draft Outreach</button></div>
                    </div>
                    <div className="opp-time">1w ago</div>
                  </div>
                  <div className="opp">
                    <div className="opp-dot" style={{ background: 'var(--danger)' }} />
                    <div style={{ flex: 1 }}>
                      <div className="opp-title">Closed: Millwoods Law Centre</div>
                      <div className="opp-detail">No longer at 34 Ave location · Possible corridor vacancy opening up</div>
                    </div>
                    <div className="opp-time">1w ago</div>
                  </div>
                  <div className="opp">
                    <div className="opp-dot" style={{ background: 'var(--accent)' }} />
                    <div style={{ flex: 1 }}>
                      <div className="opp-title">Lease window: Riverbend Chiropractic</div>
                      <div className="opp-detail">Estimated expiry Q4 2026 · 4.5 years at current address</div>
                      <div style={{ marginTop: 8 }}><button className="btn btn-g btn-xs" onClick={() => startDraft('Riverbend Chiropractic', 'info@riverbendchiro.ca')}>Draft Outreach</button></div>
                    </div>
                    <div className="opp-time">1w ago</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ────── SETTINGS ────── */}
          {view === 'settings' && (
            <div className="view" key="settings">
              <div className="page-hd">
                <div>
                  <div className="page-title">Settings</div>
                  <div className="page-sub">Manage your account, integrations, and pipeline preferences.</div>
                </div>
              </div>

              {/* Profile card */}
              <div className="settings-section">
                <div className="settings-section-title">Profile</div>
                <div className="settings-card">
                  <div className="settings-profile-row">
                    <div className="settings-avatar">DR</div>
                    <div style={{ flex: 1 }}>
                      <div className="settings-profile-name">Devan Ramage</div>
                      <div className="settings-profile-meta">Head of Retail · Cushman &amp; Wakefield Edmonton</div>
                      <div className="settings-profile-email">devan.ramage@cwedm.com</div>
                    </div>
                    <button className="btn btn-g btn-sm">Edit Profile</button>
                  </div>
                </div>
              </div>

              {/* API Keys */}
              <div className="settings-section">
                <div className="settings-section-title">API Integrations</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Google Places API</div>
                      <div className="settings-row-desc">Business discovery across Edmonton zones</div>
                    </div>
                    <div className="settings-row-status settings-status-ok">● Connected</div>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Hunter.io</div>
                      <div className="settings-row-desc">Email enrichment and verification</div>
                    </div>
                    <div className="settings-row-status settings-status-ok">● Connected</div>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Salesforce CRM</div>
                      <div className="settings-row-desc">Push verified contacts to your CRM</div>
                    </div>
                    <div className="settings-row-status settings-status-off">○ Not connected</div>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">LinkedIn Sales Navigator</div>
                      <div className="settings-row-desc">Decision-maker enrichment</div>
                    </div>
                    <div className="settings-row-status settings-status-soon">◌ Coming soon</div>
                  </div>
                </div>
              </div>

              {/* Pipeline Defaults */}
              <div className="settings-section">
                <div className="settings-section-title">Pipeline Defaults</div>
                <div className="settings-card">
                  <div className="settings-field-grid">
                    <div>
                      <label className="form-label">Default Market</label>
                      <select className="form-select">
                        <option>Edmonton, AB</option>
                        <option>Calgary, AB</option>
                        <option>Vancouver, BC</option>
                        <option>Toronto, ON</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">API Delay (ms)</label>
                      <input className="form-input" type="number" defaultValue={500} />
                    </div>
                    <div>
                      <label className="form-label">Auto-Refresh</label>
                      <select className="form-select">
                        <option>Disabled</option>
                        <option>Weekly</option>
                        <option>Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Email Confidence Threshold</label>
                      <select className="form-select">
                        <option>70% (recommended)</option>
                        <option>50%</option>
                        <option>90%</option>
                        <option>Any</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notifications */}
              <div className="settings-section">
                <div className="settings-section-title">Notifications</div>
                <div className="settings-card">
                  <div className="settings-toggle-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Pipeline completion emails</div>
                      <div className="settings-row-desc">Get notified when a pipeline run finishes</div>
                    </div>
                    <div className="settings-toggle on" onClick={e => (e.currentTarget as HTMLElement).classList.toggle('on')}>
                      <div className="settings-toggle-knob" />
                    </div>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-toggle-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">New listing match alerts</div>
                      <div className="settings-row-desc">Notify when prospects match an active listing</div>
                    </div>
                    <div className="settings-toggle on" onClick={e => (e.currentTarget as HTMLElement).classList.toggle('on')}>
                      <div className="settings-toggle-knob" />
                    </div>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-toggle-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Opportunity signal digest</div>
                      <div className="settings-row-desc">Weekly summary of hiring spikes, new corps, and lease windows</div>
                    </div>
                    <div className="settings-toggle" onClick={e => (e.currentTarget as HTMLElement).classList.toggle('on')}>
                      <div className="settings-toggle-knob" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Data & Export */}
              <div className="settings-section">
                <div className="settings-section-title">Data &amp; Export</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Export all data</div>
                      <div className="settings-row-desc">Download your entire prospect database as Excel or CSV</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-g btn-sm" onClick={() => handleExport('xlsx')}>↓ Excel</button>
                      <button className="btn btn-g btn-sm" onClick={() => handleExport('csv')}>↓ CSV</button>
                    </div>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Clean email database</div>
                      <div className="settings-row-desc">Re-validate all stored emails and remove bad addresses</div>
                    </div>
                    <button className="btn btn-g btn-sm" onClick={() => toast('Email cleanup started...')}>Run Cleanup</button>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Database</div>
                      <div className="settings-row-desc">{totalProspects} prospects · {totalEmails} verified emails · {runs.length} pipeline runs</div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>● Healthy</span>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="settings-section">
                <div className="settings-section-title" style={{ color: 'var(--danger)' }}>Danger Zone</div>
                <div className="settings-card" style={{ borderColor: 'rgba(232, 90, 74, 0.2)' }}>
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Reset pipeline history</div>
                      <div className="settings-row-desc">Clear all run logs. Prospect data is preserved.</div>
                    </div>
                    <button className="btn btn-g btn-sm" style={{ color: 'var(--danger)', borderColor: 'rgba(232, 90, 74, 0.3)' }} onClick={() => toast('This action is disabled in the demo.')}>Reset</button>
                  </div>
                  <div className="settings-divider" />
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Delete all data</div>
                      <div className="settings-row-desc">Permanently remove all prospects, contacts, and run history.</div>
                    </div>
                    <button className="btn btn-g btn-sm" style={{ color: 'var(--danger)', borderColor: 'rgba(232, 90, 74, 0.3)' }} onClick={() => toast('This action is disabled in the demo.')}>Delete Everything</button>
                  </div>
                </div>
              </div>

              <div style={{ height: 40 }} />
            </div>
          )}

        </main>
      </div>

      {/* ──── PIPELINE MODAL ──── */}
      {runModalOpen && (
        <div className="overlay" onClick={closeRunModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">▷ Run Pipeline</div>
            <div className="modal-sub">ProspectLayer sweeps Edmonton across {ZONE_NAMES.length} zones, enriches emails via Hunter.io, and scores every result against your active listings.</div>

            {runPhase === 'setup' && (
              <>
                <label className="form-label">Category</label>
                <select className="form-select" value={runCategory} onChange={e => setRunCategory(e.target.value)}>
                  {Object.keys(categories).map(cat => (
                    <option key={cat} value={cat}>{formatCat(cat)}</option>
                  ))}
                </select>
                <label className="form-label">Market</label>
                <input className="form-input" value={runCity} onChange={e => setRunCity(e.target.value)} placeholder="Edmonton, AB" />
              </>
            )}

            {runPhase === 'running' && (
              <>
                {/* Zone map */}
                <div className="zone-map">
                  {ZONE_NAMES.map((name, i) => (
                    <div key={i} className={`zone ${zoneStates[i]}`}>
                      <div>{name}</div>
                      <div className="zone-count">{zoneCounts[i]}</div>
                    </div>
                  ))}
                </div>

                {/* Progress */}
                <div className="prog-wrap">
                  <div className="prog-bar"><div className="prog-fill" style={{ width: `${progress}%` }} /></div>
                  <div className="prog-label">{progress}%</div>
                </div>

                {/* Terminal */}
                <div className="terminal" ref={logRef}>
                  {runState.log.map((line, i) => (
                    <div key={i} className={logClass(line)}>{line}</div>
                  ))}
                  {runState.status === 'running' && <div className="tdim" style={{ display: 'inline' }}><span className="email-cursor" /></div>}
                </div>

                {/* Done state */}
                {pipelineDone && (
                  <div style={{ animation: 'fadeUp .3s ease' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px' }}>
                        <div className="stat-label">Discovered</div>
                        <div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>{runState.stats.businessesFound}</div>
                      </div>
                      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px' }}>
                        <div className="stat-label">Emails Found</div>
                        <div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>{runState.stats.contactsFound}</div>
                      </div>
                      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px' }}>
                        <div className="stat-label">New This Run</div>
                        <div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--white)' }}>{runState.stats.businessesNew}</div>
                      </div>
                      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px' }}>
                        <div className="stat-label">Status</div>
                        <div style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: runState.status === 'complete' ? 'var(--accent)' : 'var(--danger)' }}>
                          {runState.status === 'complete' ? '✓' : '✗'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-p" onClick={() => { closeRunModal(); handleExport('xlsx', runCategory, runCity); }}>↓ Download Excel</button>
                      <button className="btn btn-g" onClick={() => { setView('prospects'); closeRunModal(); }}>View Prospects →</button>
                      <button className="btn btn-g" onClick={() => { setView('listings'); closeRunModal(); }}>View Matches →</button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="modal-footer">
              {!pipelineDone && (
                <button className="btn btn-g" onClick={closeRunModal}>Cancel</button>
              )}
              {runPhase === 'setup' && (
                <button className="btn btn-p" onClick={startPipeline}>▷ Start Run</button>
              )}
              {pipelineDone && (
                <button className="btn btn-g" onClick={closeRunModal}>Close</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ──── LISTING MODAL ──── */}
      {listingModalOpen && (
        <div className="overlay" onClick={() => setListingModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Add Listing</div>
            <div className="modal-sub">Paste a URL or upload a PDF — AI extracts the details and starts matching automatically.</div>
            <label className="form-label">Listing URL (LoopNet, CoStar, cwedm.com)</label>
            <input type="text" className="form-input" placeholder="https://cwedm.com/property/..." />
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)', margin: '4px 0 12px' }}>— or —</div>
            <div className="upload-zone" style={{ padding: 18 }} onClick={() => toast('PDF uploaded. AI extracting details...')}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>📄</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Click to upload listing PDF</div>
            </div>
            <label className="form-label">Tenant Categories to Watch</label>
            <input type="text" className="form-input" placeholder="e.g. Dental, Medical, Optometry, QSR" />
            <div className="modal-footer">
              <button className="btn btn-g" onClick={() => setListingModalOpen(false)}>Cancel</button>
              <button className="btn btn-p" onClick={() => { setListingModalOpen(false); toast('Listing saved. Matching against prospects...'); }}>Extract &amp; Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ──── TOAST ──── */}
      {toastVisible && <div className="toast">{toastMsg}</div>}
    </>
  );
}
