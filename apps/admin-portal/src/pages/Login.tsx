import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import FlagRoundel from '../components/FlagRoundel';
import { useT } from '../i18n';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const t = useT();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', { phone, password });
      const { user, tokens } = response.data.data;

      // SECURITY: Only allow admin users into the admin portal
      const roleKey = typeof user.role === 'string' ? user.role : user.role?.key;
      if (roleKey !== 'admin' && roleKey !== 'superadmin') {
        setError(t('Access denied. This portal is for administrators only.'));
        setLoading(false);
        return;
      }

      login(user, tokens.accessToken);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card animate-in">
        {/* Government header */}
        <div className="gov-hero" style={{ margin: 0, borderRadius: 0, padding: '30px 40px 26px' }}>
          <div className="gov-hero-inner" style={{ textAlign: 'center' }}>
            <div style={{
              width: 66, height: 66, borderRadius: 18, margin: '0 auto 16px',
              background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
            }}>
              <FlagRoundel size={40} />
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.82)' }}>
              {t('Government of Bangladesh')}
            </div>
            <h2 className="bn" style={{ margin: '4px 0 2px', fontSize: 26, fontWeight: 800, color: '#fff' }}>নারী সুরক্ষা</h2>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{t('National Women Safety Service — Admin Portal')}</p>
          </div>
        </div>
        <div className="flag-stripe" />

        <div style={{ padding: '30px 40px 34px' }}>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '12px 16px', borderRadius: 10, marginBottom: 24, fontSize: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="field">
            <label className="field-label" htmlFor="phone">{t('Phone Number')}</label>
            <input
              id="phone"
              type="text"
              className="field-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+8801…"
              required
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="password">{t('Password')}</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: 12, fontSize: 15 }}
            disabled={loading}
          >
            {loading ? t('Authenticating…') : t('Sign In')}
          </button>
        </form>

        <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          <Lock size={12} /> {t('This system is monitored. Unauthorized access is prohibited.')}
        </p>
        </div>
      </div>
    </div>
  );
}
