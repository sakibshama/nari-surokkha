import { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle, XCircle, MapPin, Clock, Edit2, Trash2 } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { socketService } from '../services/socket';
import { useT } from '../i18n';

interface Incident {
  id: string;
  type: string;
  description: string;
  latitude: number;
  longitude: number;
  status: 'pending' | 'verified' | 'rejected';
  createdAt: string;
}

export default function Incidents() {
  const t = useT();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [editingIncident, setEditingIncident] = useState<Incident | null>(null);
  const [editForm, setEditForm] = useState({ type: '', description: '' });

  useEffect(() => {
    fetchIncidents();
    
    // Subscribe to real-time incident creations
    const handleNewIncident = (incident: Incident) => {
      // Only append to the list if we are viewing 'pending' incidents
      if (statusFilter === 'pending') {
        setIncidents(prev => [incident, ...prev]);
        toast.success(`New ${incident.type.replace('_', ' ')} reported nearby!`, {
          icon: '📍',
        });
      }
    };

    if (socketService.socket) {
      socketService.socket.on('incident:created', handleNewIncident);
    }

    return () => {
      if (socketService.socket) {
        socketService.socket.off('incident:created', handleNewIncident);
      }
    };
  }, [statusFilter]);

  const fetchIncidents = async () => {
    setLoading(true);
    try {
      const res = await api.get('/incidents/admin', { params: { status: statusFilter } });
      setIncidents(res.data.data);
    } catch (error) {
      toast.error('Failed to load incidents');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: 'verified' | 'rejected') => {
    try {
      await api.patch(`/incidents/${id}/status`, { status: newStatus });
      toast.success(`Incident ${newStatus}`);
      fetchIncidents();
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this incident permanently?')) return;
    try {
      await api.delete(`/incidents/${id}`);
      toast.success('Incident deleted');
      fetchIncidents();
    } catch (error) {
      toast.error('Failed to delete incident');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingIncident) return;
    try {
      await api.patch(`/incidents/${editingIncident.id}`, editForm);
      toast.success('Incident updated');
      setEditingIncident(null);
      fetchIncidents();
    } catch (error) {
      toast.error('Failed to update incident');
    }
  };

  const getIncidentTypeColor = (type: string) => {
    if (type === 'robbery') return 'danger';
    if (type === 'harassment') return 'warning';
    return 'info';
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{t('Safety Incidents')}</h1>
            <p className="page-subtitle">{t('Review anonymous community reports to update area safety scores.')}</p>
          </div>
          
          <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '10px', padding: 4, border: '1px solid var(--border)' }}>
            {(['pending', 'verified', 'rejected'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                style={{
                  background: statusFilter === filter ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: statusFilter === filter ? 'var(--blue)' : 'var(--text-sub)',
                  border: 'none', borderRadius: '8px', padding: '6px 16px',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                  transition: 'all 0.2s'
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-sub)' }}>
          Loading incidents...
        </div>
      ) : incidents.length === 0 ? (
        <div className="empty-state card">
          <ShieldAlert size={48} />
          <p>No {statusFilter} incidents found.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {incidents.map((incident) => (
            <div className="card" key={incident.id} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span className={`badge ${getIncidentTypeColor(incident.type)}`}>
                  {incident.type.replace('_', ' ')}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button onClick={() => { setEditingIncident(incident); setEditForm({ type: incident.type, description: incident.description }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} title="Edit"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(incident.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              
              <div style={{ fontSize: 12, color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={12} />
                {new Date(incident.createdAt).toLocaleDateString()} {new Date(incident.createdAt).toLocaleTimeString()}
              </div>

              <p style={{ fontSize: 14, color: 'var(--text)', margin: 0, fontWeight: 500, lineHeight: 1.5 }}>
                {incident.description || 'No description provided'}
              </p>
              
              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={14} />
                <span className="cell-mono">{Number(incident.latitude).toFixed(6)}, {Number(incident.longitude).toFixed(6)}</span>
              </div>
              
              {statusFilter === 'pending' && (
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                  <button 
                    className="btn btn-ghost btn-sm" 
                    style={{ flex: 1, justifyContent: 'center', color: '#ef4444' }}
                    onClick={() => handleUpdateStatus(incident.id, 'rejected')}
                  >
                    <XCircle size={14} /> Reject
                  </button>
                  <button 
                    className="btn btn-blue btn-sm" 
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => handleUpdateStatus(incident.id, 'verified')}
                  >
                    <CheckCircle size={14} /> Verify
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingIncident && (
        <div className="modal-overlay" onClick={() => setEditingIncident(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2>{t('Edit Incident')}</h2>
              <button className="btn-close" onClick={() => setEditingIncident(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="field">
                <label className="field-label">{t('Type')}</label>
                <select className="field-input" value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})}>
                  <option value="harassment">Harassment</option>
                  <option value="robbery">Robbery</option>
                  <option value="suspicious_activity">Suspicious Activity</option>
                  <option value="poor_lighting">Poor Lighting</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">{t('Description')}</label>
                <textarea 
                  className="field-input" 
                  rows={4}
                  value={editForm.description}
                  onChange={e => setEditForm({...editForm, description: e.target.value})}
                  placeholder={t('Update description...')}
                ></textarea>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setEditingIncident(null)}>{t('Cancel')}</button>
              <button className="btn btn-blue" onClick={handleSaveEdit}>{t('Save Changes')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
