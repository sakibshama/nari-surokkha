import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Siren, Search, X, RefreshCw, ChevronLeft, ChevronRight, Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { apiErrorMessage } from '../services/api';
import { socketService } from '../services/socket';
import { useT, fmt } from '../i18n';
import {
  ALERT_STATUS_FILTERS, ALERT_TYPE_LABEL, AlertStatusBadge, formatDateTime,
} from '../utils/alertStatus';

/**
 * SOS reports — the permanent record of every SOS ever raised.
 *
 * Unlike the dashboard (which shows only alerts that still need help), this
 * lists every alert whatever happened to it: active, cancelled, false alarm,
 * resolved or closed. Cancelling or resolving only changes the status.
 */

interface AlertRow {
  id: string;
  type: string;
  status: string;
  isSoftAlert?: boolean;
  latitude: number | string;
  longitude: number | string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  softAlertCancelledAt?: string | null;
  user?: { id: string; phone: string; profile?: { fullName?: string } | null };
  _count?: { evidence: number; recipients: number; responderDispatches: number };
}

const PAGE_SIZE = 25;

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10,
  color: 'var(--text)', padding: '8px 12px', fontSize: 14, outline: 'none', cursor: 'pointer',
};

export default function SosReports() {
  const t = useT();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [statusKey, setStatusKey] = useState('all');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const h = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const statuses = ALERT_STATUS_FILTERS.find(f => f.key === statusKey)?.statuses ?? '';
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (statuses) params.status = statuses;
    if (type) params.type = type;
    // Local-day boundaries, sent as instants so the admin's timezone is honoured.
    if (from) params.from = new Date(`${from}T00:00:00`).toISOString();
    if (to) params.to = new Date(`${to}T23:59:59.999`).toISOString();
    if (debouncedSearch) params.search = debouncedSearch;
    try {
      const res = await api.get('/admin/alerts', { params });
      setRows(res.data.data || []);
      setTotal(typeof res.data.total === 'number' ? res.data.total : (res.data.data || []).length);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('Failed to load SOS reports')));
    } finally {
      setLoading(false);
    }
  }, [statusKey, type, from, to, debouncedSearch, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  // New SOS or a status change elsewhere → refresh the current page.
  useEffect(() => {
    socketService.connect();
    const onChange = () => { void fetchRows(); };
    socketService.on('alert:created', onChange);
    socketService.on('alert_status_update', onChange);
    return () => {
      socketService.off('alert:created', onChange);
      socketService.off('alert_status_update', onChange);
    };
  }, [fetchRows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };
  const hasFilters = statusKey !== 'all' || !!type || !!from || !!to || !!search;

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Siren size={22} color="#e11d3a" /> {t('SOS Reports')}
            </h1>
            <p className="page-subtitle">
              {t('Every SOS ever triggered — active, cancelled, false alarm, resolved or closed. Records are never deleted.')}
            </p>
          </div>
          <button className="btn btn-ghost" onClick={() => void fetchRows()} disabled={loading}>
            <RefreshCw size={14} /> {t('Refresh')}
          </button>
        </div>
      </div>

      {/* ─── Filters ─── */}
      <div className="card" style={{ marginBottom: 18, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="filter-tabs">
          {ALERT_STATUS_FILTERS.map(f => (
            <button key={f.key} className={`filter-tab${statusKey === f.key ? ' active' : ''}`}
              onClick={() => resetPage(setStatusKey)(f.key)}>
              {t(f.label)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px' }}>
            <Search size={15} color="var(--text-muted)" />
            <input
              type="text"
              placeholder={t('Search by victim name or phone…')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14, width: '100%' }}
            />
            {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={14} /></button>}
          </div>
          <select value={type} onChange={e => resetPage(setType)(e.target.value)} style={selectStyle} aria-label={t('Type')}>
            <option value="">{t('All types')}</option>
            {Object.entries(ALERT_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            {t('From')}
            <input type="date" value={from} max={to || undefined} onChange={e => resetPage(setFrom)(e.target.value)} style={selectStyle} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            {t('To')}
            <input type="date" value={to} min={from || undefined} onChange={e => resetPage(setTo)(e.target.value)} style={selectStyle} />
          </label>
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setStatusKey('all'); setType(''); setFrom(''); setTo(''); setSearch(''); setPage(0); }}>
              {t('Clear filters')}
            </button>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {fmt(t('{n} results'), { n: total })}
          </div>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="data-table-wrapper">
        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>{t('Created At')}</th>
                <th>{t('Victim')}</th>
                <th>{t('Type')}</th>
                <th>{t('Status')}</th>
                <th>{t('Last updated')}</th>
                <th>{t('Resolved / closed')}</th>
                <th>{t('Evidence')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}>{t('Loading SOS reports…')}</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <Siren size={48} />
                      <p>{t('No SOS reports match these filters.')}</p>
                    </div>
                  </td>
                </tr>
              ) : rows.map(a => (
                <tr key={a.id} onClick={() => navigate(`/alerts/${a.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ whiteSpace: 'nowrap' }}><div className="cell-primary">{formatDateTime(a.createdAt)}</div></td>
                  <td>
                    <div className="cell-primary">{a.user?.profile?.fullName || t('Unknown')}</div>
                    <div className="cell-mono" style={{ color: 'var(--text-sub)', fontSize: 12 }}>{a.user?.phone || '—'}</div>
                  </td>
                  <td>
                    <div>{t(ALERT_TYPE_LABEL[a.type] ?? a.type)}</div>
                    {a.isSoftAlert && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>⏱ {t('Soft Alert (pre-alarm)')}</div>}
                  </td>
                  <td><AlertStatusBadge status={a.status} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.updatedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.resolvedAt ?? a.closedAt ?? a.softAlertCancelledAt)}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-sub)', fontSize: 13 }}>
                      <Paperclip size={12} /> {a._count?.evidence ?? 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && total > PAGE_SIZE && (
          <div className="pager">
            <span>{fmt(t('Showing {from}–{to} of {total}'), { from: page * PAGE_SIZE + 1, to: Math.min(total, (page + 1) * PAGE_SIZE), total })}</span>
            <div className="pager-buttons">
              <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                <ChevronLeft size={14} /> {t('Previous')}
              </button>
              <span>{fmt(t('Page {page} of {pages}'), { page: page + 1, pages: pageCount })}</span>
              <button className="btn btn-ghost btn-sm" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>
                {t('Next')} <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
