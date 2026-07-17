import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api';
import { useT } from '../i18n';

export default function Cases() {
  const navigate = useNavigate();
  const t = useT();
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCases = async () => {
    try {
      const res = await api.get('/cases');
      setCases(res.data.data);
    } catch (err) {
      console.error('Failed to fetch cases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <span className="badge danger"><span className="badge-dot"></span>{status}</span>;
      case 'investigating':
        return <span className="badge warning"><span className="badge-dot"></span>{status}</span>;
      case 'closed':
      case 'false_alarm':
        return <span className="badge success">{status.replace('_', ' ')}</span>;
      default:
        return <span className="badge muted">{status}</span>;
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{t('Case Management')}</h1>
            <p className="page-subtitle">{t('Manage and track active and closed investigations.')}</p>
          </div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} color="var(--blue)" />
            All Cases ({cases.length})
          </div>
          <div className="data-table-search">
            <Search size={16} />
            <input type="text" placeholder={t('Search case number...')} />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>{t('Case Number')}</th>
                <th>{t('Created At')}</th>
                <th>{t('Status')}</th>
                <th>{t('Assigned Officer')}</th>
                <th style={{ textAlign: 'right' }}>{t('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px' }}>Loading cases...</td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <FileText size={48} />
                      <p>{t('No cases found.')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="cell-primary cell-mono">{c.caseNumber}</div>
                    </td>
                    <td>{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</td>
                    <td>{getStatusBadge(c.status)}</td>
                    <td>
                      {c.assignedOfficer ? c.assignedOfficer.profile?.fullName || c.assignedOfficer.badgeNumber : 'Unassigned'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate(`/cases/${c.id}`)}
                      >
                        Manage Case
                      </button>
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
