import { useState, useEffect } from 'react';
import { User, Shield, Moon, Sun, Save, Loader2, Info, Map as MapIcon, MessageSquare, Send } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import api from '../services/api';
import toast from 'react-hot-toast';

type SmsProvider = 'mock' | 'twilio' | 'bulksmsbd';

interface SmsConfigPublic {
  provider: SmsProvider;
  senderId: string;
  enabled: boolean;
  twilio: { accountSid: string; fromNumber: string; authTokenSet: boolean };
  bulksmsbd: { senderId: string; apiKeySet: boolean };
}

const DEFAULT_SMS: SmsConfigPublic = {
  provider: 'twilio',
  senderId: 'NariSurokkha',
  enabled: false,
  twilio: { accountSid: '', fromNumber: '', authTokenSet: false },
  bulksmsbd: { senderId: '', apiKeySet: false },
};

export default function Settings() {
  const { user } = useAuthStore();
  const { mode, toggleTheme } = useThemeStore();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Profile Form
  const [profile, setProfile] = useState({
    fullName: '',
    email: '',
    phone: user?.phone || '',
  });

  // Password Form
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Google Maps API key (system-wide config)
  const [mapsKey, setMapsKey] = useState('');
  const [savingMaps, setSavingMaps] = useState(false);

  // SMS Gateway config (system-wide, secrets encrypted at rest)
  // Starts from a default so the card always renders, even before the
  // backend responds (or if the /settings/sms route isn't live yet).
  const [sms, setSms] = useState<SmsConfigPublic>(DEFAULT_SMS);
  const [smsLoadError, setSmsLoadError] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [bulksmsApiKey, setBulksmsApiKey] = useState('');
  const [savingSms, setSavingSms] = useState(false);
  const [testNumber, setTestNumber] = useState('');
  const [testingSms, setTestingSms] = useState(false);

  useEffect(() => {
    fetchProfile();
    fetchConfig();
    fetchSmsConfig();
  }, []);

  const fetchSmsConfig = async () => {
    try {
      const res = await api.get('/settings/sms');
      if (res.data?.data) setSms(res.data.data);
      setSmsLoadError('');
    } catch (error: any) {
      // Keep the card visible with defaults; surface why it couldn't load.
      const status = error?.response?.status;
      if (status === 404) {
        setSmsLoadError('SMS settings endpoint not found — restart the API after deploying the new /settings route.');
      } else if (status === 403) {
        setSmsLoadError('You need an admin role to manage SMS settings.');
      } else {
        setSmsLoadError('Could not load saved SMS settings — showing defaults. Saving will still work once the API is reachable.');
      }
    }
  };

  const patchSms = (partial: Partial<SmsConfigPublic>) => {
    setSms((prev) => ({ ...prev, ...partial }));
  };

  const handleSmsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSms(true);
    try {
      const payload = {
        provider: sms.provider,
        senderId: sms.senderId,
        enabled: sms.enabled,
        twilio: {
          accountSid: sms.twilio.accountSid,
          fromNumber: sms.twilio.fromNumber,
          // Only send the secret if the admin typed a new one.
          ...(twilioAuthToken.trim() ? { authToken: twilioAuthToken.trim() } : {}),
        },
        bulksmsbd: {
          senderId: sms.bulksmsbd.senderId,
          ...(bulksmsApiKey.trim() ? { apiKey: bulksmsApiKey.trim() } : {}),
        },
      };
      const res = await api.put('/settings/sms', payload);
      setSms(res.data?.data);
      setTwilioAuthToken('');
      setBulksmsApiKey('');
      toast.success('SMS gateway settings saved.');
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || 'Failed to save SMS settings');
    } finally {
      setSavingSms(false);
    }
  };

  const handleSmsTest = async () => {
    if (!testNumber.trim()) {
      toast.error('Enter a phone number to send a test SMS.');
      return;
    }
    setTestingSms(true);
    try {
      const res = await api.post('/settings/sms/test', { to: testNumber.trim() });
      if (res.data?.success) {
        toast.success(`Test SMS sent via ${res.data.data.provider}.`);
      } else {
        toast.error(`Test failed: ${res.data?.data?.error || 'unknown error'}`);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || 'Failed to send test SMS');
    } finally {
      setTestingSms(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await api.get('/config');
      setMapsKey(res.data?.data?.googleMapsApiKey || '');
    } catch {
      // Non-fatal — key just stays empty.
    }
  };

  const handleMapsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMaps(true);
    try {
      await api.put('/config', { googleMapsApiKey: mapsKey.trim() });
      toast.success('Google Maps key saved. Reload alert pages to apply.');
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || error.response?.data?.message || 'Failed to save API key');
    } finally {
      setSavingMaps(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await api.get('/profile');
      const data = res.data.data;
      setProfile({
        fullName: data.profile?.fullName || '',
        email: data.email || '',
        phone: data.phone || user?.phone || '',
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
      await api.put('/profile', {
        fullName: profile.fullName,
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
      await api.post('/auth/change-password', {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      toast.success('Password changed. You will need to log in again.');
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      // We could force logout here, but the backend revokes all tokens so they will be logged out on next request anyway.
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
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your account preferences and security.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24 }}>
        
        {/* Profile Settings */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div className="stat-card-icon" style={{ background: 'var(--blue-dim)', color: 'var(--blue)', marginBottom: 0 }}>
              <User size={24} />
            </div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Profile Information</h2>
          </div>

          <form onSubmit={handleProfileSubmit}>
            <div className="field">
              <label className="field-label">Phone Number (Read-only)</label>
              <input type="text" className="field-input" value={profile.phone} disabled style={{ opacity: 0.7, cursor: 'not-allowed' }} />
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Info size={12} /> Phone number is your primary identifier and cannot be changed here.
              </p>
            </div>

            <div className="field">
              <label className="field-label">Full Name</label>
              <input type="text" className="field-input" value={profile.fullName} onChange={e => setProfile({...profile, fullName: e.target.value})} required />
            </div>

            <div className="field">
              <label className="field-label">Email Address</label>
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
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Display Preferences</h2>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--text)' }}>Theme Mode</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-sub)' }}>Toggle between light and dark mode</p>
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
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Security</h2>
            </div>

            <form onSubmit={handlePasswordSubmit}>
              <div className="field">
                <label className="field-label">Current Password</label>
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

          {/* Google Maps Integration */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div className="stat-card-icon" style={{ background: 'var(--blue-dim)', color: 'var(--blue)', marginBottom: 0 }}>
                <MapIcon size={24} />
              </div>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Google Maps Integration</h2>
            </div>

            <form onSubmit={handleMapsSubmit}>
              <div className="field">
                <label className="field-label">Google Maps API Key</label>
                <input
                  type="text"
                  className="field-input"
                  value={mapsKey}
                  onChange={e => setMapsKey(e.target.value)}
                  placeholder="AIza… (leave empty to use the free OpenStreetMap fallback)"
                  autoComplete="off"
                  spellCheck={false}
                  style={{ fontFamily: 'monospace' }}
                />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
                  Enables Google Maps (detailed places, Street View, traffic-aware routing) across the alert maps. Enable the Maps JavaScript, Directions &amp; Places APIs and restrict the key by HTTP referrer. When empty, the app uses the free OpenStreetMap map.
                </p>
              </div>

              <button type="submit" className="btn btn-primary" disabled={savingMaps}>
                {savingMaps ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                Save Maps Key
              </button>
            </form>
          </div>

          {/* SMS Gateway Integration */}
          <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div className="stat-card-icon" style={{ background: 'var(--green-dim)', color: 'var(--green)', marginBottom: 0 }}>
                  <MessageSquare size={24} />
                </div>
                <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>SMS Gateway</h2>
              </div>

              {smsLoadError && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', marginBottom: 16, borderRadius: 8, background: 'var(--amber-dim, rgba(245,158,11,0.12))', border: '1px solid rgba(245,158,11,0.35)' }}>
                  <Info size={14} style={{ marginTop: 2, flexShrink: 0, color: 'var(--amber, #f59e0b)' }} />
                  <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{smsLoadError}</span>
                </div>
              )}

              <form onSubmit={handleSmsSubmit}>
                <div className="field">
                  <label className="field-label">Provider</label>
                  <select
                    className="field-input"
                    value={sms.provider}
                    onChange={(e) => patchSms({ provider: e.target.value as SmsProvider })}
                  >
                    <option value="twilio">Twilio</option>
                    <option value="bulksmsbd">BulkSMSBD (bulksmsbd.net)</option>
                    <option value="mock">Mock (development only)</option>
                  </select>
                </div>

                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={sms.enabled}
                      onChange={(e) => patchSms({ enabled: e.target.checked })}
                    />
                    <span className="field-label" style={{ margin: 0 }}>
                      Send SMS to trusted contacts on every SOS
                    </span>
                  </label>
                </div>

                {sms.provider === 'twilio' && (
                  <>
                    <div className="field">
                      <label className="field-label">Twilio Account SID</label>
                      <input
                        type="text"
                        className="field-input"
                        value={sms.twilio.accountSid}
                        onChange={(e) => patchSms({ twilio: { ...sms.twilio, accountSid: e.target.value } })}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        autoComplete="off"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">
                        Twilio Auth Token {sms.twilio.authTokenSet && <span style={{ color: 'var(--green)' }}>· saved</span>}
                      </label>
                      <input
                        type="password"
                        className="field-input"
                        value={twilioAuthToken}
                        onChange={(e) => setTwilioAuthToken(e.target.value)}
                        placeholder={sms.twilio.authTokenSet ? '•••••••• (leave blank to keep)' : 'Enter auth token'}
                        autoComplete="new-password"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">From Number</label>
                      <input
                        type="text"
                        className="field-input"
                        value={sms.twilio.fromNumber}
                        onChange={(e) => patchSms({ twilio: { ...sms.twilio, fromNumber: e.target.value } })}
                        placeholder="+1XXXXXXXXXX"
                        autoComplete="off"
                      />
                    </div>
                  </>
                )}

                {sms.provider === 'bulksmsbd' && (
                  <>
                    <div className="field">
                      <label className="field-label">
                        API Key {sms.bulksmsbd.apiKeySet && <span style={{ color: 'var(--green)' }}>· saved</span>}
                      </label>
                      <input
                        type="password"
                        className="field-input"
                        value={bulksmsApiKey}
                        onChange={(e) => setBulksmsApiKey(e.target.value)}
                        placeholder={sms.bulksmsbd.apiKeySet ? '•••••••• (leave blank to keep)' : 'Enter API key'}
                        autoComplete="new-password"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">Sender ID</label>
                      <input
                        type="text"
                        className="field-input"
                        value={sms.bulksmsbd.senderId}
                        onChange={(e) => patchSms({ bulksmsbd: { ...sms.bulksmsbd, senderId: e.target.value } })}
                        placeholder="Approved sender / masking ID"
                        autoComplete="off"
                      />
                    </div>
                  </>
                )}

                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 16px', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} />
                  Secrets are encrypted at rest and never shown again after saving. The Twilio auth token also verifies the inbound SMS-SOS webhook.
                </p>

                <button type="submit" className="btn btn-primary" disabled={savingSms}>
                  {savingSms ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                  Save SMS Settings
                </button>
              </form>

              <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                <label className="field-label">Send a test SMS</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="field-input"
                    value={testNumber}
                    onChange={(e) => setTestNumber(e.target.value)}
                    placeholder="+8801XXXXXXXXX"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-ghost" disabled={testingSms} onClick={handleSmsTest}>
                    {testingSms ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                    Test
                  </button>
                </div>
              </div>
          </div>
        </div>

      </div>
    </div>
  );
}
