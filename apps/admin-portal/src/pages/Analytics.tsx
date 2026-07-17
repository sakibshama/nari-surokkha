import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';
import { Activity, MapPin, AlertCircle, TrendingUp } from 'lucide-react';
import { useT } from '../i18n';

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

export default function Analytics() {
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/analytics');
      if (res.data.success) {
        setData(res.data.data);
      }
    } catch (err) {
      console.error(err);
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
    return <div style={{ padding: 24 }}>Failed to load data.</div>;
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
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
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
            <MapPin size={20} color="var(--primary)" /> Incident Heatmap (Last 30 Days)
          </h2>
          <p style={{ margin: '8px 0 0', color: 'var(--text-sub)', fontSize: 14 }}>
            Use this map to identify high-risk areas for strategic placement of streetlights and police patrols.
          </p>
        </div>
        <div style={{ height: 400, width: '100%', backgroundColor: 'var(--bg-input)' }}>
          <MapContainer center={[23.8103, 90.4125]} zoom={12} style={{ height: '100%', width: '100%' }}>
            {/* Dark mode friendly map tiles */}
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            />
            {data.recentIncidents?.map((incident: any, idx: number) => (
              <CircleMarker 
                key={idx}
                center={[incident.latitude, incident.longitude]}
                radius={8}
                pathOptions={{
                  fillColor: '#ef4444',
                  fillOpacity: 0.6,
                  color: '#b91c1c',
                  weight: 1
                }}
              >
                <Popup>
                  <div style={{ padding: 4 }}>
                    <strong>{incident.type}</strong><br/>
                    {new Date(incident.createdAt).toLocaleDateString()}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
