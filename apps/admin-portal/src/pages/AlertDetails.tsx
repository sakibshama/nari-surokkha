import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, PlayCircle, CheckCircle2, Archive, XCircle, History } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { apiErrorMessage } from '../services/api';
import { socketService } from '../services/socket';

import LiveLocationMap from '../components/SmartLocationMap';
import ConfirmDialog from '../components/ConfirmDialog';
import { useT, fmt } from '../i18n';
import { AlertStatusBadge, ACTOR_LABEL, formatDateTime } from '../utils/alertStatus';

// Contract 7: statuses an admin can set, and which count as "active".
type AdminStatus = 'in_progress' | 'resolved' | 'closed' | 'false_alarm';
const ACTIVE_STATUSES = ['created', 'confirmed', 'notified_contacts', 'in_progress'];
const STATUS_LABEL: Record<string, string> = {
  created: 'New',
  confirmed: 'Confirmed',
  notified_contacts: 'Contacts notified',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  false_alarm: 'False alarm',
  cancelled: 'Cancelled',
};

// STUN-only FALLBACK. The authoritative ICE list (incl. TURN credential) is
// fetched from the API — see loadIceServers() — so the TURN password lives in
// one place on the server and never drifts out of sync.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

async function loadIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await api.get('/config/ice-servers');
    const list = res.data?.data?.iceServers;
    if (Array.isArray(list) && list.length) return list;
  } catch {
    /* fall back to STUN-only */
  }
  return ICE_SERVERS;
}

