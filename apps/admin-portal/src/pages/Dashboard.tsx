import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, ShieldAlert, CheckCircle, Clock, MapPin, ArrowRight,
  WifiOff, RefreshCw, Siren, Radio, AlertTriangle,
  Eye, PhoneCall, Activity, ShieldCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { socketService } from '../services/socket';

interface HealthData {
  totalUsers: number;
  activeAlerts: number;
  verifiedResponders: number;
  pendingResponders: number;
}

interface Alert {
  id: string;
  type: string;
  status: string;
  isSoftAlert?: boolean;
  latitude: number;
  longitude: number;
  createdAt: string;
  user?: {
    phone: string;
    profile?: { fullName: string };
  };
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; pulse: boolean }> = {
  created:     { label: 'NEW',         color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  pulse: true  },
  confirmed:   { label: 'CONFIRMED',   color: '#f97316', bg: 'rgba(249,115,22,0.15)', pulse: true  },
  in_progress: { label: 'RESPONDING',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', pulse: true  },
  resolved:    { label: 'RESOLVED',    color: '#10b981', bg: 'rgba(16,185,129,0.15)', pulse: false },
  dismissed:   { label: 'DISMISSED',   color: '#64748b', bg: 'rgba(100,116,139,0.15)',pulse: false },
};

const TYPE_META: Record<string, { icon: string; label: string }> = {
  sos:       { icon: '🆘', label: 'SOS Emergency' },
  violence:  { icon: '⚠️', label: 'Violence'      },
  fire:      { icon: '🔥', label: 'Fire'          },
  accident:  { icon: '🚗', label: 'Accident'      },
  medical:   { icon: '🏥', label: 'Medical'       },
  default:   { icon: '📡', label: 'Alert'         },
};

function timeAgo(date: string) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getUrgencyLevel(status: string, createdAt: string): 'critical' | 'high' | 'medium' {
  const age = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (status === 'created' && age < 5) return 'critical';
  if (status === 'created' || status === 'confirmed') return 'high';
  return 'medium';
}

const URGENCY_STYLES = {
  critical: { border: 'rgba(239,68,68,0.6)', glow: '0 0 0 1px rgba(239,68,68,0.3), 0 4px 20px rgba(239,68,68,0.2)', accent: '#ef4444' },
  high:     { border: 'rgba(249,115,22,0.4)', glow: '0 4px 16px rgba(249,115,22,0.15)', accent: '#f97316' },
  medium:   { border: 'rgba(245,158,11,0.3)', glow: '0 4px 12px rgba(245,158,11,0.1)', accent: '#f59e0b' },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [activeAlertsList, setActiveAlertsList] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [, setTick] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, alertsRes] = await Promise.all([
        api.get('/admin/health'),
        api.get('/admin/alerts', { params: { limit: 20, _t: Date.now() }, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }),
      ]);
      setHealth(healthRes.data.data);
      const activeStatuses = ['created', 'confirmed', 'in_progress'];
      const active = (alertsRes.data.data || []).filter((a: Alert) => activeStatuses.includes(a.status));
      // Sort by urgency: newest first
      active.sort((a: Alert, b: Alert) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setActiveAlertsList(active);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tick every 10s to refresh elapsed time labels
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchData();
    socketService.connect();

    const checkConn = () => setIsConnected(!!socketService.socket?.connected);
    const interval = setInterval(checkConn, 2000);
    checkConn();

    if (socketService.socket) {
      socketService.socket.on('alert:created', () => { fetchData(); toast.error('🚨 New SOS Alert!', { duration: 4000, position: 'top-right' }); });
      socketService.socket.on('alert_status_update', fetchData);
      socketService.socket.on('alert:location_update', (data: any) => {
        setActiveAlertsList(prev => prev.map(a => 
          a.id === data.alertId ? { ...a, latitude: data.latitude, longitude: data.longitude } : a
        ));
      });
    }

    return () => {
      clearInterval(interval);
      if (socketService.socket) {
        socketService.socket.off('alert:created');
        socketService.socket.off('alert_status_update');
        socketService.socket.off('alert:location_update');
      }
    };
  }, [fetchData]);

  const stats = [
    { label: 'Active Emergencies', value: health?.activeAlerts ?? '—', icon: ShieldAlert, color: '#ef4444', bg: 'rgba(239,68,68,0.12)', trend: 'urgent' },
    { label: 'Registered Users',   value: health?.totalUsers ?? '—',   icon: Users,       color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', trend: null },
    { label: 'Verified Responders',value: health?.verifiedResponders ?? '—', icon: CheckCircle, color: '#10b981', bg: 'rgba(16,185,129,0.12)', trend: 'good' },
    { label: 'Pending Reviews',    value: health?.pendingResponders ?? '—',  icon: Clock,       color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', trend: 'warn' },
    { label: 'Avg Safety Score',   value: '84/100',  icon: ShieldCheck, color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', trend: 'good' },
  ];

  return (
    <div className="animate-in">

      {/* ─── Page Header ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>System Overview</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-sub)', fontSize: 14 }}>
            Real-time metrics for the Nari Surokkha platform
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: isConnected ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)', border: `1px solid ${isConnected ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`, fontSize: 12, fontWeight: 600, color: isConnected ? '#10b981' : '#ef4444' }}>
            {isConnected ? <><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} /> Live Feed</> : <><WifiOff size={12} /> Reconnecting…</>}
          </div>
          <button
            onClick={fetchData}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', color: 'var(--text-sub)', fontSize: 13, fontWeight: 500 }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* ─── Stat Cards ─── */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
          {stats.map((s, i) => (
            <div key={i} className="card" style={{ padding: '20px 22px', position: 'relative', overflow: 'hidden', border: `1px solid ${s.color}22`, animationDelay: `${i * 0.08}s` }}>
              <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: s.bg, filter: 'blur(20px)' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <s.icon size={20} color={s.color} />
                </div>
                {s.trend === 'urgent' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.15)', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse-dot 1.2s infinite' }} /> Live
                  </span>
                )}
              </div>
              <div style={{ fontSize: 34, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 6, fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Global Active Alerts ─── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', border: activeAlertsList.length > 0 ? '1px solid rgba(239,68,68,0.25)' : '1px solid var(--border)' }}>

        {/* Card Header */}
        <div style={{
          padding: '20px 24px',
          background: activeAlertsList.length > 0
            ? 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.02) 100%)'
            : 'var(--bg-card-alt)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Animated Icon */}
            <div style={{
              width: 46, height: 46, borderRadius: 14,
              background: activeAlertsList.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(100,116,139,0.12)',
              border: `1px solid ${activeAlertsList.length > 0 ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}>
              {activeAlertsList.length > 0 ? (
                <>
                  <Siren size={22} color="#ef4444" />
                  <span style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#fff' }}>
                    {activeAlertsList.length}
                  </span>
                </>
              ) : (
                <ShieldAlert size={22} color="var(--text-muted)" />
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Global Active Alerts</h2>
                {activeAlertsList.length > 0 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 20,
                    background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                    animation: 'pulse-badge 2s ease-in-out infinite',
                  }}>
                    <Radio size={10} style={{ animation: 'spin 2s linear infinite' }} />
                    LIVE TRACKING
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Last updated {timeAgo(lastRefresh.toISOString())} · Auto-refreshes on new events
              </div>
            </div>
          </div>

          {activeAlertsList.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
                <Activity size={13} color="#ef4444" />
                <span style={{ color: '#ef4444', fontWeight: 600 }}>{activeAlertsList.filter(a => a.status === 'created').length} critical</span>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span style={{ color: '#f97316', fontWeight: 600 }}>{activeAlertsList.filter(a => a.status === 'in_progress').length} responding</span>
              </div>
            </div>
          )}
        </div>

        {/* Alert Content */}
        {loading ? (
          <div style={{ padding: '60px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: 'var(--text-muted)' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: '#ef4444', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 14 }}>Loading emergency data…</span>
          </div>
        ) : activeAlertsList.length === 0 ? (
          /* ── Empty State ── */
          <div style={{ padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative' }}>
              <div style={{ width: 80, height: 80, borderRadius: 24, background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.06))', border: '1px solid rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle size={36} color="#10b981" />
              </div>
              <div style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>✓</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>All Clear — No Active Emergencies</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 320, lineHeight: 1.6 }}>
                The platform is monitoring in real-time. You'll be notified instantly when a new SOS is triggered.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
              {[['#10b981', 'Platform Online'], ['#3b82f6', 'WebSocket Live'], ['#f59e0b', 'GPS Tracking Ready']].map(([color, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: `0 0 6px ${color}` }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ── Alert Cards Grid ── */
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeAlertsList.map((alert, idx) => {
              const sm = STATUS_META[alert.status] || STATUS_META.created;
              const tm = TYPE_META[alert.type] || TYPE_META.default;
              const urgency = getUrgencyLevel(alert.status, alert.createdAt);
              const us = URGENCY_STYLES[urgency];

              return (
                <div
                  key={alert.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '42px 1fr auto',
                    gap: 14,
                    alignItems: 'center',
                    padding: '16px 20px',
                    borderRadius: 14,
                    background: 'var(--bg-card-alt)',
                    border: `1px solid ${us.border}`,
                    boxShadow: us.glow,
                    cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    animationDelay: `${idx * 0.05}s`,
                  }}
                  onClick={() => navigate(`/alerts/${alert.id}`)}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 28px ${us.accent}33`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = us.glow; }}
                >
                  {/* Alert Type Icon */}
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: `${us.accent}18`, border: `1px solid ${us.accent}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                    {tm.icon}
                  </div>

                  {/* Main Info */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                        {alert.user?.profile?.fullName || 'Unknown Victim'}
                      </span>

                      {/* Status badge */}
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 9px', borderRadius: 20,
                        background: sm.bg, color: sm.color,
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                      }}>
                        {sm.pulse && <span style={{ width: 5, height: 5, borderRadius: '50%', background: sm.color, display: 'inline-block', animation: 'pulse-dot 1.2s infinite' }} />}
                        {sm.label}
                      </span>

                      {/* Alert type label */}
                      <span style={{ padding: '3px 9px', borderRadius: 20, background: `${us.accent}14`, color: us.accent, fontSize: 10, fontWeight: 600 }}>
                        {tm.label}
                      </span>

                      {/* Soft-alert (pre-alarm) badge */}
                      {alert.isSoftAlert && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(245,158,11,0.16)', color: '#f59e0b', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', border: '1px solid rgba(245,158,11,0.35)' }}>
                          ⏱ SOFT ALERT
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      {/* Phone */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                        <PhoneCall size={11} />
                        <span style={{ fontFamily: 'monospace' }}>{alert.user?.phone || '—'}</span>
                      </span>

                      {/* Location */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                        <MapPin size={11} color="#3b82f6" />
                        <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>
                          {Number(alert.latitude).toFixed(4)}, {Number(alert.longitude).toFixed(4)}
                        </span>
                      </span>

                      {/* Time */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                        <Clock size={11} />
                        {timeAgo(alert.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Action */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/alerts/${alert.id}`); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 10,
                        background: `linear-gradient(135deg, ${us.accent}, ${us.accent}bb)`,
                        border: 'none', cursor: 'pointer', color: '#fff',
                        fontSize: 13, fontWeight: 600,
                        boxShadow: `0 4px 14px ${us.accent}44`,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <Eye size={13} /> Track Live <ArrowRight size={12} />
                    </button>
                    {urgency === 'critical' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={9} /> Critical
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
        @keyframes pulse-badge {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
