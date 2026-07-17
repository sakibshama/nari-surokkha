import { useState, useEffect } from 'react';
import { Shield, ShieldOff, Search, Trash2 } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

interface Responder {
  id: string;
  nationalId: string;
  organizationName: string;
  isVerified: boolean;
  createdAt: string;
  user: {
    phone: string;
    profile?: {
      fullName: string;
    };
  };
}

export default function Responders() {
  const [responders, setResponders] = useState<Responder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchResponders();
  }, [search]);

  const fetchResponders = async () => {
    try {
      const res = await api.get('/admin/responders', { params: { search } });
      setResponders(res.data.data);
    } catch (error) {
      toast.error('Failed to load responders');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, isVerified: boolean) => {
    try {
      await api.patch(`/admin/responders/${id}/verify`, { isVerified });
      toast.success(isVerified ? 'Responder verified' : 'Responder rejected');
      fetchResponders();
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this responder?')) return;
    try {
      await api.delete(`/admin/responders/${id}`);
      toast.success('Responder deleted');
      fetchResponders();
    } catch (error) {
      toast.error('Failed to delete responder');
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Responders Management</h1>
            <p className="page-subtitle">Verify and manage community responders.</p>
          </div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={18} color="var(--blue)" />
            Community Responders ({responders.length})
          </div>
          <div className="data-table-search">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Search by organization, name or phone..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>Responder Info</th>
                <th>National ID</th>
                <th>Organization</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px' }}>Loading responders...</td>
                </tr>
              ) : responders.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <Shield size={48} />
                      <p>No responders found matching your criteria.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                responders.map((responder) => (
                  <tr key={responder.id}>
                    <td>
                      <div className="cell-primary">{responder.user.profile?.fullName || 'Unknown'}</div>
                      <div className="cell-sub">{responder.user.phone}</div>
                    </td>
                    <td><span className="cell-mono">{responder.nationalId || 'N/A'}</span></td>
                    <td>{responder.organizationName || 'Individual'}</td>
                    <td>
                      {responder.isVerified ? (
                        <span className="badge success">Verified</span>
                      ) : (
                        <span className="badge warning">Pending</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        {responder.isVerified ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => handleUpdateStatus(responder.id, false)} title="Reject/Revoke">
                            <ShieldOff size={14} color="var(--amber)" />
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => handleUpdateStatus(responder.id, true)} title="Verify">
                            <Shield size={14} color="var(--green)" />
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(responder.id)} title="Delete Responder">
                          <Trash2 size={14} color="var(--red)" />
                        </button>
                      </div>
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
