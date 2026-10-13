/**
 * Photos and videos attached to an incident report — view, play, download,
 * add (admin) and delete. Files are fetched through the authenticated API as
 * blobs; nothing is reachable by a public URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, Film, ImagePlus, Loader2, Play, Trash2, X, ImageOff } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { socketService } from '../services/socket';
import { useT, fmt } from '../i18n';
import ConfirmDialog from './ConfirmDialog';

export interface IncidentMediaItem {
  id: string;
  incidentId: string;
  type: 'photo' | 'video' | string;
  mimeType: string;
  sizeBytes: number;
  source: 'reporter' | 'admin' | string;
  uploadedAt: string;
}

const MAX_MEDIA = 5;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/3gpp';

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const errMsg = (e: any, fb: string) => e?.response?.data?.error?.message || e?.response?.data?.message || fb;

/** Object-URL cache for one gallery instance; revoked on unmount. */
function useBlobUrls() {
  const urls = useRef(new Map<string, string>());
  const [, force] = useState(0);
  const loading = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current.clear(); }, []);
  const load = useCallback(async (id: string) => {
    if (urls.current.has(id) || loading.current.has(id)) return;
    loading.current.add(id);
    failed.current.delete(id);
    force((n) => n + 1);
    try {
      const res = await api.get(`/incidents/media/${id}/raw`, { responseType: 'blob', timeout: 120_000 });
      urls.current.set(id, URL.createObjectURL(res.data));
    } catch {
      failed.current.add(id);
    } finally {
      loading.current.delete(id);
      force((n) => n + 1);
    }
  }, []);
  const drop = (id: string) => {
    const u = urls.current.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.current.delete(id);
  };
  return { get: (id: string) => urls.current.get(id), isLoading: (id: string) => loading.current.has(id), hasFailed: (id: string) => failed.current.has(id), load, drop };
}

