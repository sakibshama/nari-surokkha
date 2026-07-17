import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, UploadCloud, CheckCircle2, Circle, Loader2, Database, Info } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

interface MlModel {
  id: string;
  kind: string;
  version: number;
  format: string;
  sizeBytes: number;
  checksum: string;
  isActive: boolean;
  metadata?: { metrics?: { testAccuracy?: number }; classes?: string[] };
  createdAt: string;
}

interface SampleStats {
  total: number;
  byLabel: { label: string | null; _count: { _all: number } }[];
  bySource: { source: string; _count: { _all: number } }[];
}

const KB = (n: number) => `${(n / 1024).toFixed(1)} KB`;

export default function MLModels() {
  const [models, setModels] = useState<MlModel[]>([]);
  const [stats, setStats] = useState<SampleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activateOnUpload, setActivateOnUpload] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const [m, s] = await Promise.all([
        api.get('/ml/models', { params: { kind: 'motion' } }),
        api.get('/ml/samples/stats', { params: { kind: 'motion' } }),
      ]);
      setModels(m.data?.data || []);
      setStats(s.data?.data || null);
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Failed to load ML models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const activate = async (id: string) => {
    try {
      await api.post(`/ml/models/${id}/activate`);
      toast.success('Model activated — devices will pick it up over-the-air.');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Failed to activate');
    }
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose a model file (.json or .tflite) first.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', 'motion');
      form.append('format', file.name.endsWith('.tflite') ? 'tflite' : 'json');
      form.append('activate', String(activateOnUpload));
      await api.post('/ml/models', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Model uploaded.');
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading ML models…</div>;

  const labelCounts = stats?.byLabel.filter((b) => b.label) || [];
  const unlabeled = stats?.byLabel.find((b) => b.label === null)?._count._all || 0;

  return (
    <div className="animate-in">
      <div className="page-header">
        <h1 className="page-title">On-Device ML Models</h1>
        <p className="page-subtitle">
          Manage the motion-detection model that runs on phones, and the real data collected to retrain it.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24 }}>
        {/* Model registry */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div className="stat-card-icon" style={{ background: 'var(--purple-dim)', color: 'var(--purple)', marginBottom: 0 }}>
              <BrainCircuit size={24} />
            </div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Model Registry (motion)</h2>
          </div>

          {models.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              No models registered yet. Train one with <code>services/ml-training/train.py</code> and upload the
              resulting <code>motion_model.json</code> below.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {models.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-input)',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontWeight: 600 }}>
                      v{m.version} · {m.format.toUpperCase()}
                      {m.isActive && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--green)' }}>
                          <CheckCircle2 size={13} /> Active
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {KB(m.sizeBytes)}
                      {m.metadata?.metrics?.testAccuracy != null && ` · acc ${(m.metadata.metrics.testAccuracy * 100).toFixed(1)}%`}
                      {' · '}{new Date(m.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {m.isActive ? (
                    <span style={{ color: 'var(--green)' }}><CheckCircle2 size={18} /></span>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => activate(m.id)}>
                      <Circle size={14} /> Activate
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Upload */}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <label className="field-label">Upload a trained model</label>
            <input ref={fileRef} type="file" accept=".json,.tflite" className="field-input" style={{ padding: 8 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', cursor: 'pointer', fontSize: 13, color: 'var(--text-sub)' }}>
              <input type="checkbox" checked={activateOnUpload} onChange={(e) => setActivateOnUpload(e.target.checked)} />
              Activate immediately (push to devices)
            </label>
            <button className="btn btn-primary" onClick={upload} disabled={uploading}>
              {uploading ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />}
              Upload Model
            </button>
          </div>
        </div>

        {/* Training data */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div className="stat-card-icon" style={{ background: 'var(--blue-dim)', color: 'var(--blue)', marginBottom: 0 }}>
              <Database size={24} />
            </div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Collected Training Data</h2>
          </div>

          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text)' }}>{stats?.total ?? 0}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>labelled + pending windows collected from devices</div>

          <div style={{ marginBottom: 12 }}>
            <div className="field-label">By label</div>
            {labelCounts.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>None yet.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {labelCounts.map((b) => (
                  <span key={b.label} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-sub)' }}>
                    {b.label}: <b>{b._count._all}</b>
                  </span>
                ))}
                {unlabeled > 0 && (
                  <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    unlabeled: <b>{unlabeled}</b>
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="field-label">By source</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(stats?.bySource || []).map((b) => (
                <span key={b.source} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-sub)' }}>
                  {b.source}: <b>{b._count._all}</b>
                </span>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 20, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            Retrain: run <code>python pull_samples.py</code> then <code>python train.py --real data/real</code> in
            services/ml-training, then upload the new <code>motion_model.json</code> here and activate it.
          </p>
        </div>
      </div>
    </div>
  );
}
