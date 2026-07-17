import { useState, useEffect } from 'react';
import {
  Crown, Shield, UserCircle, Users as UsersIcon, KeyRound, Check,
  ChevronRight, Lock, Unlock, Plus, Trash2, Edit2, X, AlertTriangle, UserCog
} from 'lucide-react';
import api from '../services/api';

interface DynamicRole {
  id: string;
  name: string;
  key: string;
  description: string;
  isSystem: boolean;
}

const PERMISSIONS_EXPLAINED = [
  { id: 'manage_users', label: 'Manage Users', icon: '👥', color: '#3b82f6', who: 'Admin', what: 'Allows listing, creating, editing, and deleting citizen, responder, and police accounts.' },
  { id: 'manage_admins', label: 'Manage Admins', icon: '👑', color: '#a78bfa', who: 'Super Admin', what: 'Allows creating and modifying other admin accounts and their permissions.' },
  { id: 'manage_stations', label: 'Manage Stations', icon: '🏢', color: '#38bdf8', who: 'Admin', what: 'Allows creating, editing, and deactivating police station records in the system.' },
  { id: 'view_audit_logs', label: 'View Audit Logs', icon: '📋', color: '#34d399', who: 'Admin', what: 'Access to the full security audit trail of admin actions.' },
];

export default function RolesPage() {
  const [roles, setRoles] = useState<DynamicRole[]>([]);
  const [activeRoleKey, setActiveRoleKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [formData, setFormData] = useState({ id: '', name: '', key: '', description: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    try {
      const res = await api.get('/admin/roles');
      setRoles(res.data.data);
      if (res.data.data.length > 0 && !activeRoleKey) {
        setActiveRoleKey(res.data.data[0].key);
      }
    } catch (err) {
      console.error('Failed to fetch roles', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setErrorMsg('');
    setFormData({ id: '', name: '', key: '', description: '' });
    setModalMode('create');
  };

  const openEditModal = (role: DynamicRole) => {
    setErrorMsg('');
    setFormData({ id: role.id, name: role.name, key: role.key, description: role.description });
    setModalMode('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsSubmitting(true);
    
    try {
      if (modalMode === 'create') {
        await api.post('/admin/roles', { name: formData.name, key: formData.key, description: formData.description });
      } else if (modalMode === 'edit') {
        await api.put(`/admin/roles/${formData.id}`, { name: formData.name, description: formData.description });
      }
      setModalMode(null);
      fetchRoles();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.response?.data?.error?.message || 'Failed to save role');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you absolutely sure you want to delete the role "${name}"? This action cannot be undone.`)) return;
    try {
      await api.delete(`/admin/roles/${id}`);
      setActiveRoleKey(roles.find(r => r.id !== id)?.key || null);
      fetchRoles();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete role');
    }
  };

  const activeRole = roles.find(r => r.key === activeRoleKey);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading roles...</div>;

  return (
    <div className="animate-in fade-in slide-in-bottom-4 duration-500">
      <div style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>Role Management</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-sub)', fontSize: 14 }}>
            Configure platform roles and dynamic permissions securely.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
            background: 'linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%)', color: '#fff',
            borderRadius: 12, border: 'none', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', boxShadow: '0 4px 14px rgba(56, 189, 248, 0.3)', transition: 'all 0.2s'
          }}
          onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <Plus size={18} />
          Create Custom Role
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, alignItems: 'start' }}>

        {/* ─── Role List ─── */}
        <div className="card" style={{ padding: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 12px', marginBottom: 4 }}>
            Available Roles
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {roles.map(r => (
              <button
                key={r.id}
                onClick={() => setActiveRoleKey(r.key)}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px',
                  background: activeRoleKey === r.key ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                  border: `1px solid ${activeRoleKey === r.key ? 'rgba(56, 189, 248, 0.3)' : 'transparent'}`,
                  borderRadius: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'all 0.2s', position: 'relative', overflow: 'hidden'
                }}
              >
                {activeRoleKey === r.key && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: '#38bdf8' }} />}
                <div style={{ width: 38, height: 38, borderRadius: 10, background: activeRoleKey === r.key ? 'linear-gradient(135deg, #0ea5e9, #38bdf8)' : 'var(--bg-card-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: activeRoleKey === r.key ? '#fff' : 'var(--text-muted)', flexShrink: 0, transition: 'all 0.3s' }}>
                  {r.isSystem ? <Crown size={18} /> : <UserCog size={18} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: activeRoleKey === r.key ? 'var(--text)' : 'var(--text-sub)', transition: 'all 0.2s' }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{r.isSystem ? 'System Default' : 'Custom Role'}</div>
                </div>
                {activeRoleKey === r.key && <ChevronRight size={16} color="#38bdf8" />}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Role Detail ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {activeRole ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-card)', boxShadow: '0 8px 30px rgba(0,0,0,0.04)' }}>
              
              {/* Header Banner */}
              <div style={{ padding: 32, background: 'linear-gradient(135deg, rgba(56,189,248,0.05), rgba(14,165,233,0.02))', borderBottom: '1px solid var(--border)', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ width: 72, height: 72, borderRadius: 20, background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 12px 30px rgba(56,189,248,0.3)' }}>
                      {activeRole.isSystem ? <Crown size={32} /> : <UserCog size={32} />}
                    </div>
                    <div>
                      <h2 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>{activeRole.name}</h2>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <code style={{ fontSize: 13, color: '#38bdf8', background: 'rgba(56,189,248,0.1)', padding: '4px 10px', borderRadius: 8, fontWeight: 600 }}>{activeRole.key}</code>
                        {activeRole.isSystem ? (
                          <span style={{ fontSize: 13, color: '#eab308', background: 'rgba(234,179,8,0.1)', padding: '4px 10px', borderRadius: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Lock size={14} /> Core System Role
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '4px 10px', borderRadius: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Unlock size={14} /> Custom Role
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Body Content */}
              <div style={{ padding: 32 }}>
                <div style={{ marginBottom: 32 }}>
                  <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</h3>
                  <p style={{ margin: 0, fontSize: 15, color: 'var(--text-sub)', lineHeight: 1.6, background: 'var(--bg-card-alt)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
                    {activeRole.description || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No description provided for this role.</span>}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
                  <button 
                    onClick={() => openEditModal(activeRole)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: 'var(--bg-card-alt)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(56,189,248,0.05)'}
                    onMouseOut={e => e.currentTarget.style.background = 'var(--bg-card-alt)'}
                  >
                    <Edit2 size={16} /> Edit Role
                  </button>
                  
                  {!activeRole.isSystem ? (
                    <button 
                      onClick={() => handleDelete(activeRole.id, activeRole.name)} 
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                      onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.05)'}
                    >
                      <Trash2 size={16} /> Delete Role
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: 'var(--bg-card)', border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
                      <AlertTriangle size={16} /> System roles cannot be deleted
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 60, textAlign: 'center', border: '1px dashed var(--border)' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-card-alt)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <UsersIcon size={28} />
              </div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--text)', fontSize: 18 }}>No Role Selected</h3>
              <p style={{ margin: 0, color: 'var(--text-sub)' }}>Select a role from the sidebar to view details and manage it.</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Create/Edit Modal ─── */}
      {modalMode && (
        <div style={{ 
          position: 'fixed', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div className="card" style={{ 
            width: 480, padding: 0, overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
            animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card-alt)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  {modalMode === 'create' ? <Plus size={20} /> : <Edit2 size={20} />}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                    {modalMode === 'create' ? 'Create Custom Role' : 'Edit Role'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-sub)' }}>
                    {modalMode === 'create' ? 'Define a new set of permissions.' : `Modifying ${formData.name}.`}
                  </p>
                </div>
              </div>
              <button onClick={() => setModalMode(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 8, borderRadius: 8, display: 'flex' }} onMouseOver={e => e.currentTarget.style.background = 'var(--bg-card)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} style={{ padding: 32 }}>
              {errorMsg && (
                <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
                  <AlertTriangle size={16} /> {errorMsg}
                </div>
              )}
              
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Role Name</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Moderator" style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', fontSize: 15, transition: 'all 0.2s', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#38bdf8'} onBlur={e => e.target.style.borderColor = 'var(--border)'} />
              </div>
              
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Role Key <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Internal ID)</span></label>
                <input 
                  required 
                  disabled={modalMode === 'edit'} // Usually shouldn't change keys once assigned
                  value={formData.key} 
                  onChange={e => setFormData({ ...formData, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} 
                  placeholder="e.g. moderator" 
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: modalMode === 'edit' ? 'var(--bg-card-alt)' : 'var(--bg-input)', color: modalMode === 'edit' ? 'var(--text-muted)' : 'var(--text)', fontSize: 15, outline: 'none', cursor: modalMode === 'edit' ? 'not-allowed' : 'text' }} 
                />
                {modalMode === 'edit' && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>The unique role key cannot be changed after creation.</div>}
              </div>
              
              <div style={{ marginBottom: 32 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Optional)</span></label>
                <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="What can this role do?" rows={3} style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', fontSize: 15, resize: 'none', outline: 'none', transition: 'all 0.2s' }} onFocus={e => e.target.style.borderColor = '#38bdf8'} onBlur={e => e.target.style.borderColor = 'var(--border)'} />
              </div>
              
              {/* Modal Footer */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 24, margin: '0 -32px -32px', paddingBottom: 32, paddingRight: 32, paddingLeft: 32, background: 'var(--bg-card-alt)' }}>
                <button type="button" onClick={() => setModalMode(null)} style={{ padding: '12px 20px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'var(--bg-input)'} onMouseOut={e => e.currentTarget.style.background = 'var(--bg-card)'}>
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', border: 'none', color: '#fff', cursor: isSubmitting ? 'wait' : 'pointer', fontWeight: 600, opacity: isSubmitting ? 0.7 : 1, transition: 'all 0.2s', boxShadow: '0 4px 14px rgba(56, 189, 248, 0.3)' }} onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'} onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}>
                  {isSubmitting ? 'Saving...' : modalMode === 'create' ? 'Create Role' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
