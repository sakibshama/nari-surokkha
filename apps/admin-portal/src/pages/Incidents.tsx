import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, CheckCircle, XCircle, MapPin, Clock,
  RefreshCw, Filter, Search, Flame, Eye, TrendingUp,
  Shield, AlertCircle, Info, X, ExternalLink
} from 'lucide-react';
import api from '../services/api';
import { socketService } from '../services/socket';
import toast from 'react-hot-toast';
import { useT } from '../i18n';

interface Incident {
  id: string;
  type: string;
  description: string;
  latitude: number | string;
  longitude: number | string;
  status: string;
  createdAt: string;
}

const TYPE_META: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
  harassment:          { label: 'Harassment',          color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   Icon: AlertTriangle },
  robbery:             { label: 'Robbery',              color: '#f97316', bg: 'rgba(249,115,22,0.12)',  Icon: Flame         },
  suspicious_activity: { label: 'Suspicious Activity', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', Icon: Eye           },
  poor_lighting:       { label: 'Poor Lighting',        color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', Icon: Info          },
  other:               { label: 'Other',                color: '#64748b', bg: 'rgba(100,116,139,0.12)',Icon: AlertCircle   },
};

const STATUS_META = {
  pending:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  label: 'Pending Review' },
  verified: { color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)',  label: 'Verified'       },
  rejected: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)',   label: 'Rejected'       },
};

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function getMeta(type: string) {
  return TYPE_META[type] || { label: type.replace(/_/g,' '), color: '#64748b', bg: 'rgba(100,116,139,0.12)', Icon: AlertCircle };
}