export default function IncidentMediaGallery({ incidentId, onCountChange }: { incidentId: string; onCountChange?: (n: number) => void }) {
  const [items, setItems] = useState<IncidentMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const blobs = useBlobUrls();
  const fileInput = useRef<HTMLInputElement>(null);
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState<IncidentMediaItem | null>(null);
  const kindLabel = (type: string) => (type === 'video' ? t('video') : t('photo'));
  const sourceLabel = (src: string) => (src === 'admin' ? t('added by admin') : t('from reporter'));

  const fetchList = useCallback(async () => {
    try {
      const res = await api.get(`/incidents/${incidentId}/media`);
      const list: IncidentMediaItem[] = res.data?.data ?? [];
      setItems(list);
      onCountChange?.(list.length);
    } catch (e: any) {
      if (e?.response?.status !== 404) toast.error(errMsg(e, t('Could not load attachments')));
    } finally {
      setLoading(false);
    }
  }, [incidentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setLoading(true); void fetchList(); }, [fetchList]);

  // Photos load straight away; videos only when opened (they can be 50 MB).
  useEffect(() => { items.filter((m) => m.type === 'photo').forEach((m) => void blobs.load(m.id)); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // A reporter's upload arriving while the report is open.
  useEffect(() => {
    const onMedia = (e: { incidentId: string }) => { if (e?.incidentId === incidentId) void fetchList(); };
    socketService.on('incident:media', onMedia);
    return () => { socketService.off('incident:media', onMedia); };
  }, [incidentId, fetchList]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(0, MAX_MEDIA - items.length));
    if (files.length > list.length) toast.error(fmt(t('A report can have at most {n} photos or videos.'), { n: MAX_MEDIA }));
    for (const f of list) {
      const isVideo = f.type.startsWith('video/');
      if (!ACCEPT.split(',').includes(f.type)) { toast.error(`${f.name}: ${t('use JPEG, PNG, WebP, MP4, MOV, WebM or 3GP.')}`); continue; }
      if (f.size > (isVideo ? MAX_VIDEO : MAX_IMAGE)) { toast.error(`${f.name}: ${fmt(isVideo ? t('videos can be at most {n} MB.') : t('photos can be at most {n} MB.'), { n: isVideo ? 50 : 10 })}`); continue; }
      setUploading({ name: f.name, pct: 0 });
      try {
        const fd = new FormData();
        fd.append('file', f, f.name);
        await api.post(`/incidents/${incidentId}/media`, fd, {
          // The instance default is JSON, which would make axios serialise the
          // FormData; with multipart the browser adds the boundary itself.
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 180_000,
          onUploadProgress: (e) => e.total && setUploading({ name: f.name, pct: Math.round((e.loaded / e.total) * 100) }),
        });
        toast.success(fmt(t('{name} added'), { name: f.name }));
      } catch (e) {
        toast.error(`${f.name}: ${errMsg(e, t('upload failed'))}`);
      }
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = '';
    await fetchList();
  };

  const remove = async (m: IncidentMediaItem) => {
    setDeleting(m.id);
    try {
      await api.delete(`/incidents/media/${m.id}`);
      blobs.drop(m.id);
      const next = items.filter((x) => x.id !== m.id);
      setItems(next);
      onCountChange?.(next.length);
      setViewer(null);
      toast.success(t('Attachment deleted'));
    } catch (e) {
      toast.error(errMsg(e, t('Could not delete')));
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  const open = (i: number) => {
    setViewer(i);
    void blobs.load(items[i].id);
  };

  // Keyboard navigation in the viewer
  useEffect(() => {
    if (viewer === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewer(null);
      if (e.key === 'ArrowRight' && viewer < items.length - 1) open(viewer + 1);
      if (e.key === 'ArrowLeft' && viewer > 0) open(viewer - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const tile: React.CSSProperties = {
    position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
    border: '1px solid var(--border)', background: 'var(--bg-card-alt)', padding: 0,
  };
  const cur = viewer !== null ? items[viewer] : null;
  const curUrl = cur ? blobs.get(cur.id) : undefined;

  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg-card-alt,rgba(0,0,0,0.04))', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1 }}>
          {t('Photos & videos')} {!loading && `(${items.length}/${MAX_MEDIA})`}
        </div>
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void upload(e.target.files)} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!!uploading || loading || items.length >= MAX_MEDIA} onClick={() => fileInput.current?.click()}>
          {uploading ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />} {uploading ? `${uploading.pct}%` : t('Add')}
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ ...tile, cursor: 'default', opacity: 0.5 }} />)}
        </div>
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {t('No photos or videos were attached. You can add some (for example CCTV stills) with Add.')}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {items.map((m, i) => {
            const url = blobs.get(m.id);
            return (
              <button key={m.id} type="button" style={tile} onClick={() => open(i)} title={`${kindLabel(m.type)} · ${fmtSize(m.sizeBytes)} · ${sourceLabel(m.source)}`}>
                {m.type === 'photo' ? (
                  url ? <img src={url} alt={t('Attached photo')} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : blobs.hasFailed(m.id) ? <ImageOff size={22} color="var(--text-muted)" />
                      : <Loader2 size={18} className="spin" color="var(--text-muted)" />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: '#0b1512', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#fff' }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Play size={16} fill="#fff" />
                    </div>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>{fmtSize(m.sizeBytes)}</span>
                  </div>
                )}
                {m.source === 'admin' && (
                  <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5, background: 'rgba(0,0,0,.6)', color: '#fff' }}>{t('ADMIN')}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {!loading && items.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          {t('Location data was removed from these files when they were uploaded.')}
        </p>
      )}

      {/* Viewer — portalled to <body> so no transformed ancestor traps position:fixed */}
      {cur && createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('Attachment viewer')} onClick={() => setViewer(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.88)', display: 'flex', flexDirection: 'column' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', color: '#fff' }}>
            {cur.type === 'video' ? <Film size={16} /> : null}
            <span style={{ fontSize: 13, flex: 1 }}>
              {viewer! + 1} / {items.length} · {kindLabel(cur.type)} · {fmtSize(cur.sizeBytes)} · {sourceLabel(cur.source)} · {new Date(cur.uploadedAt).toLocaleString()}
            </span>
            {curUrl && (
              <a href={curUrl} download={`incident-${cur.incidentId.slice(0, 8)}-${viewer! + 1}.${cur.mimeType.split('/')[1]?.replace('quicktime', 'mov').replace('jpeg', 'jpg') ?? 'bin'}`}
                className="btn btn-ghost btn-sm" style={{ color: '#fff', background: 'rgba(255,255,255,.1)', borderColor: 'rgba(255,255,255,.2)' }}>
                <Download size={14} /> {t('Download')}
              </a>
            )}
            <button type="button" className="btn btn-sm" disabled={deleting === cur.id} onClick={() => setConfirmDelete(cur)}
              style={{ color: '#fecaca', background: 'rgba(239,68,68,.18)', border: '1px solid rgba(239,68,68,.4)' }}>
              {deleting === cur.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {t('Delete')}
            </button>
            <button type="button" aria-label={t('Close')} onClick={() => setViewer(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }}><X size={22} /></button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 0, padding: '0 56px 24px' }}>
            {viewer! > 0 && (
              <button type="button" aria-label={t('Previous')} onClick={(e) => { e.stopPropagation(); open(viewer! - 1); }}
                style={{ position: 'absolute', left: 12, background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: '50%', width: 40, height: 40, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft /></button>
            )}
            <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex' }}>
              {!curUrl ? (
                blobs.hasFailed(cur.id)
                  ? <div style={{ color: '#fff', fontSize: 14 }}>{t('This file could not be loaded.')}</div>
                  : <div style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 className="spin" /> {cur.type === 'video' ? fmt(t('Loading video ({size})…'), { size: fmtSize(cur.sizeBytes) }) : t('Loading…')}</div>
              ) : cur.type === 'video' ? (
                <video key={cur.id} src={curUrl} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 8, background: '#000' }} />
              ) : (
                <img src={curUrl} alt={t('Attached photo')} style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: 8 }} />
              )}
            </div>
            {viewer! < items.length - 1 && (
              <button type="button" aria-label={t('Next')} onClick={(e) => { e.stopPropagation(); open(viewer! + 1); }}
                style={{ position: 'absolute', right: 12, background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: '50%', width: 40, height: 40, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight /></button>
            )}
          </div>
        </div>,
        document.body,
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        danger
        title={confirmDelete?.type === 'video' ? t('Delete this video?') : t('Delete this photo?')}
        message={t('It will be permanently deleted. This cannot be undone.')}
        confirmLabel={t('Delete')}
        busy={!!confirmDelete && deleting === confirmDelete.id}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete); }}
      />
    </div>
  );
}
