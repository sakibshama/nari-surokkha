import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import IncidentHeatmap from '../components/IncidentHeatmap';
import { useThemeStore } from '../store/themeStore';
import api from '../services/api';
import { Activity, MapPin, AlertCircle, TrendingUp } from 'lucide-react';
import { useT } from '../i18n';

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

export default function Analytics() {
  const t = useT();
  const dark = useThemeStore((s) => s.mode === 'dark');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; detail: string; hint: string } | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/admin/analytics');
      if (res.data?.success && res.data.data) {
        setData(res.data.data);
      } else {
        setError({ title: 'Unexpected response from the API', detail: JSON.stringify(res.data).slice(0, 300), hint: 'Restart the API server and try again.' });
      }
    } catch (err: any) {
      console.error('[analytics]', err);
      const status: number | undefined = err?.response?.status;
      const server: string = err?.response?.data?.error?.message || err?.response?.data?.message || '';
      const base = api.defaults.baseURL ?? '';
      setError(
        !err?.response
          ? { title: 'The API server could not be reached', detail: `${base}/admin/analytics — ${err?.message ?? 'network error'}`,
              hint: 'Check that the API is running and that VITE_API_URL in apps/admin-portal/.env points to this computer\'s current address (restart the portal after changing it).' }
          : status === 401
            ? { title: 'Your session has expired', detail: server || 'HTTP 401', hint: 'Sign out and sign in again.' }
            : status === 403
              ? { title: 'Your account cannot view analytics', detail: server || 'HTTP 403', hint: 'Analytics needs the admin role.' }
              : status === 404
                ? { title: 'The analytics route was not found', detail: `HTTP 404 at ${base}/admin/analytics`, hint: 'Restart the API server so it loads the latest code.' }
                : { title: `The server returned an error (HTTP ${status})`, detail: server || 'No message from the server.',
                    hint: 'After pulling new code run, in services/api: npx prisma migrate deploy, then npx prisma generate, then restart the API. The API terminal shows the full error.' },
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-in" style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <p>{t('Loading analytics data...')}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="animate-in" style={{ padding: 24, maxWidth: 720 }}>
        <div className="card" style={{ borderColor: 'rgba(225,29,58,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <AlertCircle size={22} color="var(--emergency)" />
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>{error?.title ?? t('Failed to load analytics')}</h2>
          </div>
          {error?.detail && (
            <pre style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card-alt)', border: '1px solid var(--border)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-sub)' }}>{error.detail}</pre>
          )}
          {error?.hint && <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-sub)' }}>{error.hint}</p>}
          <button className="btn btn-primary" onClick={fetchAnalytics}><Activity size={16} /> {t('Try again')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in" style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text)' }}>{t('City Safety Analytics')}</h1>
        <button className="btn btn-primary" onClick={fetchAnalytics}>
          <Activity size={16} /> {t('Refresh Data')}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <AlertCircle size={24} color="#ef4444" />
          </div>
          <div className="stat-info">
            <span className="stat-label">Total SOS Alerts (30 Days)</span>
            <span className="stat-value">{data.trends.reduce((sum: number, t: any) => sum + t.alerts, 0)}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
            <MapPin size={24} color="#3b82f6" />
          </div>
          <div className="stat-info">
            <span className="stat-label">Reported Incidents (30 Days)</span>
            <span className="stat-value">{data.trends.reduce((sum: number, t: any) => sum + t.incidents, 0)}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginBottom: 24 }}>
        {/* Trend Line Chart */}
        <div className="card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={20} color="var(--primary)" /> 30-Day Trend
          </h2>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(val) => val.split('-').slice(1).join('/')}
                  stroke="var(--text-sub)" 
                />
                <YAxis stroke="var(--text-sub)" />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Legend />
                <Line type="monotone" dataKey="alerts" name="SOS Alerts" stroke="#ef4444" strokeWidth={2} activeDot={{ r: 8 }} />
                <Line type="monotone" dataKey="incidents" name="Incidents" stroke="#3b82f6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Incidents by Type Pie Chart */}
        <div className="card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={20} color="var(--primary)" /> Incidents by Type
          </h2>
          <div style={{ width: '100%', height: 300 }}>
            {data.incidentTypes.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-sub)' }}>
                No incidents reported
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.incidentTypes}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {data.incidentTypes.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 16px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={20} color="var(--primary)" /> {t('Incident Heatmap (Last 30 Days)')}
          </h2>
          <p style={{ margin: '8px 0 0', color: 'var(--text-sub)', fontSize: 14 }}>
            Use this map to identify high-risk areas for strategic placement of streetlights, CCTV and volunteer responders.
          </p>
        </div>
        <IncidentHeatmap
          dark={dark}
          points={(data.recentIncidents ?? [])
            .map((p: any) => ({ latitude: Number(p.latitude), longitude: Number(p.longitude), weight: Number(p.weight ?? 1), type: p.type }))
            .filter((p: any) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))}
        />
      </div>
    </div>
  );
}