export default function Incidents() {
  const t = useT();
  const [incidents, setIncidents]         = useState<Incident[]>([]);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [search, setSearch]               = useState('');
  const [filterStatus, setFilterStatus]   = useState('all');
  const [filterType, setFilterType]       = useState('all');
  const [selected, setSelected]           = useState<Incident | null>(null);
  const [updatingId, setUpdatingId]       = useState<string | null>(null);

  const fetchIncidents = async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const res = await api.get('/admin/incidents');
      setIncidents(res.data.data || []);
    } catch { toast.error('Failed to load incidents'); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => {
    fetchIncidents();
    const handleNew = (inc: Incident) => {
      setIncidents(p => [inc, ...p]);
      toast.success(`New ${inc.type.replace(/_/g,' ')} report!`, { icon: '📍', duration: 5000 });
    };
    socketService.socket?.on('incident:created', handleNew);
    return () => { socketService.socket?.off('incident:created', handleNew); };
  }, []);

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    try {
      await api.patch(`/admin/incidents/${id}/status`, { status });
      toast.success(status === 'verified' ? 'Incident verified ✓' : 'Incident rejected');
      setIncidents(p => p.map(i => i.id === id ? { ...i, status } : i));
      if (selected?.id === id) setSelected(s => s ? { ...s, status } : null);
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Failed to update');
    } finally { setUpdatingId(null); }
  };

  const stats = useMemo(() => ({
    total:    incidents.length,
    pending:  incidents.filter(i => i.status === 'pending').length,
    verified: incidents.filter(i => i.status === 'verified').length,
    rejected: incidents.filter(i => i.status === 'rejected').length,
  }), [incidents]);

  const filtered = useMemo(() => incidents.filter(i => {
    const q = search.toLowerCase();
    const matchQ = !q || i.type.toLowerCase().includes(q) || (i.description||'').toLowerCase().includes(q);
    const matchS  = filterStatus === 'all' || i.status === filterStatus;
    const matchT  = filterType   === 'all' || i.type   === filterType;
    return matchQ && matchS && matchT;
  }), [incidents, search, filterStatus, filterType]);

  const uniqueTypes = useMemo(() => Array.from(new Set(incidents.map(i => i.type))), [incidents]);

  /* ─────────────────────────────────────────── RENDER ─── */
  return (
    <div className="animate-in" style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16, marginBottom:28 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
            <div style={{ width:38, height:38, borderRadius:11, background:'rgba(245,158,11,0.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <AlertTriangle size={20} color="#f59e0b" />
            </div>
            <h1 className="page-title" style={{ margin:0 }}>{t('Incident Reports')}</h1>
          </div>
          <p style={{ margin:0, color:'var(--text-muted)', fontSize:13 }}>
            Crowdsourced safety reports · Verify or reject to update safety scores
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => fetchIncidents(true)} disabled={refreshing}
          style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Stat row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(155px, 1fr))', gap:14, marginBottom:22 }}>
        {[
          { label:'Total Reports',  val: stats.total,    color:'#3b82f6', Icon: TrendingUp,  bg:'rgba(59,130,246,0.1)'  },
          { label:'Pending Review', val: stats.pending,  color:'#f59e0b', Icon: Clock,       bg:'rgba(245,158,11,0.1)'  },
          { label:'Verified',       val: stats.verified, color:'#10b981', Icon: CheckCircle, bg:'rgba(16,185,129,0.1)'  },
          { label:'Rejected',       val: stats.rejected, color:'#ef4444', Icon: XCircle,     bg:'rgba(239,68,68,0.1)'   },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:s.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <s.Icon size={20} color={s.color} />
            </div>
            <div>
              <div style={{ fontSize:26, fontWeight:800, color:s.color, lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:3, fontWeight:500 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding:'13px 18px', marginBottom:18, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        {/* Search */}
        <div style={{ flex:'1 1 220px', display:'flex', alignItems:'center', gap:8, background:'var(--bg-input, var(--bg))', border:'1.5px solid var(--border)', borderRadius:10, padding:'8px 12px' }}>
          <Search size={14} color="var(--text-muted)" />
          <input type="text" placeholder="Search type or description…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ border:'none', outline:'none', background:'transparent', fontSize:13, color:'var(--text)', width:'100%' }} />
          {search && <X size={13} color="var(--text-muted)" style={{ cursor:'pointer' }} onClick={() => setSearch('')} />}
        </div>

        {/* Status pills */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Filter size={13} color="var(--text-muted)" />
          <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.05em' }}>STATUS</span>
          {['all','pending','verified','rejected'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} style={{
              padding:'4px 12px', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer',
              border: filterStatus===s ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
              background: filterStatus===s ? 'rgba(239,68,68,0.1)' : 'transparent',
              color: filterStatus===s ? 'var(--primary)' : 'var(--text-muted)', transition:'all 0.15s',
            }}>
              {s==='all' ? 'All' : s.charAt(0).toUpperCase()+s.slice(1)}
            </button>
          ))}
        </div>

        {/* Type dropdown */}
        {uniqueTypes.length > 1 && (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.05em' }}>TYPE</span>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ border:'1.5px solid var(--border)', borderRadius:8, background:'var(--bg-input,var(--bg))', color:'var(--text)', fontSize:12, padding:'5px 10px', cursor:'pointer', outline:'none' }}>
              <option value="all">All Types</option>
              {uniqueTypes.map(t => <option key={t} value={t}>{getMeta(t).label}</option>)}
            </select>
          </div>
        )}

        <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)' }}>
          {filtered.length} / {incidents.length} reports
        </span>
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="card" style={{ padding:60, textAlign:'center' }}>
          <div style={{ width:36, height:36, borderRadius:'50%', border:'3px solid var(--border)', borderTopColor:'#f59e0b', animation:'spin 0.8s linear infinite', margin:'0 auto 16px' }} />
          <p style={{ color:'var(--text-muted)', margin:0, fontSize:13 }}>{t('Loading incident reports…')}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding:'60px 40px', textAlign:'center' }}>
          <AlertTriangle size={40} color="var(--text-muted)" style={{ marginBottom:12, opacity:0.4 }} />
          <h3 style={{ margin:'0 0 6px', color:'var(--text-sub)', fontWeight:600 }}>
            {search || filterStatus!=='all' || filterType!=='all' ? 'No matching reports' : 'No Incidents Yet'}
          </h3>
          <p style={{ margin:0, color:'var(--text-muted)', fontSize:13 }}>
            {search || filterStatus!=='all' || filterType!=='all' ? 'Try clearing your filters.' : 'Community reports will appear here.'}
          </p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(330px, 1fr))', gap:16 }}>
          {filtered.map(incident => {
            const tm = getMeta(incident.type);
            const sm = STATUS_META[incident.status as keyof typeof STATUS_META] || STATUS_META.pending;
            const isUpd = updatingId === incident.id;
            return (
              <div key={incident.id} className="card"
                onClick={() => setSelected(incident)}
                style={{ padding:0, overflow:'hidden', cursor:'pointer', transition:'transform 0.17s, box-shadow 0.17s' }}
                onMouseEnter={e => { (e.currentTarget as any).style.transform='translateY(-3px)'; (e.currentTarget as any).style.boxShadow='0 10px 36px rgba(0,0,0,0.13)'; }}
                onMouseLeave={e => { (e.currentTarget as any).style.transform='translateY(0)';  (e.currentTarget as any).style.boxShadow=''; }}
              >
                {/* Accent bar */}
                <div style={{ height:4, background:`linear-gradient(90deg,${tm.color},${tm.color}55)` }} />

                <div style={{ padding:'18px 20px' }}>
                  {/* Row 1: type + status */}
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:38, height:38, borderRadius:10, background:tm.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <tm.Icon size={18} color={tm.color} />
                      </div>
                      <div>
                        <div style={{ fontWeight:700, fontSize:14, color:'var(--text)', textTransform:'capitalize' }}>{tm.label}</div>
                        <div style={{ fontSize:11, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:3, marginTop:2 }}>
                          <Clock size={10} />{timeAgo(incident.createdAt)}
                        </div>
                      </div>
                    </div>
                    <span style={{
                      fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:20, whiteSpace:'nowrap',
                      background:sm.bg, color:sm.color, border:`1px solid ${sm.border}`, letterSpacing:'0.04em'
                    }}>{sm.label}</span>
                  </div>

                  {/* Description */}
                  <p style={{ margin:'0 0 14px', fontSize:13, color:'var(--text-sub)', lineHeight:1.6,
                    display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                    {incident.description || <em style={{ color:'var(--text-muted)' }}>No description provided</em>}
                  </p>

                  {/* Location */}
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:14 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:5, background:'var(--bg-card-alt,rgba(0,0,0,0.04))', border:'1px solid var(--border)', borderRadius:8, padding:'4px 10px' }}>
                      <MapPin size={11} color="var(--text-muted)" />
                      <span style={{ fontSize:11, fontFamily:'monospace', color:'var(--text-muted)' }}>
                        {Number(incident.latitude).toFixed(4)}, {Number(incident.longitude).toFixed(4)}
                      </span>
                    </div>
                    <a href={`https://www.google.com/maps?q=${incident.latitude},${incident.longitude}`} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ display:'flex', alignItems:'center', gap:3, fontSize:11, color:'var(--blue)', textDecoration:'none', padding:'4px 8px', borderRadius:8, border:'1px solid var(--border)' }}>
                      <ExternalLink size={10} /> Map
                    </a>
                  </div>

                  {/* Action area */}
                  {incident.status === 'pending' && (
                    <div style={{ display:'flex', gap:8 }} onClick={e => e.stopPropagation()}>
                      <button disabled={isUpd} onClick={() => updateStatus(incident.id,'verified')}
                        style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'9px 0', borderRadius:10, border:'1.5px solid rgba(16,185,129,0.35)', background:'rgba(16,185,129,0.08)', color:'#10b981', fontSize:13, fontWeight:600, cursor:'pointer', transition:'background 0.15s' }}
                        onMouseEnter={e=>{(e.currentTarget as any).style.background='rgba(16,185,129,0.18)'}}
                        onMouseLeave={e=>{(e.currentTarget as any).style.background='rgba(16,185,129,0.08)'}}>
                        {isUpd ? <div style={{ width:13,height:13,borderRadius:'50%',border:'2px solid #10b981',borderTopColor:'transparent',animation:'spin 0.6s linear infinite' }} /> : <CheckCircle size={14} />}
                        Verify
                      </button>
                      <button disabled={isUpd} onClick={() => updateStatus(incident.id,'rejected')}
                        style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'9px 0', borderRadius:10, border:'1.5px solid rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.07)', color:'#ef4444', fontSize:13, fontWeight:600, cursor:'pointer', transition:'background 0.15s' }}
                        onMouseEnter={e=>{(e.currentTarget as any).style.background='rgba(239,68,68,0.15)'}}
                        onMouseLeave={e=>{(e.currentTarget as any).style.background='rgba(239,68,68,0.07)'}}>
                        {isUpd ? <div style={{ width:13,height:13,borderRadius:'50%',border:'2px solid #ef4444',borderTopColor:'transparent',animation:'spin 0.6s linear infinite' }} /> : <XCircle size={14} />}
                        Reject
                      </button>
                    </div>
                  )}
                  {incident.status === 'verified' && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', borderRadius:10, background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)' }}>
                      <Shield size={13} color="#10b981" />
                      <span style={{ fontSize:12, color:'#10b981', fontWeight:600 }}>Verified — Added to Safety Score</span>
                    </div>
                  )}
                  {incident.status === 'rejected' && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', borderRadius:10, background:'rgba(100,116,139,0.08)', border:'1px solid rgba(100,116,139,0.2)' }}>
                      <XCircle size={13} color="var(--text-muted)" />
                      <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:600 }}>Rejected</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail modal ── */}
      {selected && (() => {
        const inc = selected;
        const tm = getMeta(inc.type);
        const sm = STATUS_META[inc.status as keyof typeof STATUS_META] || STATUS_META.pending;
        const isUpd = updatingId === inc.id;
        return (
          <div onClick={() => setSelected(null)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:24, backdropFilter:'blur(4px)' }}>
            <div className="card animate-in" onClick={e => e.stopPropagation()}
              style={{ width:'100%', maxWidth:540, padding:0, overflow:'hidden', maxHeight:'90vh', overflowY:'auto' }}>

              <div style={{ height:5, background:`linear-gradient(90deg,${tm.color},${tm.color}60)` }} />

              <div style={{ padding:'24px 28px' }}>
                {/* Modal header */}
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:22 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                    <div style={{ width:52, height:52, borderRadius:16, background:tm.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <tm.Icon size={26} color={tm.color} />
                    </div>
                    <div>
                      <h2 style={{ margin:'0 0 5px', fontSize:20, fontWeight:700, color:'var(--text)', textTransform:'capitalize' }}>{tm.label}</h2>
                      <span style={{ fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20, background:sm.bg, color:sm.color, border:`1px solid ${sm.border}` }}>
                        {sm.label}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ background:'none', border:'none', cursor:'pointer', padding:4, color:'var(--text-muted)', borderRadius:8, display:'flex' }}>
                    <X size={20} />
                  </button>
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {/* Description */}
                  <div style={{ padding:'14px 16px', borderRadius:12, background:'var(--bg-card-alt,rgba(0,0,0,0.04))', border:'1px solid var(--border)' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Description</div>
                    <p style={{ margin:0, fontSize:14, color:'var(--text-sub)', lineHeight:1.7 }}>
                      {inc.description || <em style={{ color:'var(--text-muted)' }}>No description provided</em>}
                    </p>
                  </div>

                  {/* Coordinates */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    {[['Latitude', Number(inc.latitude).toFixed(6)], ['Longitude', Number(inc.longitude).toFixed(6)]].map(([k,v]) => (
                      <div key={k} style={{ padding:'12px 14px', borderRadius:10, background:'var(--bg-card-alt,rgba(0,0,0,0.04))', border:'1px solid var(--border)' }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>{k}</div>
                        <div style={{ fontFamily:'monospace', fontSize:13, color:'var(--text)', fontWeight:600 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Time */}
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderRadius:10, background:'var(--bg-card-alt,rgba(0,0,0,0.04))', border:'1px solid var(--border)' }}>
                    <Clock size={14} color="var(--text-muted)" />
                    <span style={{ fontSize:13, color:'var(--text)', fontWeight:600 }}>{new Date(inc.createdAt).toLocaleString()}</span>
                    <span style={{ fontSize:12, color:'var(--text-muted)' }}>({timeAgo(inc.createdAt)})</span>
                  </div>

                  {/* Maps link */}
                  <a href={`https://www.google.com/maps?q=${inc.latitude},${inc.longitude}`} target="_blank" rel="noopener noreferrer"
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:10, borderRadius:10, background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.2)', color:'#3b82f6', textDecoration:'none', fontSize:13, fontWeight:600 }}>
                    <MapPin size={14} /> View on Google Maps <ExternalLink size={12} />
                  </a>

                  {/* Actions */}
                  {inc.status === 'pending' && (
                    <div style={{ display:'flex', gap:10 }}>
                      <button disabled={isUpd} onClick={() => updateStatus(inc.id,'verified')}
                        style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px 0', borderRadius:12, border:'none', background:'#10b981', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', opacity: isUpd ? 0.7 : 1 }}>
                        <CheckCircle size={16} /> Verify Report
                      </button>
                      <button disabled={isUpd} onClick={() => updateStatus(inc.id,'rejected')}
                        style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px 0', borderRadius:12, border:'1.5px solid var(--border)', background:'transparent', color:'var(--text-sub)', fontSize:14, fontWeight:600, cursor:'pointer', opacity: isUpd ? 0.7 : 1 }}>
                        <XCircle size={16} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
