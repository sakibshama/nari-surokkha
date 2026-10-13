/**
 * Incident heatmap — free, keyless map tiles (OpenStreetMap / CARTO / Esri)
 * and a density heat layer drawn on a canvas. No Google Maps API key needed.
 *
 * If a tile server stops answering (rate limit, outage, a provider starting
 * to require a key), the map switches to the next free provider by itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Flame, MapPin, Layers } from 'lucide-react';
import { useT, fmt, tr } from '../i18n';

export interface HeatPoint {
  latitude: number;
  longitude: number;
  weight?: number;
  type?: string;
}

type Base = 'streets' | 'light' | 'dark' | 'satellite';

const PROVIDERS: Record<Base, { label: string; url: string; attribution: string; subdomains?: string; maxZoom: number }[]> = {
  streets: [
    { label: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 },
    { label: 'CARTO Voyager', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19 },
  ],
  light: [
    { label: 'CARTO Positron', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19 },
    { label: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 },
  ],
  dark: [
    { label: 'CARTO Dark Matter', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19 },
    { label: 'OpenStreetMap (dimmed)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 },
  ],
  satellite: [
    { label: 'Esri World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics', maxZoom: 18 },
    { label: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 },
  ],
};

const TYPE_COLOR: Record<string, string> = {
  harassment: '#ef4444',
  robbery: '#f97316',
  suspicious_activity: '#f59e0b',
  poor_lighting: '#8b5cf6',
  other: '#64748b',
};
const typeLabel = (t?: string) => tr(t ? t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Incident');

// Blue → green → yellow → orange → red
const GRADIENT: [number, string][] = [[0.0, 'rgba(37,99,235,0)'], [0.25, '#2563eb'], [0.45, '#10b981'], [0.65, '#facc15'], [0.82, '#f97316'], [1.0, '#dc2626']];

function buildPalette(): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [stop, color] of GRADIENT) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  return ctx.getImageData(0, 0, 256, 1).data;
}

/** Leaflet layer that paints a heat density surface on a canvas. */
const HeatLayer = L.Layer.extend({
  initialize(this: any, points: HeatPoint[], opts: { meters?: number; opacity?: number }) {
    this._points = points;
    this._meters = opts.meters ?? 450;
    this._opacity = opts.opacity ?? 0.8;
  },
  setPoints(this: any, points: HeatPoint[]) {
    this._points = points;
    if (this._map) this._redraw();
  },
  onAdd(this: any, map: L.Map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide') as HTMLCanvasElement;
    this._canvas.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('moveend zoomend resize viewreset', this._redraw, this);
    this._redraw();
  },
  onRemove(this: any, map: L.Map) {
    map.off('moveend zoomend resize viewreset', this._redraw, this);
    this._canvas?.remove();
    this._canvas = null;
  },
  _redraw(this: any) {
    const map: L.Map = this._map;
    const canvas: HTMLCanvasElement = this._canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);
    canvas.width = size.x;
    canvas.height = size.y;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, size.x, size.y);
    const points: HeatPoint[] = this._points ?? [];
    if (!points.length) return;

    // Radius: a fixed ground distance, clamped to stay readable at any zoom.
    const lat = map.getCenter().lat;
    const metersPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom() + 8);
    const r = Math.round(Math.max(14, Math.min(70, this._meters / metersPerPx)));

    const stamp = document.createElement('canvas');
    stamp.width = stamp.height = r * 2;
    const sctx = stamp.getContext('2d')!;
    const g = sctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, r * 2, r * 2);

    // sqrt so one very busy cell doesn't wash out every other hotspot
    const max = Math.sqrt(Math.max(1, ...points.map((p) => p.weight ?? 1)));
    const bounds = map.getBounds().pad(0.2);
    for (const p of points) {
      if (!bounds.contains([p.latitude, p.longitude])) continue;
      const pt = map.latLngToContainerPoint([p.latitude, p.longitude]);
      ctx.globalAlpha = Math.min(1, 0.18 + 0.82 * (Math.sqrt(p.weight ?? 1) / max));
      ctx.drawImage(stamp, pt.x - r, pt.y - r);
    }
    ctx.globalAlpha = 1;

    const palette: Uint8ClampedArray = this._palette ?? (this._palette = buildPalette());
    const img = ctx.getImageData(0, 0, size.x, size.y);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (!a) continue;
      const j = a * 4;
      px[i] = palette[j];
      px[i + 1] = palette[j + 1];
      px[i + 2] = palette[j + 2];
      px[i + 3] = Math.min(255, a * 1.4) * this._opacity;
    }
    ctx.putImageData(img, 0, 0);
  },
});

