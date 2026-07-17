import { useState, useEffect, useCallback } from 'react';
import {
  Users as UsersIcon, Shield, ShieldOff, Search, Plus, Trash2, Edit, X,
  ChevronDown, Crown, UserCircle, Lock, Check, AlertCircle, RefreshCw,
  Phone, Mail, Calendar, Hash, Eye, EyeOff, KeyRound
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';

interface UserProfile {
  fullName: string;
  nationalId: string;
  isVerified: boolean;
  verifiedAt: string | null;
}

interface User {
  id: string;
  phone: string;
  email: string | null;
  role: string;
  status: string;
  permissions: string[];
  createdAt: string;
  profile?: UserProfile;
}

const ROLE_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  admin:     { label: 'Admin',     color: '#a78bfa', bg: 'rgba(139,92,246,0.15)', icon: <Crown size={12} /> },
  police:    { label: 'Police',    color: '#38bdf8', bg: 'rgba(56,189,248,0.15)',  icon: <Shield size={12} /> },
  responder: { label: 'Responder', color: '#34d399', bg: 'rgba(52,211,153,0.15)', icon: <UserCircle size={12} /> },
  citizen:   { label: 'Citizen',   color: '#94a3b8', bg: 'rgba(148,163,184,0.15)', icon: <UsersIcon size={12} /> },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: 'Active',   color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  inactive: { label: 'Inactive', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  suspended:{ label: 'Suspended',color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
};

const ALL_PERMISSIONS = [
  { id: 'manage_users',    label: 'Manage Users',    desc: 'Create, edit, delete non-admin users', icon: '👥' },
  { id: 'manage_admins',   label: 'Manage Admins',   desc: 'Create and modify admin accounts', icon: '👑' },
  { id: 'manage_stations', label: 'Manage Stations', desc: 'CRUD police stations', icon: '🏢' },
  { id: 'view_audit_logs', label: 'View Audit Logs', desc: 'Access security audit trail', icon: '📋' },
];

const EMPTY_FORM = {
  phone: '', email: '', fullName: '', nationalId: '',
  role: 'citizen', password: '', permissions: [] as string[],
  badgeNumber: '', stationId: '',
};

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'details' | 'permissions'>('details');
  const [stations, setStations] = useState<any[]>([]);

  const { user: currentUser } = useAuthStore();
  const canManageAdmins = !currentUser?.permissions || currentUser.permissions.includes('manage_admins');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      const res = await api.get('/admin/users', { params });
      const data = res.data.data ?? res.data.users ?? [];
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const fetchStations = useCallback(async () => {
    try {
      const res = await api.get('/admin/stations');
      setStations(res.data.data || []);
    } catch {
      console.error('Failed to load stations');
    }
  }, []);

  useEffect(() => { fetchStations(); }, [fetchStations]);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This action is irreversible.`)) return;
    try {
      await api.delete(`/admin/users/${id}`);
      toast.success('User deleted');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to delete user');
    }
  };

  const handleToggleVerify = async (id: string, isVerified: boolean) => {
    try {
      await api.patch(`/admin/users/${id}/status`, { isVerified });
      toast.success(isVerified ? 'User verified ✓' : 'Verification removed');
      fetchUsers();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const openAdd = () => {
    setEditingUser(null);
    setFormData(EMPTY_FORM);
    setActiveTab('details');
    setShowPassword(false);
    setIsModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditingUser(u);
    setFormData({
      phone: u.phone,
      email: u.email || '',
      fullName: u.profile?.fullName || '',
      nationalId: u.profile?.nationalId || '',
      role: typeof u.role === 'object' && u.role !== null ? (u.role as any).key : u.role,
      password: '',
      permissions: u.permissions || [],
      badgeNumber: '',
      stationId: '',
    });
    setActiveTab('details');
    setShowPassword(false);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = { ...formData };
      if (!payload.password) delete (payload as any).password;
      if (editingUser) {
        await api.put(`/admin/users/${editingUser.id}`, payload);
        toast.success('User updated successfully ✓');
      } else {
        await api.post('/admin/users', payload);
        toast.success('User created successfully ✓');
      }
      setIsModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const togglePermission = (id: string) => {
    setFormData(f => ({
      ...f,
      permissions: f.permissions.includes(id)
        ? f.permissions.filter(p => p !== id)
        : [...f.permissions, id],
    }));
  };

  const selectAll = () => setFormData(f => ({ ...f, permissions: ALL_PERMISSIONS.map(p => p.id) }));
  const clearAll = () => setFormData(f => ({ ...f, permissions: [] }));

  const stats = {
    total: users.length,
    active: users.filter(u => u.status === 'active').length,
    admins: users.filter(u => (typeof u.role === 'object' && u.role !== null ? (u.role as any).key : u.role) === 'admin').length,
    verified: users.filter(u => u.profile?.isVerified).length,
  };

  const roleColors: Record<string, string> = {
    admin: '#a78bfa', police: '#38bdf8', responder: '#34d399', citizen: '#94a3b8'
  };

  const filtered = users;

  return (
    <div className="animate-in" style={{ padding: 0 }}>

      {/* ─── Page Header ─── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>
              User Management
            </h1>
            <p style={{ margin: '6px 0 0', color: 'var(--text-sub)', fontSize: 14 }}>
              Manage platform users, assign roles, and control RBAC permissions.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={fetchUsers} style={{ gap: 6, padding: '9px 16px' }}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn btn-primary" onClick={openAdd} style={{ gap: 6, padding: '9px 18px' }}>
              <Plus size={15} /> Add User
            </button>
          </div>
        </div>
      </div>

      {/* ─── Stats Row ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total Users', value: stats.total, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
          { label: 'Active',      value: stats.active, color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
          { label: 'Admins',      value: stats.admins, color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
          { label: 'Verified',    value: stats.verified, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 4, border: `1px solid ${s.color}22` }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 13, color: 'var(--text-sub)', fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ─── Filters ─── */}
      <div className="card" style={{ marginBottom: 18, padding: '14px 18px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px' }}>
          <Search size={15} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search by name, phone or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14, width: '100%' }}
          />
          {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={14} /></button>}
        </div>

        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          style={{ background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '8px 14px', fontSize: 14, outline: 'none', cursor: 'pointer' }}
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="police">Police</option>
          <option value="responder">Responder</option>
          <option value="citizen">Citizen</option>
        </select>

        <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontSize: 14 }}>Loading users…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            <UsersIcon size={44} style={{ opacity: 0.3, marginBottom: 14 }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No users found</div>
            <div style={{ fontSize: 13 }}>Try adjusting the search or filters.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['User', 'Phone', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => {
                  const roleKey = typeof u.role === 'object' && u.role !== null ? (u.role as any).key : u.role;
                  const rm = ROLE_META[roleKey as string] || ROLE_META.citizen;
                  const sm = STATUS_META[u.status] || STATUS_META.active;
                  const isRestricted = roleKey === 'admin' && !canManageAdmins;
                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: i % 2 === 0 ? 'transparent' : 'var(--bg-card-alt)',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-card-alt)')}
                    >
                      {/* User cell */}
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                            background: `linear-gradient(135deg, ${rm.color}44, ${rm.color}22)`,
                            border: `1px solid ${rm.color}44`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 14, fontWeight: 700, color: rm.color,
                          }}>
                            {(u.profile?.fullName || u.phone).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                              {u.profile?.fullName || '—'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email || 'No email'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-sub)' }}>{u.phone}</span>
                      </td>

                      {/* Role badge */}
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '4px 10px', borderRadius: 20,
                          background: rm.bg, color: rm.color,
                          fontSize: 12, fontWeight: 600,
                        }}>
                          {rm.icon} {rm.label}
                        </span>
                        {roleKey === 'admin' && (u.permissions || []).length > 0 && (
                          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                            {u.permissions.length} permission{u.permissions.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '3px 9px', borderRadius: 20,
                            background: sm.bg, color: sm.color, fontSize: 12, fontWeight: 600,
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: sm.color, display: 'inline-block' }} />
                            {sm.label}
                          </span>
                          {u.profile?.isVerified && (
                            <span style={{ fontSize: 10, color: '#34d399', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Check size={9} /> Verified
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Joined */}
                      <td style={{ padding: '14px 20px' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(u.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 20px' }}>
                        {isRestricted ? (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Lock size={11} /> Restricted
                          </span>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            {u.profile?.isVerified ? (
                              <button
                                onClick={() => handleToggleVerify(u.id, false)}
                                title="Remove Verification"
                                style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', cursor: 'pointer', color: '#f59e0b', display: 'flex', alignItems: 'center' }}
                              >
                                <ShieldOff size={13} />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleToggleVerify(u.id, true)}
                                title="Verify User"
                                style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', cursor: 'pointer', color: '#34d399', display: 'flex', alignItems: 'center' }}
                              >
                                <Shield size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(u)}
                              title="Edit User"
                              style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', cursor: 'pointer', color: '#3b82f6', display: 'flex', alignItems: 'center' }}
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              onClick={() => handleDelete(u.id, u.profile?.fullName || u.phone)}
                              title="Delete User"
                              style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Add/Edit Modal ─── */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', padding: 16 }}>
          <div className="card animate-in" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', padding: 0, border: '1px solid var(--border)' }}>

            {/* Modal Header */}
            <div style={{ padding: '24px 28px 0', borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {editingUser ? <Edit size={16} color="#fff" /> : <Plus size={16} color="#fff" />}
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
                        {editingUser ? 'Edit User' : 'Add New User'}
                      </h2>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                        {editingUser ? `Editing: ${editingUser.profile?.fullName || editingUser.phone}` : 'Fill in the details below to create a user.'}
                      </p>
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} style={{ background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-sub)', padding: '6px 8px', display: 'flex', alignItems: 'center' }}>
                  <X size={16} />
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
                {[
                  { id: 'details', label: 'User Details', icon: <UserCircle size={14} /> },
                  ...(formData.role === 'admin' && canManageAdmins ? [{ id: 'permissions', label: 'Permissions', icon: <KeyRound size={14} /> }] : []),
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    style={{
                      padding: '10px 18px',
                      border: 'none',
                      borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                      background: 'none',
                      color: activeTab === tab.id ? '#3b82f6' : 'var(--text-muted)',
                      fontWeight: activeTab === tab.id ? 600 : 400,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: -1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {tab.icon} {tab.label}
                    {tab.id === 'permissions' && formData.permissions.length > 0 && (
                      <span style={{ background: '#3b82f6', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>
                        {formData.permissions.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ padding: '24px 28px' }}>

                {activeTab === 'details' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Row 1 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Full Name</label>
                        <div style={{ position: 'relative' }}>
                          <UserCircle size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input
                            type="text" required
                            value={formData.fullName}
                            onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                            placeholder="e.g. Rina Begum"
                            style={{ width: '100%', padding: '9px 12px 9px 34px', background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Phone</label>
                        <div style={{ position: 'relative' }}>
                          <Phone size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input
                            type="text" required
                            value={formData.phone}
                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                            placeholder="+8801…"
                            style={{ width: '100%', padding: '9px 12px 9px 34px', background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Row 2 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Email</label>
                        <div style={{ position: 'relative' }}>
                          <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder="email@example.com"
                            style={{ width: '100%', padding: '9px 12px 9px 34px', background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>National ID</label>
                        <div style={{ position: 'relative' }}>
                          <Hash size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input
                            type="text"
                            value={formData.nationalId}
                            onChange={e => setFormData({ ...formData, nationalId: e.target.value })}
                            placeholder="NID number"
                            style={{ width: '100%', padding: '9px 12px 9px 34px', background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Role */}
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Role</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                        {Object.entries(ROLE_META).filter(([key]) => key !== 'admin' || canManageAdmins).map(([key, meta]) => (
                          <label
                            key={key}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                              border: `1px solid ${formData.role === key ? meta.color + '88' : 'var(--border)'}`,
                              borderRadius: 10, cursor: 'pointer',
                              background: formData.role === key ? meta.bg : 'var(--bg-card-alt)',
                              transition: 'all 0.15s',
                            }}
                          >
                            <input
                              type="radio" name="role"
                              value={key}
                              checked={formData.role === key}
                              onChange={() => setFormData({ ...formData, role: key, permissions: key !== 'admin' ? [] : formData.permissions })}
                              style={{ display: 'none' }}
                            />
                            <span style={{ color: meta.color, display: 'flex' }}>{meta.icon}</span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: formData.role === key ? meta.color : 'var(--text)' }}>{meta.label}</div>
                            </div>
                            {formData.role === key && (
                              <Check size={14} color={meta.color} style={{ marginLeft: 'auto' }} />
                            )}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Police Fields */}
                    {formData.role === 'police' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Badge Number</label>
                          <div style={{ position: 'relative' }}>
                            <Shield size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                            <input
                              type="text" required
                              value={formData.badgeNumber}
                              onChange={e => setFormData({ ...formData, badgeNumber: e.target.value })}
                              placeholder="e.g. B-12345"
                              style={{ width: '100%', padding: '9px 12px 9px 34px', background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
                            />
                          </div>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Station Assignment</label>
                          <div style={{ position: 'relative' }}>
                            <select
                              required
                              value={formData.stationId}
                              onChange={e => setFormData({ ...formData, stationId: e.target.value })}
                              style={{ width: '100%', padding: '9px 12px', background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                            >
                              <option value="">Select a Station</option>
                              {stations.map(st => (
                                <option key={st.id} value={st.id}>{st.name} ({st.thanaCode})</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Password */}
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {editingUser ? 'New Password (optional)' : 'Password'}
                      </label>
                      <div style={{ position: 'relative' }}>
                        <KeyRound size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required={!editingUser}
                          minLength={6}
                          value={formData.password}
                          onChange={e => setFormData({ ...formData, password: e.target.value })}
                          placeholder={editingUser ? 'Leave blank to keep unchanged' : 'Min 6 characters'}
                          style={{ width: '100%', padding: '9px 40px 9px 34px', background: 'var(--bg-card-alt)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    {/* Permissions hint for admin */}
                    {formData.role === 'admin' && canManageAdmins && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, fontSize: 13, color: '#60a5fa' }}>
                        <AlertCircle size={14} />
                        <span>Switch to the <strong>Permissions</strong> tab to configure what this admin can access.</span>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'permissions' && formData.role === 'admin' && canManageAdmins && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Admin Permissions</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          Grant specific capabilities to this administrator.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={selectAll} style={{ fontSize: 12, padding: '5px 12px', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, color: '#34d399', cursor: 'pointer', fontWeight: 600 }}>All</button>
                        <button type="button" onClick={clearAll} style={{ fontSize: 12, padding: '5px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}>None</button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {ALL_PERMISSIONS.map(perm => {
                        const active = formData.permissions.includes(perm.id);
                        return (
                          <label
                            key={perm.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                              border: `1px solid ${active ? 'rgba(59,130,246,0.4)' : 'var(--border)'}`,
                              borderRadius: 12, cursor: 'pointer',
                              background: active ? 'rgba(59,130,246,0.07)' : 'var(--bg-card-alt)',
                              transition: 'all 0.15s',
                            }}
                          >
                            <div style={{
                              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                              background: active ? 'rgba(59,130,246,0.15)' : 'var(--bg)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 18,
                            }}>
                              {perm.icon}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: active ? '#60a5fa' : 'var(--text)' }}>{perm.label}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{perm.desc}</div>
                            </div>
                            <div style={{
                              width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                              border: `2px solid ${active ? '#3b82f6' : 'var(--border-hover)'}`,
                              background: active ? '#3b82f6' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.15s',
                            }}>
                              {active && <Check size={12} color="#fff" strokeWidth={3} />}
                            </div>
                            <input type="checkbox" checked={active} onChange={() => togglePermission(perm.id)} style={{ display: 'none' }} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--bg-card)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px',
                    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                    border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, fontSize: 14,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.7 : 1,
                    boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
                  }}
                >
                  {submitting ? (
                    <><RefreshCw size={14} className="spin" /> Saving…</>
                  ) : (
                    <><Check size={14} /> {editingUser ? 'Save Changes' : 'Create User'}</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .spinner {
          width: 32px; height: 32px;
          border: 3px solid var(--border);
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </div>
  );
}
