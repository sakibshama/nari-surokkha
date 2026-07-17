import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, Video } from 'lucide-react';
import api from '../services/api';
import { socketService } from '../services/socket';

import LiveLocationMap from '../components/SmartLocationMap';

interface AlertDetail {
  id: string;
  type: string;
  status: string;
  isSoftAlert?: boolean;
  latitude: number | string;
  longitude: number | string;
  createdAt: string;
  user: {
    id: string;
    phone: string;
    profile?: {
      fullName: string;
      bloodGroup?: string;
    };
  };
}

export default function AlertDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<any[]>([]);
  const [responders, setResponders] = useState<any[]>([]);
  const [evidenceList, setEvidenceList] = useState<{ id: string; url: string; type: string; mimeType: string; originalName: string }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const fetchEvidence = async () => {
    try {
      const res = await api.get(`/evidence/alerts/${id}`);
      const list = res.data.data || [];
      const urls = await Promise.all(
        list.map(async (ev: any) => {
          const urlRes = await api.get(`/evidence/${ev.id}/url`);
          return {
            id: ev.id,
            url: urlRes.data.url,
            type: ev.type,
            mimeType: ev.mimeType || '',
            originalName: ev.originalName || 'evidence',
          };
        })
      );
      setEvidenceList(urls);
    } catch (err) {
      console.error('Failed to fetch evidence', err);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const alertRes = await api.get(`/admin/alerts/${id}`);
        setAlert(alertRes.data.data);
      } catch (err) {
        console.error('Failed to fetch alert', err);
      }

      // These fetch stations/responders for map markers — may fail with 403 if admin lacks permission, that's OK
      try {
        const stationsRes = await api.get(`/admin/stations`);
        setStations(stationsRes.data.data || []);
      } catch {
        // Admin may lack manage_stations permission — map still works without markers
      }

      try {
        const respondersRes = await api.get(`/admin/responders`);
        setResponders(respondersRes.data.data || []);
      } catch {
        // Admin may lack manage_users permission — map still works without markers
      }

      setLoading(false);
    };
    if (id) {
      fetchData();
      fetchEvidence();
    }

    // WebSocket Integration
    socketService.connect();
    if (socketService.socket) {
      // Join the alert-specific room so WebRTC signals are routed correctly
      socketService.socket.emit('join:alert', id);
      socketService.socket.emit('join:station', 'dispatch');

      socketService.socket.on('alert:location_update', (data: any) => {
        if (data.alertId === id) {
          setAlert(prev => prev ? { ...prev, latitude: data.latitude, longitude: data.longitude } : prev);
        }
      });
      socketService.socket.on('evidence_uploaded', (data: any) => {
        if (data.alertId === id) {
          fetchEvidence();
        }
      });
      socketService.socket.on('webrtc:mode_changed', (data: any) => {
        if (data.alertId === id) {
          setIsAudioOnly(data.isAudioOnly);
        }
      });
      socketService.socket.on('webrtc:signal', async (data: any) => {
        if (data.alertId === id) {
          if (!pcRef.current) return;

          const pc = pcRef.current;

          try {
            if (data.signal.type === 'offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              const desc = pc.localDescription;
              socketService.socket?.emit('webrtc:signal', { alertId: id, signal: { type: desc?.type, sdp: desc?.sdp } });
            } else if (data.signal.type === 'answer') {
              console.log('[WebRTC] Received answer from mobile, setting remote description');
              await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
            } else if (data.signal.type === 'candidate') {
              await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
            }
          } catch (e) {
            console.error('WebRTC error', e);
          }
        }
      });
    }

    return () => {
      if (socketService.socket) {
        socketService.socket.off('alert:location_update');
        socketService.socket.off('evidence_uploaded');
        socketService.socket.off('webrtc:signal');
        socketService.socket.off('webrtc:mode_changed');
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, [id]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-sub)' }}>
        Loading alert details...
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="animate-in">
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 24 }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="empty-state">
          <p>Alert not found.</p>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'created':
      case 'confirmed':
        return <span className="badge danger"><span className="badge-dot"></span>{status.replace('_', ' ')}</span>;
      case 'in_progress':
        return <span className="badge warning"><span className="badge-dot"></span>{status.replace('_', ' ')}</span>;
      case 'resolved':
      case 'false_alarm':
        return <span className="badge success">{status.replace('_', ' ')}</span>;
      default:
        return <span className="badge muted">{status}</span>;
    }
  };

  const lat = Number(alert.latitude);
  const lng = Number(alert.longitude);
  // Only render the map once we have a real fix — 0,0 or NaN means "no GPS yet".
  const hasValidCoords =
    Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  return (
    <div className="animate-in">
      <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 24 }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="page-header">
        <h1 className="page-title">Alert Details</h1>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Alert Information</h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="detail-field">
              <span className="detail-field-label">Status</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {getStatusBadge(alert.status)}
                {alert.isSoftAlert && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(245,158,11,0.16)', color: '#f59e0b', fontSize: 11, fontWeight: 700, border: '1px solid rgba(245,158,11,0.35)' }}>
                    ⏱ Soft Alert (pre-alarm)
                  </span>
                )}
              </div>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Type</span>
              <span className="detail-field-value" style={{ textTransform: 'uppercase' }}>{alert.type}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Victim Name</span>
              <span className="detail-field-value">{alert.user?.profile?.fullName || 'Unknown'}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Phone Number</span>
              <span className="detail-field-value">{alert.user?.phone}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Blood Group</span>
              <span className="detail-field-value">{alert.user?.profile?.bloodGroup || 'Unknown'}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Location (GPS)</span>
              <span className="detail-field-value cell-mono">
                {lat.toFixed(6)}, {lng.toFixed(6)}
              </span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Created At</span>
              <span className="detail-field-value">{new Date(alert.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', minHeight: 400, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '24px 24px 16px' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Live Location Map</h2>
          </div>
          
          <div style={{ flex: 1, position: 'relative', background: 'var(--bg-input)' }}>
            {hasValidCoords ? (
              <LiveLocationMap
                center={[lat, lng]}
                stations={stations}
                responders={responders}
                victimLabel={alert.user?.profile?.fullName || 'SOS Victim'}
              />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-sub)', flexDirection: 'column', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                Awaiting valid GPS location…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LIVE STREAM SECTION */}
      <div className="card" style={{ marginTop: 24, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
            Live Stream
          </h2>
          {alert.status !== 'resolved' && alert.status !== 'false_alarm' && alert.status !== 'closed' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button 
                className="btn btn-primary" 
                onClick={async () => {
                  if (pcRef.current) return;
                  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
                  pcRef.current = pc;
                  
                  pc.onicecandidate = (e) => {
                    if (e.candidate) {
                      const cand = e.candidate;
                      socketService.socket?.emit('webrtc:signal', { alertId: id, signal: { type: 'candidate', candidate: { candidate: cand.candidate, sdpMLineIndex: cand.sdpMLineIndex, sdpMid: cand.sdpMid } } });
                    }
                  };

                  pc.ontrack = (e) => {
                    if (videoRef.current) {
                      videoRef.current.srcObject = e.streams[0];
                    }
                  };

                  const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
                  await pc.setLocalDescription(offer);
                  const desc = pc.localDescription;
                  socketService.socket?.emit('webrtc:signal', { alertId: id, signal: { type: desc?.type, sdp: desc?.sdp } });
                }}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                Connect to Stream
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontWeight: 600, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'alert-pulse 1.5s infinite' }} />
                LIVE
                {isAudioOnly && (
                  <span className="badge warning" style={{ marginLeft: 8 }}>
                    <Mic size={12} style={{ marginRight: 4 }} />
                    Audio Only (Low Bandwidth)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div style={{ width: '100%', background: '#000', borderRadius: 8, overflow: 'hidden', minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            controls 
            style={{ width: '100%', maxHeight: '500px', objectFit: 'contain', display: isAudioOnly ? 'none' : 'block' }} 
          />
          {isAudioOnly && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#fff', gap: 16 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Mic size={32} color="#10b981" />
              </div>
              <p>Receiving Silent Audio Stream...</p>
              <audio ref={(el) => { if (el && videoRef.current) el.srcObject = videoRef.current.srcObject; }} autoPlay controls style={{ width: 300 }} />
            </div>
          )}
          {!isAudioOnly && !videoRef.current?.srcObject && alert.status !== 'resolved' && alert.status !== 'closed' && (
             <div style={{ color: '#fff', opacity: 0.5 }}>Waiting for video feed...</div>
          )}
        </div>
      </div>

      {/* EVIDENCE SECTION */}
      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Live SOS Evidence</h2>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
        {evidenceList.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-sub)' }}>
            <p>No evidence has been uploaded for this alert yet.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {evidenceList.map(ev => {
              const kind =
                ev.type === 'photo' || ev.mimeType.startsWith('image/')
                  ? 'image'
                  : ev.type === 'video' || ev.mimeType.startsWith('video/')
                    ? 'video'
                    : ev.type === 'audio' || ev.mimeType.startsWith('audio/')
                      ? 'audio'
                      : 'document';
              return (
                <div
                  key={ev.id}
                  style={{
                    borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)',
                    background: '#000', aspectRatio: kind === 'audio' || kind === 'document' ? undefined : '1 / 1',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {kind === 'image' && (
                    <img
                      src={ev.url}
                      alt={ev.originalName}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      onError={(e) => {
                        const img = e.currentTarget;
                        img.style.display = 'none';
                        const parent = img.parentElement;
                        if (parent && !parent.querySelector('.ev-fallback')) {
                          const div = document.createElement('div');
                          div.className = 'ev-fallback';
                          div.style.cssText = 'padding:24px;color:#94a3b8;font-size:13px;text-align:center;';
                          div.textContent = 'Image unavailable';
                          parent.appendChild(div);
                        }
                      }}
                    />
                  )}
                  {kind === 'video' && (
                    <video src={ev.url} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  )}
                  {kind === 'audio' && (
                    <div style={{ padding: 16, width: '100%' }}>
                      <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 8, wordBreak: 'break-all' }}>{ev.originalName}</div>
                      <audio src={ev.url} controls style={{ width: '100%' }} />
                    </div>
                  )}
                  {kind === 'document' && (
                    <a href={ev.url} target="_blank" rel="noopener noreferrer" style={{ padding: 24, color: 'var(--blue)', fontSize: 13, textAlign: 'center' }}>
                      Open {ev.originalName}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