function Heat({ points }: { points: HeatPoint[] }) {
  const map = useMap();
  const layer = useRef<any>(null);
  useEffect(() => {
    layer.current = new (HeatLayer as any)(points, {});
    layer.current.addTo(map);
    return () => { layer.current?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  useEffect(() => { layer.current?.setPoints(points); }, [points]);
  return null;
}

function FitToPoints({ points }: { points: HeatPoint[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !points.length) return;
    done.current = true;
    const b = L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]));
    if (b.isValid()) map.fitBounds(b.pad(0.15), { maxZoom: 14 });
  }, [points, map]);
  return null;
}

/** A tile layer that moves to the next free provider when tiles keep failing. */
function ResilientTiles({ base, dim, onProvider }: { base: Base; dim: boolean; onProvider: (label: string, failedAll: boolean) => void }) {
  const [idx, setIdx] = useState(0);
  const stats = useRef({ ok: 0, err: 0 });
  const chain = PROVIDERS[base];
  useEffect(() => { setIdx(0); }, [base]);
  useEffect(() => {
    stats.current = { ok: 0, err: 0 };
    onProvider(chain[Math.min(idx, chain.length - 1)].label, idx >= chain.length);
  }, [idx, base]); // eslint-disable-line react-hooks/exhaustive-deps
  if (idx >= chain.length) return null;
  const p = chain[idx];
  // OSM used as a dark fallback is dimmed with a CSS filter.
  const dimmed = dim && p.url.includes('openstreetmap');
  return (
    <TileLayer
      key={`${base}-${idx}`}
      url={p.url}
      attribution={p.attribution}
      maxZoom={p.maxZoom}
      {...(p.subdomains ? { subdomains: p.subdomains } : {})}
      className={dimmed ? 'ns-tiles-dim' : undefined}
      eventHandlers={{
        tileload: () => { stats.current.ok++; },
        tileerror: () => {
          stats.current.err++;
          // Several failures and nothing loaded: this provider is unusable here.
          if (stats.current.err >= 4 && stats.current.ok === 0) setIdx((i) => i + 1);
        },
      }}
    />
  );
}