interface StatusEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorKind: 'user' | 'admin' | 'system' | string;
  actorId: string | null;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface AlertDetail {
  id: string;
  type: string;
  status: string;
  isSoftAlert?: boolean;
  latitude: number | string;
  longitude: number | string;
  createdAt: string;
  updatedAt?: string;
  softAlertAt?: string | null;
  softAlertCancelledAt?: string | null;
  confirmedAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  statusEvents?: StatusEvent[];
  recipients?: { id: string; notifiedAt: string | null; createdAt: string; trustedContact?: { name: string; phone: string; relation?: string | null } | null }[];
  notificationLogs?: { id: string; channel: string; recipient: string; status: string; attempts?: number; sentAt: string | null; deliveredAt?: string | null; createdAt: string }[];
  counts?: { evidence: number; locationUpdates: number; recipients: number; responderDispatches: number; notifications: number; cases: number };
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
  const t = useT();
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [responders, setResponders] = useState<any[]>([]);
  const [evidenceList, setEvidenceList] = useState<{ id: string; url: string; type: string; mimeType: string; originalName: string }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [pendingAction, setPendingAction] = useState<AdminStatus | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  // Connect as the WebRTC offerer (the role the victim's app answers).
  const connectStream = async () => {
    if (pcRef.current) return;
    const iceServers = await loadIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const c = e.candidate;
        socketService.emit('webrtc:signal', { alertId: id, signal: { type: 'candidate', candidate: { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid } } });
      }
    };
    pc.ontrack = (e) => { if (videoRef.current) videoRef.current.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) disconnectStream();
    };
    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    const d = pc.localDescription;
    socketService.emit('webrtc:signal', { alertId: id, signal: { type: d?.type, sdp: d?.sdp } });
    setStreaming(true);
  };

  const disconnectStream = () => {
    if (pcRef.current) { try { pcRef.current.close(); } catch { /* noop */ } pcRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  };
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const fetchEvidence = async () => {
    try {
      const res = await api.get(`/evidence/alerts/${id}`);
      const list = res.data.data || [];
      // Resolve each URL independently — one bad/missing file must never hide
      // the rest of the evidence (Promise.all would reject the whole batch).
      const settled = await Promise.allSettled(
        list.map(async (ev: any) => {
          const urlRes = await api.get(`/evidence/${ev.id}/url`);
          return {
            id: ev.id,
            url: urlRes.data.url as string,
            type: ev.type,
            mimeType: ev.mimeType || '',
            originalName: ev.originalName || 'evidence',
          };
        })
      );
      const urls = settled
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value);
      setEvidenceList(urls);
      const failed = settled.length - urls.length;
      if (failed > 0) toast.error(fmt(t('{n} evidence item(s) could not be loaded'), { n: failed }));
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to fetch evidence', err);
    }
  };

  // The alert record, incl. its status history. Re-run after any status
  // change so the timeline shows the new event.
  const fetchAlert = async () => {
    try {
      const alertRes = await api.get(`/admin/alerts/${id}`);
      setAlert(alertRes.data.data);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to fetch alert', err);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      await fetchAlert();

      // Responders for map markers — may fail with 403 if admin lacks permission, that's OK

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

    // WebSocket Integration — named handlers so cleanup removes ONLY ours
    // (off(event) without a handler would also remove Layout's listeners).
    socketService.connect();
    if (id) socketService.joinAlert(id); // re-joined automatically after a reconnect

    const onLocation = (data: any) => {
      if (data.alertId === id) {
        setAlert(prev => prev ? { ...prev, latitude: data.latitude, longitude: data.longitude } : prev);
      }
    };
    const onEvidence = (data: any) => {
      if (data.alertId === id) fetchEvidence();
    };
    const onMode = (data: any) => {
      if (data.alertId === id) setIsAudioOnly(data.isAudioOnly);
    };
    const onStatus = (data: { alertId: string; status: string }) => {
      if (data?.alertId === id && data.status) {
        setAlert(prev => prev ? { ...prev, status: data.status } : prev);
        void fetchAlert();
      }
    };
    const onSignal = async (data: any) => {
      if (data.alertId !== id || !pcRef.current) return;
      const pc = pcRef.current;
      try {
        if (data.signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const desc = pc.localDescription;
          socketService.emit('webrtc:signal', { alertId: id, signal: { type: desc?.type, sdp: desc?.sdp } });
        } else if (data.signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
        } else if (data.signal.type === 'candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        }
      } catch (e) {
        if (import.meta.env.DEV) console.error('WebRTC error', e);
      }
    };

    socketService.on('alert:location_update', onLocation);
    socketService.on('evidence_uploaded', onEvidence);
    socketService.on('webrtc:mode_changed', onMode);
    socketService.on('webrtc:signal', onSignal);
    socketService.on('alert_status_update', onStatus);

    return () => {
      socketService.off('alert:location_update', onLocation);
      socketService.off('evidence_uploaded', onEvidence);
      socketService.off('webrtc:mode_changed', onMode);
      socketService.off('webrtc:signal', onSignal);
      socketService.off('alert_status_update', onStatus);
      if (id) socketService.leaveAlert(id);
      if (pcRef.current) {
        try { pcRef.current.close(); } catch { /* noop */ }
        pcRef.current = null;
      }
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable map centre: a new [lat, lng] array on every render made the map
  // components re-request routes (paid Google Directions calls) each render.
  const latNum = Number(alert?.latitude);
  const lngNum = Number(alert?.longitude);
  const mapCenter = useMemo<[number, number]>(() => [latNum, lngNum], [latNum, lngNum]);

  const applyStatus = async (status: AdminStatus, note: string) => {
    if (!id) return;
    setSavingStatus(true);
    try {
      const res = await api.patch(`/admin/alerts/${id}/status`, { status, ...(note ? { note } : {}) });
      const updated = res.data?.data;
      setAlert(prev => prev ? { ...prev, status: updated?.status ?? status } : prev);
      void fetchAlert();
      toast.success(fmt(t('Alert marked as {status}'), { status: t(STATUS_LABEL[status]) }));
      setPendingAction(null);
      if (status !== 'in_progress') disconnectStream();
    } catch (err: any) {
      toast.error(err?.response?.status === 403
        ? t('You do not have permission to change this alert.')
        : apiErrorMessage(err, t('Failed to update the alert status')));
    } finally {
      setSavingStatus(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-sub)' }}>
        {t('Loading alert details…')}
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="animate-in">
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 24 }}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        <div className="empty-state">
          <p>{t('Alert not found.')}</p>
        </div>
      </div>
    );
  }

  const statusText = (status: string) => t(STATUS_LABEL[status] ?? status.replace(/_/g, ' '));
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'created':
      case 'confirmed':
      case 'notified_contacts':
        return <span className="badge danger"><span className="badge-dot"></span>{statusText(status)}</span>;
      case 'in_progress':
        return <span className="badge warning"><span className="badge-dot"></span>{statusText(status)}</span>;
      case 'resolved':
        return <span className="badge success">{statusText(status)}</span>;
      case 'false_alarm':
        return <span className="badge info">{statusText(status)}</span>;
      default:
        return <span className="badge muted">{statusText(status)}</span>;
    }
  };

  const lat = mapCenter[0];
  const lng = mapCenter[1];
  const isActive = ACTIVE_STATUSES.includes(alert.status);
  const ACTIONS: { status: AdminStatus; label: string; icon: React.ReactNode; className: string; title: string; message: string; danger?: boolean; show: boolean }[] = [
    { status: 'in_progress', label: 'Mark in progress', icon: <PlayCircle size={14} />, className: 'btn btn-blue btn-sm',
      title: 'Mark this alert as in progress?', message: 'Use this when help is on the way. The alert stays active.', show: isActive && alert.status !== 'in_progress' },
    { status: 'resolved', label: 'Resolve', icon: <CheckCircle2 size={14} />, className: 'btn btn-primary btn-sm',
      title: 'Resolve this alert?', message: 'The person is safe and the emergency is over. Live tracking for this alert ends.', show: isActive },
    { status: 'false_alarm', label: 'False alarm', icon: <XCircle size={14} />, className: 'btn btn-ghost btn-sm',
      title: 'Mark as a false alarm?', message: 'The SOS was triggered by mistake. Live tracking for this alert ends.', show: isActive },
    { status: 'closed', label: 'Close', icon: <Archive size={14} />, className: 'btn btn-danger btn-sm', danger: true,
      title: 'Close this alert?', message: 'Closing archives the alert. Use it once follow-up is complete.', show: alert.status !== 'closed' },
  ];
  const pending = ACTIONS.find(a => a.status === pendingAction) ?? null;
  // Only render the map once we have a real fix — 0,0 or NaN means "no GPS yet".
  const hasValidCoords =
    Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  return (
    <div className="animate-in">
      <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 24 }}>
        <ArrowLeft size={16} /> {t('Back')}
      </button>

      <div className="page-header">
        <div className="page-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h1 className="page-title">{t('Alert Details')}</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ACTIONS.filter(a => a.show).map(a => (
              <button key={a.status} className={a.className} onClick={() => setPendingAction(a.status)} disabled={savingStatus}>
                {a.icon} {t(a.label)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending ? t(pending.title) : ''}
        message={pending ? t(pending.message) : undefined}
        confirmLabel={pending ? t(pending.label) : undefined}
        danger={pending?.danger}
        withNote
        notePlaceholder={t('e.g. who responded, what happened')}
        busy={savingStatus}
        onCancel={() => setPendingAction(null)}
        onConfirm={(note) => { if (pending) void applyStatus(pending.status, note); }}
      />

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>{t('Alert Information')}</h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="detail-field">
              <span className="detail-field-label">{t('Status')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {getStatusBadge(alert.status)}
                {alert.isSoftAlert && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(245,158,11,0.16)', color: '#f59e0b', fontSize: 11, fontWeight: 700, border: '1px solid rgba(245,158,11,0.35)' }}>
                    ⏱ {t('Soft Alert (pre-alarm)')}
                  </span>
                )}
              </div>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">{t('Type')}</span>
              <span className="detail-field-value" style={{ textTransform: 'uppercase' }}>{alert.type}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">{t('Victim Name')}</span>
              <span className="detail-field-value">{alert.user?.profile?.fullName || t('Unknown')}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">{t('Phone Number')}</span>
              <span className="detail-field-value">{alert.user?.phone}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">{t('Blood Group')}</span>
              <span className="detail-field-value">{alert.user?.profile?.bloodGroup || t('Unknown')}</span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">{t('Location (GPS)')}</span>
              <span className="detail-field-value cell-mono">
                {lat.toFixed(6)}, {lng.toFixed(6)}
              </span>
            </div>

            <div className="detail-field">
              <span className="detail-field-label">{t('Created At')}</span>
              <span className="detail-field-value">{new Date(alert.createdAt).toLocaleString()}</span>
            </div>

            {alert.confirmedAt && (
              <div className="detail-field">
                <span className="detail-field-label">{t('Confirmed At')}</span>
                <span className="detail-field-value">{formatDateTime(alert.confirmedAt)}</span>
              </div>
            )}
            {alert.softAlertCancelledAt && (
              <div className="detail-field">
                <span className="detail-field-label">{t('Cancelled At')}</span>
                <span className="detail-field-value">{formatDateTime(alert.softAlertCancelledAt)}</span>
              </div>
            )}
            {alert.resolvedAt && (
              <div className="detail-field">
                <span className="detail-field-label">{t('Resolved At')}</span>
                <span className="detail-field-value">{formatDateTime(alert.resolvedAt)}</span>
              </div>
            )}
            {alert.closedAt && (
              <div className="detail-field">
                <span className="detail-field-label">{t('Closed At')}</span>
                <span className="detail-field-value">{formatDateTime(alert.closedAt)}</span>
              </div>
            )}
            {alert.updatedAt && (
              <div className="detail-field">
                <span className="detail-field-label">{t('Last updated')}</span>
                <span className="detail-field-value">{formatDateTime(alert.updatedAt)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', minHeight: 400, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '24px 24px 16px' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>{t('Live Location Map')}</h2>
          </div>
          
          <div style={{ flex: 1, position: 'relative', background: 'var(--bg-input)' }}>
            {hasValidCoords ? (
              <LiveLocationMap
                center={mapCenter}
                responders={responders}
                victimLabel={alert.user?.profile?.fullName || t('SOS Victim')}
              />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-sub)', flexDirection: 'column', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                {t('Awaiting valid GPS location…')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STATUS HISTORY + INCIDENT RECORD */}
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginTop: 24 }}>
        <div className="card" style={{ flex: '2 1 400px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={16} /> {t('Status history')}
          </h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
          {!alert.statusEvents || alert.statusEvents.length === 0 ? (
            <div style={{ padding: '16px 0', color: 'var(--text-sub)', fontSize: 14 }}>{t('No status history recorded for this alert.')}</div>
          ) : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {alert.statusEvents.map((ev, i) => {
                const last = i === alert.statusEvents!.length - 1;
                return (
                  <li key={ev.id} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 5, background: last ? 'var(--gov-green, #006a4e)' : 'var(--border)', border: '2px solid var(--bg-card, #fff)', boxShadow: '0 0 0 1px var(--border)' }} />
                      {!last && <span style={{ flex: 1, width: 2, background: 'var(--border)', minHeight: 24 }} />}
                    </div>
                    <div style={{ paddingBottom: last ? 0 : 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {ev.fromStatus ? (
                          <>
                            <AlertStatusBadge status={ev.fromStatus} />
                            <span style={{ color: 'var(--text-muted)' }}>→</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-sub)' }}>{t('SOS triggered')}</span>
                        )}
                        <AlertStatusBadge status={ev.toStatus} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        {formatDateTime(ev.createdAt)} · {fmt(t('by {actor}'), { actor: t(ACTOR_LABEL[ev.actorKind] ?? ev.actorKind) })}
                        {ev.metadata && (ev.metadata as { backfilled?: boolean }).backfilled ? ` · ${t('reconstructed from earlier records')}` : ''}
                      </div>
                      {ev.reason && (
                        <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{ev.reason}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="card" style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>{t('Incident record')}</h2>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
          {alert.counts && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
              {([
                ['Evidence files', alert.counts.evidence],
                ['Location updates', alert.counts.locationUpdates],
                ['Contacts notified', alert.counts.recipients],
                ['Notifications sent', alert.counts.notifications],
                ['Responders dispatched', alert.counts.responderDispatches],
                ['Cases', alert.counts.cases],
              ] as [string, number][]).map(([label, n]) => (
                <div key={label} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-card-alt)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{n}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>{t(label)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="detail-field-label" style={{ marginBottom: 8 }}>{t('Trusted contacts alerted')}</div>
          {!alert.recipients || alert.recipients.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 12 }}>{t('None recorded')}</div>
          ) : (
            <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13, color: 'var(--text)' }}>
              {alert.recipients.map(r => (
                <li key={r.id}>
                  {r.trustedContact?.name || t('Unknown')} <span className="cell-mono" style={{ color: 'var(--text-sub)' }}>{r.trustedContact?.phone}</span>
                  {r.notifiedAt && <span style={{ color: 'var(--text-muted)' }}> · {formatDateTime(r.notifiedAt)}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="detail-field-label" style={{ marginBottom: 8 }}>{t('Notifications')}</div>
          {!alert.notificationLogs || alert.notificationLogs.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>{t('None recorded')}</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table className="portal-table" style={{ fontSize: 12 }}>
                <tbody>
                  {alert.notificationLogs.map(n => (
                    <tr key={n.id}>
                      <td style={{ textTransform: 'uppercase' }}>{n.channel}</td>
                      <td className="cell-mono">{n.recipient}</td>
                      <td>{n.status}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(n.sentAt ?? n.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* LIVE STREAM SECTION */}
      <div className="card" style={{ marginTop: 24, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
            {t('Live Stream')}
          </h2>
          {isActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {streaming ? (
                <button className="btn btn-danger" onClick={disconnectStream} style={{ fontSize: 12, padding: '6px 12px' }}>
                  {t('Disconnect Stream')}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={connectStream} style={{ fontSize: 12, padding: '6px 12px' }}>
                  {t('Connect to Stream')}
                </button>
              )}
              {streaming && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontWeight: 600, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'alert-pulse 1.5s infinite' }} />
                {t('LIVE')}
                {isAudioOnly && (
                  <span className="badge warning" style={{ marginLeft: 8 }}>
                    <Mic size={12} style={{ marginRight: 4 }} />
                    {t('Audio Only (Low Bandwidth)')}
                  </span>
                )}
              </div>
              )}
            </div>
          )}
        </div>
        <div style={{ width: '100%', background: '#000', borderRadius: 8, overflow: 'hidden', minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {!streaming && (
            <div style={{ color: 'var(--text-sub)', fontSize: 14, padding: 40, textAlign: 'center' }}>
              {t('Press “Connect to Stream” to view the victim\'s live camera & audio.')}
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            controls
            style={{ width: '100%', maxHeight: '500px', objectFit: 'contain', display: (!streaming || isAudioOnly) ? 'none' : 'block' }}
          />
          {isAudioOnly && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#fff', gap: 16 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Mic size={32} color="#10b981" />
              </div>
              <p>{t('Receiving Silent Audio Stream…')}</p>
              <audio ref={(el) => { if (el && videoRef.current) el.srcObject = videoRef.current.srcObject; }} autoPlay controls style={{ width: 300 }} />
            </div>
          )}
          {streaming && !isAudioOnly && !videoRef.current?.srcObject && isActive && (
             <div style={{ color: '#fff', opacity: 0.5 }}>{t('Waiting for video feed…')}</div>
          )}
        </div>
      </div>

      {/* EVIDENCE SECTION */}
      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: 'var(--text)' }}>{t('Live SOS Evidence')}</h2>
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '0 0 16px' }} />
        {evidenceList.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-sub)' }}>
            <p>{t('No evidence has been uploaded for this alert yet.')}</p>
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
                          div.textContent = t('Image unavailable');
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
                      {t('Open')} {ev.originalName}
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
