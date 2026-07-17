import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, FileImage, Mic } from 'lucide-react';
import { useAlertStore } from '../store/alertStore';
import api from '../services/api';
import { socketService } from '../services/socket';
import LiveLocationMap from '../components/SmartLocationMap';

export default function AlertDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { alerts, updateAlertStatus } = useAlertStore();
  const [alert, setAlert] = useState(alerts.find((a) => a.id === id));
  const [loadingAction, setLoadingAction] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const [evidence, setEvidence] = useState<any[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState(true);

  const [stations, setStations] = useState<any[]>([]);
  const [responders, setResponders] = useState<any[]>([]);

  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      try {
        const [alertRes, evidenceRes, stationsRes, respondersRes] = await Promise.all([
          alerts.find((a) => a.id === id) ? Promise.resolve({ data: { data: alerts.find((a) => a.id === id) } }) : api.get(`/police/alerts/${id}`),
          api.get(`/evidence/alerts/${id}`),
          api.get(`/police/stations`),
          api.get(`/police/responders`)
        ]);
        if (isMounted) {
          setAlert(alertRes.data.data);
          setEvidence(evidenceRes.data.data);
          setStations(stationsRes.data.data || []);
          setResponders(respondersRes.data.data || []);
          setLoadingEvidence(false);
        }
      } catch (err) {
        console.error('Failed to fetch data', err);
        if (isMounted) setLoadingEvidence(false);
      }
    };

    const fetchEvidenceOnly = async () => {
      try {
        const evidenceRes = await api.get(`/evidence/alerts/${id}`);
        if (isMounted) setEvidence(evidenceRes.data.data);
      } catch (err) {
        console.error('Failed to refetch evidence', err);
      }
    };

    if (id) fetchData();

    // WebSocket Integration
    socketService.connect();
    if (socketService.socket) {
      socketService.socket.on('alert:location_update', (data: any) => {
        if (data.alertId === id) {
          setAlert(prev => prev ? { ...prev, latitude: data.latitude, longitude: data.longitude } : prev);
        }
      });
      socketService.socket.on('alert_status_update', (data: any) => {
        if (data.alertId === id) {
          setAlert(prev => prev ? { ...prev, status: data.status } : prev);
        }
      });
      socketService.socket.on('evidence_uploaded', (data: any) => {
        if (data.alertId === id) {
          fetchEvidenceOnly();
        }
      });
      socketService.socket.on('webrtc:mode_changed', (data: any) => {
        if (data.alertId === id) {
          setIsAudioOnly(data.isAudioOnly);
        }
      });
      socketService.socket.on('webrtc:signal', async (data: any) => {
        if (data.alertId === id) {
          if (!pcRef.current) {
            const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            pcRef.current = pc;

            pc.onicecandidate = (e) => {
              if (e.candidate) socketService.socket?.emit('webrtc:signal', { alertId: id, signal: { type: 'candidate', candidate: e.candidate } });
            };

            pc.ontrack = (e) => {
              if (videoRef.current) {
                videoRef.current.srcObject = e.streams[0];
              }
            };
          }
          const pc = pcRef.current;
          try {
            if (data.signal.type === 'offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socketService.socket?.emit('webrtc:signal', { alertId: id, signal: pc.localDescription });
            } else if (data.signal.type === 'answer') {
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
      isMounted = false;
      if (socketService.socket) {
        socketService.socket.off('alert:location_update');
        socketService.socket.off('alert_status_update');
        socketService.socket.off('evidence_uploaded');
        socketService.socket.off('webrtc:signal');
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, [alerts, id]);

  const handleViewEvidence = async (evidenceId: string) => {
    try {
      const res = await api.get(`/evidence/${evidenceId}/url`);
      window.open(res.data.url, '_blank');
    } catch (err) {
      console.error('Failed to get evidence URL', err);
      window.alert('Failed to get secure link to evidence.');
    }
  };

  const handleStatusUpdate = async (status: string) => {
    setLoadingAction(true);
    try {
      await api.patch(`/police/alerts/${id}/status`, { status });
      updateAlertStatus(id as string, status);
    } catch (err) {
      console.error('Failed to update status', err);
    } finally {
      setLoadingAction(false);
    }
  };

  if (!alert) {
    return (
      <div className="animate-in empty-state">
        <p>Alert not found.</p>
        <button className="btn btn-ghost" onClick={() => navigate('/')} style={{ marginTop: 16 }}>Back to Dashboard</button>
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

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: 24 }}>
        <div className="card" style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Alert Information</h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: 24 }}>
            <div className="detail-field">
              <span className="detail-field-label">Status</span>
              <div>{getStatusBadge(alert.status)}</div>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Victim Name</span>
              <span className="detail-field-value">{alert.user?.profile?.fullName || 'Unknown'}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Phone Number</span>
              <span className="detail-field-value cell-mono">{alert.user?.phone}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">Location (GPS)</span>
              <span className="detail-field-value cell-mono">
                {Number(alert.latitude).toFixed(6)}, {Number(alert.longitude).toFixed(6)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {alert.status !== 'in_progress' && alert.status !== 'resolved' && alert.status !== 'false_alarm' && (
              <button
                className="btn btn-blue"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => handleStatusUpdate('in_progress')}
                disabled={loadingAction}
              >
                <CheckCircle size={16} /> Acknowledge Alert
              </button>
            )}

            {alert.status === 'in_progress' && (
              <>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 4px 16px rgba(16,185,129,0.3)' }}
                  onClick={() => handleStatusUpdate('resolved')}
                  disabled={loadingAction}
                >
                  <CheckCircle size={16} /> Mark Resolved
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'center', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                  onClick={() => handleStatusUpdate('false_alarm')}
                  disabled={loadingAction}
                >
                  <XCircle size={16} /> Mark False Alarm
                </button>
              </>
            )}
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

        {/* Live Video Stream */}
        <div className="card" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Live Video Feed</h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
          <div style={{ flex: 1, backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden', position: 'relative', minHeight: '200px' }}>
            {isAudioOnly ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' }}>
                <Mic size={48} color="rgba(255,255,255,0.4)" style={{ marginBottom: 12 }} />
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 500 }}>Audio-Only Stream</span>
              </div>
            ) : null}
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted={false} // Unmute to hear audio
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isAudioOnly ? 0 : 1 }} 
            />
            <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'alert-pulse 1.5s infinite' }}></div>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>LIVE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Evidence Section */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Evidence Uploaded</h2>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
        
        {loadingEvidence ? (
          <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>Loading evidence...</p>
        ) : evidence.length === 0 ? (
          <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>No evidence uploaded for this alert.</p>
        ) : (
          <div className="detail-grid">
            {evidence.map((item) => (
              <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', background: 'var(--bg-input)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <FileImage size={20} color="var(--blue)" />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.originalName}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: '16px' }}>
                  Type: {item.type} | Size: {(item.sizeBytes / 1024).toFixed(1)} KB
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => handleViewEvidence(item.id)}
                >
                  View Media
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dispatched Responders Section */}
      {(alert as any).responderDispatches && (alert as any).responderDispatches.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>Dispatched Responders</h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
          
          <div className="detail-grid">
            {(alert as any).responderDispatches.map((dispatch: any) => (
              <div key={dispatch.id} style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', background: 'var(--bg-input)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {dispatch.responder?.user?.profile?.fullName || 'Volunteer'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: '16px' }}>
                  Status: {dispatch.acceptedAt ? 'Accepted' : dispatch.rejectedAt ? 'Rejected' : 'Pending'}<br/>
                  Verified: {dispatch.verifiedAt ? 'Yes' : 'No'}
                </div>
                {dispatch.acceptedAt && !dispatch.verifiedAt && (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #10b981, #059669)' }}
                    onClick={async () => {
                      try {
                        await api.patch(`/responders/dispatch/${dispatch.id}/verify`);
                        window.alert('Responder verified successfully!');
                        // Ideally trigger a refresh
                      } catch (err) {
                        console.error(err);
                        window.alert('Failed to verify responder');
                      }
                    }}
                  >
                    Verify Help & Award Points
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
