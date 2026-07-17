import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();

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
        setError('Access denied. This portal is for administrators only.');
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
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            boxShadow: '0 8px 24px rgba(239,68,68,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <ShieldAlert size={32} color="#fff" />
          </div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Admin Portal</h2>
          <p style={{ margin: '8px 0 0', color: 'var(--text-sub)', fontSize: 14 }}>Nari Surokkha — Authorized Access Only</p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '12px 16px', borderRadius: 10, marginBottom: 24, fontSize: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="field">
            <label className="field-label" htmlFor="phone">Phone Number</label>
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
            <label className="field-label" htmlFor="password">Password</label>
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
            {loading ? 'Authenticating…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          This system is monitored. Unauthorized access is prohibited.
        </p>
      </div>
    </div>
  );
}