export default function IncidentHeatmap({ points, dark, height = 440 }: { points: HeatPoint[]; dark: boolean; height?: number }) {
  const [mode, setMode] = useState<'heat' | 'points' | 'both'>('heat');
  const [base, setBase] = useState<Base>(dark ? 'dark' : 'streets');
  const [provider, setProvider] = useState('');
  const [tilesDown, setTilesDown] = useState(false);
  const t = useT();
  useEffect(() => { setBase((b) => (b === 'dark' || b === 'streets' ? (dark ? 'dark' : 'streets') : b)); }, [dark]);

  const total = useMemo(() => points.reduce((n, p) => n + (p.weight ?? 1), 0), [points]);
  const hotspots = useMemo(() => [...points].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1)).slice(0, 3), [points]);

  const seg = (active: boolean) => ({
    padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    background: active ? 'var(--primary)' : 'transparent', color: active ? '#fff' : 'var(--text-sub)', borderRadius: 8,
  });

  return (
    <div>
      <style>{`.ns-tiles-dim{filter:brightness(.62) invert(1) contrast(.9) hue-rotate(180deg) saturate(.35)}`}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '0 24px 14px' }}>
        <div role="group" aria-label={t('Map view')} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'var(--bg-card-alt)', border: '1px solid var(--border)' }}>
          <button type="button" style={seg(mode === 'heat')} onClick={() => setMode('heat')}><Flame size={13} style={{ verticalAlign: -2 }} /> {t('Heatmap')}</button>
          <button type="button" style={seg(mode === 'points')} onClick={() => setMode('points')}><MapPin size={13} style={{ verticalAlign: -2 }} /> {t('Points')}</button>
          <button type="button" style={seg(mode === 'both')} onClick={() => setMode('both')}>{t('Both')}</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-sub)' }}>
          <Layers size={14} />
          <select className="field-input" style={{ padding: '6px 34px 6px 10px', fontSize: 12, width: 'auto' }} value={base} onChange={(e) => setBase(e.target.value as Base)}>
            <option value="streets">{t('Streets')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
            <option value="satellite">{t('Satellite')}</option>
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {fmt(t('{reports} reports · {areas} areas · free map, no API key'), { reports: total, areas: points.length })}
        </span>
      </div>

      <div style={{ position: 'relative', height, width: '100%', background: 'var(--bg-input)' }}>
        <MapContainer center={[23.8103, 90.4125]} zoom={12} style={{ height: '100%', width: '100%' }} preferCanvas>
          <ResilientTiles base={base} dim={base === 'dark'} onProvider={(label, down) => { setProvider(label); setTilesDown(down); }} />
          {(mode === 'heat' || mode === 'both') && <Heat points={points} />}
          {(mode === 'points' || mode === 'both') &&
            points.map((p, i) => (
              <CircleMarker
                key={i}
                center={[p.latitude, p.longitude]}
                radius={5 + 3 * Math.sqrt(p.weight ?? 1)}
                pathOptions={{ fillColor: TYPE_COLOR[p.type ?? ''] ?? '#ef4444', fillOpacity: 0.65, color: '#fff', weight: 1.5 }}
              >
                <Popup>
                  <strong>{typeLabel(p.type)}</strong>
                  <br />
                  {fmt(t('{n} report(s) in this area (~250 m)'), { n: p.weight ?? 1 })}
                </Popup>
              </CircleMarker>
            ))}
          <FitToPoints points={points} />
        </MapContainer>

        {/* Legend */}
        {mode !== 'points' && points.length > 0 && (
          <div style={{ position: 'absolute', left: 12, bottom: 22, zIndex: 500, padding: '8px 10px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', fontSize: 11, color: 'var(--text-sub)' }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>{t('Incident density')}</div>
            <div style={{ width: 150, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,#2563eb,#10b981,#facc15,#f97316,#dc2626)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}><span>{t('Low')}</span><span>{t('High')}</span></div>
          </div>
        )}

        {points.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ padding: '10px 16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-sub)', boxShadow: 'var(--shadow-card)' }}>
              {t('No incident reports in this period yet.')}
            </div>
          </div>
        )}

        {tilesDown && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 600, padding: '8px 14px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid rgba(245,158,11,.4)', fontSize: 12, color: 'var(--text-sub)' }}>
            {t("The map tiles could not be loaded — check this computer's internet connection. The heat layer is still shown.")}
          </div>
        )}
      </div>

      {hotspots.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 24px 18px', fontSize: 12, color: 'var(--text-sub)' }}>
          <strong style={{ color: 'var(--text)' }}>{t('Top hotspots:')}</strong>
          {hotspots.map((h, i) => (
            <a key={i} href={`https://www.openstreetmap.org/?mlat=${h.latitude}&mlon=${h.longitude}#map=16/${h.latitude}/${h.longitude}`} target="_blank" rel="noopener noreferrer"
              style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-sub)', textDecoration: 'none' }}>
              {typeLabel(h.type)} · {fmt(t('{n} near {coords}'), { n: h.weight ?? 1, coords: `${h.latitude.toFixed(3)}, ${h.longitude.toFixed(3)}` })}
            </a>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{t('Map')}: {provider}</span>
        </div>
      )}
    </div>
  );
}
