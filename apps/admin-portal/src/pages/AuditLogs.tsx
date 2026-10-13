import { useState, useEffect, useCallback } from 'react';
import { Activity, Search } from 'lucide-react';
import api, { apiErrorMessage } from '../services/api';
import toast from 'react-hot-toast';
import { useT } from '../i18n';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  metadata?: any;
}

export default function AuditLogs() {
  const t = useT();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Cursor pagination: the API returns `nextCursor`; pass it back as ?cursor=.
  const fetchLogs = useCallback(async (cursor?: string) => {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (cursor) params.cursor = cursor;
    cursor ? setLoadingMore(true) : setLoading(true);
    try {
      const res = await api.get('/admin/audit-logs', { params });
      const items: AuditLog[] = res.data.data || [];
      setLogs(prev => (cursor ? [...prev, ...items] : items));
      setNextCursor(res.data.nextCursor ?? null);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('Failed to load audit logs')));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = setTimeout(() => { void fetchLogs(); }, 250);
    return () => clearTimeout(h);
  }, [fetchLogs]);

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{t('System Audit Logs')}</h1>
            <p className="page-subtitle">{t('Immutable record of system actions. Sensitive data is automatically masked.')}</p>
          </div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="var(--purple)" />
            {t('Logs')} ({logs.length}{nextCursor ? '+' : ''})
          </div>
          <div className="data-table-search">
            <Search size={16} />
            <input 
              type="text" 
              placeholder={t('Search action or entity…')} 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>{t('Timestamp')}</th>
                <th>{t('Action')}</th>
                <th>{t('Entity Type')}</th>
                <th>{t('IP Address')}</th>
                <th>{t('Metadata')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px' }}>{t('Loading logs…')}</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <Activity size={48} />
                      <p>{t('No audit logs found.')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div className="cell-primary">{new Date(log.createdAt).toLocaleString()}</div>
                    </td>
                    <td>
                      <span className="badge info">{log.action}</span>
                    </td>
                    <td><span className="cell-mono">{log.entityType}</span></td>
                    <td><span className="cell-mono" style={{ color: 'var(--text-sub)' }}>{log.ipAddress || 'N/A'}</span></td>
                    <td>
                      {log.metadata ? (
                        <div style={{
                          fontSize: '11px',
                          background: 'rgba(255,255,255,0.03)',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          maxWidth: '300px',
                          overflowX: 'auto',
                          fontFamily: 'var(--mono)',
                          color: 'var(--text-sub)'
                        }}>
                          {JSON.stringify(log.metadata, null, 2)}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && nextCursor && (
          <div className="pager" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void fetchLogs(nextCursor)} disabled={loadingMore}>
              {loadingMore ? t('Loading…') : t('Load more')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
