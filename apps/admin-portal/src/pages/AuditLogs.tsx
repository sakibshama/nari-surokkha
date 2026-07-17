import { useState, useEffect } from 'react';
import { Activity, Search } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

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
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchLogs();
  }, [search]);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/admin/audit-logs', { params: { search } });
      setLogs(res.data.data);
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">System Audit Logs</h1>
            <p className="page-subtitle">Immutable record of system actions. Sensitive data is automatically masked.</p>
          </div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="var(--purple)" />
            Logs ({logs.length})
          </div>
          <div className="data-table-search">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Search action or entity..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Entity Type</th>
                <th>IP Address</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px' }}>Loading logs...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <Activity size={48} />
                      <p>No audit logs found.</p>
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
      </div>
    </div>
  );
}
