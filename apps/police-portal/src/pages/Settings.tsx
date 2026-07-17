import { useState, useEffect } from 'react';
import { User, Shield, Moon, Sun, Save, Loader2, Info } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useT } from '../i18n';

export default function Settings() {
  const t = useT();
  const { user } = useAuthStore();
  const { mode, toggleTheme } = useThemeStore();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Profile Form
  const [profile, setProfile] = useState({
    fullName: '',
    email: '',
    phone: '',
    badgeNumber: user?.badgeNumber || '',
  });

  // Password Form
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await api.get('/police/profile');
      const data = res.data.data;
      setProfile({
        fullName: data.fullName || '',
        email: data.email || '',
        phone: data.phone || '',
        badgeNumber: data.badgeNumber || user?.badgeNumber || '',
      });
    } catch (error) {
      toast.error('Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.put('/police/profile', {
        phone: profile.phone,
        email: profile.email || undefined,
      });
      toast.success('Profile updated successfully');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (passwords.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setSavingPassword(true);
    try {
      await api.post('/police/auth/change-password', {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      toast.success('Password changed. You will need to log in again.');
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading settings...</div>;
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <h1 className="page-title">{t('Settings')}</h1>
        <p className="page-subtitle">{t('Manage your officer profile and security preferences.')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24 }}>
        
        {/* Profile Settings */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div className="stat-card-icon" style={{ background: 'var(--blue-dim)', color: 'var(--blue)', marginBottom: 0 }}>
              <User size={24} />
            </div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>{t('Officer Profile')}</h2>
          </div>

          <form onSubmit={handleProfileSubmit}>
            <div className="field">
              <label className="field-label">{t('Badge Number (Read-only)')}</label>
              <input type="text" className="field-input" value={profile.badgeNumber} disabled style={{ opacity: 0.7, cursor: 'not-allowed' }} />
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Info size={12} /> Contact system administrator to change badge number.
              </p>
            </div>

            <div className="field">
              <label className="field-label">{t('Full Name (Read-only)')}</label>
              <input type="text" className="field-input" value={profile.fullName} disabled style={{ opacity: 0.7, cursor: 'not-allowed' }} />
            </div>

            <div className="field">
              <label className="field-label">{t('Phone Number')}</label>
              <input type="text" className="field-input" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} required />
            </div>

            <div className="field">
              <label className="field-label">{t('Email Address')}</label>
              <input type="email" className="field-input" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} />
            </div>

            <button type="submit" className="btn btn-primary" disabled={savingProfile}>
              {savingProfile ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              Save Profile
            </button>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Theme Preferences */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div className="stat-card-icon" style={{ background: 'var(--purple-dim)', color: 'var(--purple)', marginBottom: 0 }}>
                {mode === 'dark' ? <Moon size={24} /> : <Sun size={24} />}
              </div>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>{t('Display Preferences')}</h2>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--text)' }}>{t('Theme Mode')}</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-sub)' }}>{t('Toggle between light and dark mode')}</p>
              </div>
              <button className="btn btn-ghost" onClick={toggleTheme}>
                {mode === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
              </button>
            </div>
          </div>

          {/* Security */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div className="stat-card-icon" style={{ background: 'var(--green-dim)', color: 'var(--green)', marginBottom: 0 }}>
                <Shield size={24} />
              </div>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>{t('Security')}</h2>
            </div>

            <form onSubmit={handlePasswordSubmit}>
              <div className="field">
                <label className="field-label">{t('Current Password')}</label>
                <input type="password" className="field-input" value={passwords.currentPassword} onChange={e => setPasswords({...passwords, currentPassword: e.target.value})} required />
              </div>

              <div className="field">
                <label className="field-label">New Password</label>
                <input type="password" className="field-input" value={passwords.newPassword} onChange={e => setPasswords({...passwords, newPassword: e.target.value})} required minLength={6} />
              </div>

              <div className="field">
                <label className="field-label">Confirm New Password</label>
                <input type="password" className="field-input" value={passwords.confirmPassword} onChange={e => setPasswords({...passwords, confirmPassword: e.target.value})} required minLength={6} />
              </div>

              <button type="submit" className="btn btn-danger" disabled={savingPassword}>
                {savingPassword ? <Loader2 size={16} className="spin" /> : <Shield size={16} />}
                Change Password
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
