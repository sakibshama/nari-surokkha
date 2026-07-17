import { useState, useEffect } from 'react';
import { Building2, Search, Plus, Trash2, Edit, X } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

interface PoliceStation {
  id: string;
  name: string;
  thanaCode: string;
  district: string;
  division: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
}

export default function PoliceStations() {
  const [stations, setStations] = useState<PoliceStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStation, setEditingStation] = useState<PoliceStation | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    thanaCode: '',
    district: '',
    division: '',
    address: '',
    phone: '',
    latitude: 23.8103, // Default Dhaka
    longitude: 90.4125
  });

  useEffect(() => {
    fetchStations();
  }, [search]);

  const fetchStations = async () => {
    try {
      const res = await api.get('/admin/stations', { params: { search } });
      setStations(res.data.data);
    } catch (error) {
      toast.error('Failed to load stations');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate this station?')) return;
    try {
      await api.delete(`/admin/stations/${id}`);
      toast.success('Station deactivated');
      fetchStations();
    } catch (error) {
      toast.error('Failed to delete station');
    }
  };

  const openAddModal = () => {
    setEditingStation(null);
    setFormData({
      name: '', thanaCode: '', district: '', division: '', address: '', phone: '', latitude: 23.8103, longitude: 90.4125
    });
    setIsModalOpen(true);
  };

  const openEditModal = (station: PoliceStation) => {
    setEditingStation(station);
    setFormData({
      name: station.name,
      thanaCode: station.thanaCode,
      district: station.district,
      division: station.division,
      address: station.address || '',
      phone: station.phone,
      latitude: Number(station.latitude),
      longitude: Number(station.longitude)
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingStation) {
        await api.put(`/admin/stations/${editingStation.id}`, formData);
        toast.success('Station updated successfully');
      } else {
        await api.post('/admin/stations', formData);
        toast.success('Station created successfully');
      }
      setIsModalOpen(false);
      fetchStations();
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || error.response?.data?.message || 'Operation failed');
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Police Stations</h1>
            <p className="page-subtitle">Manage platform police stations.</p>
          </div>
          <button className="btn btn-primary" onClick={openAddModal}>
            <Plus size={16} /> Add Station
          </button>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Building2 size={18} color="var(--amber)" />
            Stations ({stations.length})
          </div>
          <div className="data-table-search">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Search by name, code or district..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>Station Name / Code</th>
                <th>Location</th>
                <th>Contact</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '40px' }}>Loading stations...</td>
                </tr>
              ) : stations.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      <Building2 size={48} />
                      <p>No police stations found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                stations.map((station) => (
                  <tr key={station.id}>
                    <td>
                      <div className="cell-primary">{station.name}</div>
                      <div className="cell-sub cell-mono">{station.thanaCode}</div>
                    </td>
                    <td>
                      <div>{station.district}, {station.division}</div>
                      <div className="cell-sub cell-mono">{Number(station.latitude).toFixed(4)}, {Number(station.longitude).toFixed(4)}</div>
                    </td>
                    <td>{station.phone}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEditModal(station)}>
                          <Edit size={14} color="var(--blue)" />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(station.id)}>
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

      {isModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
        }}>
          <div className="card animate-in" style={{ width: '100%', maxWidth: 600, padding: 32, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
            <button 
              onClick={() => setIsModalOpen(false)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 24px', color: 'var(--text)' }}>
              {editingStation ? 'Edit Station' : 'Add New Station'}
            </h2>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div className="field" style={{ flex: 2 }}>
                  <label className="field-label">Station Name</label>
                  <input type="text" className="field-input" required value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Thana Code</label>
                  <input type="text" className="field-input" required value={formData.thanaCode} onChange={(e) => setFormData({...formData, thanaCode: e.target.value})} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Division</label>
                  <input type="text" className="field-input" required value={formData.division} onChange={(e) => setFormData({...formData, division: e.target.value})} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">District</label>
                  <input type="text" className="field-input" required value={formData.district} onChange={(e) => setFormData({...formData, district: e.target.value})} />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Address</label>
                <input type="text" className="field-input" required value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} />
              </div>

              <div className="field">
                <label className="field-label">Phone</label>
                <input type="text" className="field-input" required value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Latitude</label>
                  <input type="number" step="any" className="field-input" required value={formData.latitude} onChange={(e) => setFormData({...formData, latitude: parseFloat(e.target.value)})} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Longitude</label>
                  <input type="number" step="any" className="field-input" required value={formData.longitude} onChange={(e) => setFormData({...formData, longitude: parseFloat(e.target.value)})} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingStation ? 'Save Changes' : 'Create Station'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
