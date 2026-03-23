'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type Business = {
  id: number; name: string; category: string; address: string; city: string;
  phone: string | null; website: string | null; google_rating: number | null;
  email: string | null; confidence_score: number | null;
  source: string | null; verified: boolean | null; last_seen_at: string;
};

function Sidebar({ active }: { active: string }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">Brok<span>ord</span></div>
      <Link href="/" className={`nav-item ${active === 'dashboard' ? 'active' : ''}`}>
        ▸ Dashboard
      </Link>
      <Link href="/businesses" className={`nav-item ${active === 'businesses' ? 'active' : ''}`}>
        ▸ Businesses
      </Link>
    </nav>
  );
}

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [hasEmail, setHasEmail] = useState(false);

  const limit = 50;

  const fetchBusinesses = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(category && { category }),
      ...(city && { city }),
      ...(hasEmail && { hasEmail: 'true' }),
    });
    const res = await fetch(`/api/businesses?${params}`);
    const data = await res.json();
    setBusinesses(data.data || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [page, category, city, hasEmail]);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  function handleExport(format: 'xlsx' | 'csv') {
    const params = new URLSearchParams({ format });
    if (category) params.set('category', category);
    if (city) params.set('city', city);
    window.location.href = `/api/export?${params}`;
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="shell">
      <Sidebar active="businesses" />
      <main className="main">
        <div className="page-header">
          <h1 className="page-title">
            Businesses
            <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--subtle)', marginLeft: 12 }}>
              {total.toLocaleString()} records
            </span>
          </h1>
          <div className="export-group">
            <button className="btn btn-ghost" onClick={() => handleExport('xlsx')}>↓ Export Excel</button>
            <button className="btn btn-ghost export-alt" onClick={() => handleExport('csv')}>CSV</button>
          </div>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <input
            placeholder="Category (e.g. dentist)"
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
          />
          <input
            placeholder="City (e.g. Edmonton)"
            value={city}
            onChange={e => { setCity(e.target.value); setPage(1); }}
          />
          <label>
            <input
              type="checkbox"
              checked={hasEmail}
              onChange={e => { setHasEmail(e.target.checked); setPage(1); }}
            />
            Has email only
          </label>
          {loading && <span style={{ color: 'var(--subtle)', fontSize: 11 }}>Loading...</span>}
        </div>

        {/* Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Category</th>
                <th>Address</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Confidence</th>
                <th>Source</th>
                <th>Rating</th>
                <th>Website</th>
              </tr>
            </thead>
            <tbody>
              {businesses.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="td-muted" style={{ textAlign: 'center', padding: 32 }}>
                    No results. Run the pipeline first.
                  </td>
                </tr>
              )}
              {businesses.map(b => (
                <tr key={`${b.id}-${b.email}`}>
                  <td title={b.name}>{b.name}</td>
                  <td className="td-muted">{b.category}</td>
                  <td className="td-muted" title={b.address}>{b.address}</td>
                  <td className="td-muted">{b.phone || '—'}</td>
                  <td className={b.email ? 'td-email' : 'td-muted'} title={b.email || ''}>
                    {b.email || '—'}
                  </td>
                  <td className="td-muted">
                    {b.confidence_score != null ? `${b.confidence_score}%` : '—'}
                  </td>
                  <td className="td-muted">{b.source || '—'}</td>
                  <td className="td-muted">{b.google_rating ?? '—'}</td>
                  <td>
                    {b.website
                      ? <a href={b.website} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--subtle)', textDecoration: 'none' }}>↗</a>
                      : <span className="td-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="pagination">
          <span>{total.toLocaleString()} total</span>
          <button
            className="btn btn-ghost"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >← Prev</button>
          <span>Page {page} of {totalPages || 1}</span>
          <button
            className="btn btn-ghost"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >Next →</button>
        </div>
      </main>
    </div>
  );
}
