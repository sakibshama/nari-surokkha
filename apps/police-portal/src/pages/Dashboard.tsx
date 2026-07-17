import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAlertStore } from '../store/alertStore';
import { socketService } from '../services/socket';
import { useT } from '../i18n';

export default function Dashboard() {
  const navigate = useNavigate();
  const t = useT();
  const { alerts, setAlerts, addAlert, updateAlertStatus, updateAlertLocation } = useAlertStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await api.get('/police/alerts');
        setAlerts(res.data.data);
      } catch (err) {
        console.error('Failed to fetch alerts:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();

    socketService.connect();
    if (socketService.socket) {
      socketService.socket.on('alert:created', (data) => {
        // Refetch fully to ensure we have all relational data (user, profile)
        fetchAlerts();
      });
      socketService.socket.on('alert_status_update', (data) => updateAlertStatus(data.alertId, data.status));
      socketService.socket.on('alert:location_update', (data) => updateAlertLocation(data.alertId, data.latitude, data.longitude));
    }

    return () => {
      if (socketService.socket) {
        socketService.socket.off('alert:created');
        socketService.socket.off('alert_status_update');
        socketService.socket.off('alert:location_update');
      }
    };
  }, [setAlerts, addAlert, updateAlertStatus, updateAlertLocation]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'created':
      case 'confirmed':
        return <span className="badge danger"><span className="badge-dot"></span>{status.replace('_', ' ')}</span>;
      case 'in_progress':
        return <span className="badge warning"><span className="badge-dot"></span>{status.replace('_', ' ')}</span>;
      case 'resolved':
      case 'false_alarm':
        return <span className="badge success">{status.replace('_', ' ')}</span>;
      default:
        return <span className="badge muted">{status}</span>;
    }
  };

  const getRowClass = (status: string) => {
    if (['created', 'confirmed'].includes(status)) return 'alert-row-critical';
    if (status === 'in_progress') return 'alert-row-warning';
    return '';
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{t('Live SOS Alerts Queue')}</h1>
            <p className="page-subtitle">{t('Real-time incoming emergency alerts from citizens in your jurisdiction.')}</p>
          </div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="live-dot" style={{ marginRight: '8px' }}></span>
            {t('Active Dispatches')} ({alerts.length})
          </div>
          <div className="data-table-search">
            <Search size={16} />
            <input type="text" placeholder={t('Search by victim or phone...')} />
          </div>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>{t('Time')}</th>
                <th>{t('Victim')}</th>
                <th>{t('Phone')}</th>
                <th>{t('Type')}</th>
                <th>{t('Status')}</th>
                <th style={{ textAlign: 'right' }}>{t('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px' }}>{t('Loading live alerts...')}</td>
                </tr>
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state" style={{ padding: '40px' }}>
                      <ShieldAlert size={48} />
                      <p>{t('No active emergency alerts at the moment.')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                alerts.map((alert) => (
                  <tr key={alert.id} className={getRowClass(alert.status)}>
                    <td>
                      <div className="cell-primary">
                        {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                      </div>
                    </td>
                    <td className="cell-primary">{alert.user?.profile?.fullName || t('Unknown')}</td>
                    <td>{alert.user?.phone}</td>
                    <td><span className="badge muted">{alert.type}</span></td>
                    <td>{getStatusBadge(alert.status)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate(`/alerts/${alert.id}`)}
                      >
                        {t('View Details')}
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
