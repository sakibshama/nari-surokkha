import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMap, Tooltip, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Maximize2, Minimize2, LocateFixed, Plus, Minus, Navigation, Store } from 'lucide-react';
import { useT, fmt, tr } from '../i18n';

const victimIcon = L.divIcon({
  className: 'custom-pulse-marker',
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 rgba(239,68,68,0.4);animation:alert-pulse 1.5s infinite;"></div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
});
const responderIcon = L.divIcon({
  className: 'custom-responder-marker',
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 2px 8px rgba(16,185,129,0.6);"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9],
});
const poiIcon = (emoji: string) => L.divIcon({
  className: 'custom-poi-marker',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:13px;">${emoji}</div>`,
  iconSize: [22, 22], iconAnchor: [11, 11],
});

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const validPoint = (lat: unknown, lng: unknown): [number, number] | null => {
  const a = num(lat), b = num(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  return [a, b];
};
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface Responder { id: string; latitude?: unknown; longitude?: unknown; user?: { profile?: { fullName?: string } } }
interface Poi { id: string; pos: [number, number]; label: string; emoji: string }
interface RouteInfo { coords: [number, number][]; km: number; min: number; fromName: string; fromPos: [number, number] }

const POI_KINDS: Record<string, { emoji: string; label: string }> = {
  hospital: { emoji: '🏥', label: 'Hospital' }, clinic: { emoji: '🏥', label: 'Clinic' },
  doctors: { emoji: '🏥', label: 'Doctor' }, pharmacy: { emoji: '💊', label: 'Pharmacy' },
  restaurant: { emoji: '🍴', label: 'Restaurant' },
  cafe: { emoji: '☕', label: 'Cafe' }, fast_food: { emoji: '🍔', label: 'Fast food' },
  marketplace: { emoji: '🛒', label: 'Bazar / Market' }, fuel: { emoji: '⛽', label: 'Fuel' },
  bank: { emoji: '🏦', label: 'Bank' }, atm: { emoji: '🏧', label: 'ATM' },
  school: { emoji: '🏫', label: 'School' }, place_of_worship: { emoji: '🕌', label: 'Mosque' },
};

function MapBridge({ center, isFullscreen, onMap }: { center: [number, number]; isFullscreen: boolean; onMap: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onMap(map); }, [map, onMap]);
  useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 220); return () => clearTimeout(t); }, [map, isFullscreen]);
  useEffect(() => {
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    map.flyTo(center, map.getZoom(), { animate: true, duration: 0.6 });
  }, [center, map]);
  return null;
}

export default function LiveLocationMap({
  center, responders = [], victimLabel,
}: { center: [number, number]; responders?: Responder[]; victimLabel?: string }) {
  const t = useT();
  const nearestLabel = t('Nearest responder');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [pois, setPois] = useState<Poi[]>([]);
  const [showPois, setShowPois] = useState(true);
  const mapRef = useRef<L.Map | null>(null);

  // Nearest volunteer responder — the route shows how far help is.
  const nearest = useMemo(() => {
    let best: { pos: [number, number]; name: string; km: number } | null = null;
    for (const r of responders) {
      const p = validPoint(r.latitude, r.longitude);
      if (!p) continue;
      const km = haversineKm(center, p);
      if (!best || km < best.km) best = { pos: p, name: r.user?.profile?.fullName || nearestLabel, km };
    }
    return best;
  }, [responders, center, nearestLabel]);

  useEffect(() => {
    if (!nearest) { setRoute(null); return; }
    let cancelled = false;
    const [vLat, vLng] = center;
    const [sLat, sLng] = nearest.pos;
    const url = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${vLng},${vLat}?overview=full&geometries=geojson`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.routes?.[0]) return;
        const r0 = data.routes[0];
        const coords: [number, number][] = r0.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
        setRoute({ coords, km: r0.distance / 1000, min: r0.duration / 60, fromName: nearest.name, fromPos: nearest.pos });
      })
      .catch(() => {
        if (cancelled) return;
        setRoute({ coords: [nearest.pos, center], km: nearest.km, min: (nearest.km / 30) * 60, fromName: nearest.name, fromPos: nearest.pos });
      });
    return () => { cancelled = true; };
  }, [nearest, center]);

  useEffect(() => {
    if (!showPois) return;
    let cancelled = false;
    const [lat, lng] = center;
    const q = `[out:json][timeout:20];(node(around:900,${lat},${lng})[amenity];node(around:900,${lat},${lng})[shop];);out body 80;`;
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.elements) return;
        const list: Poi[] = [];
        for (const el of data.elements) {
          if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
          const kind = el.tags?.amenity || (el.tags?.shop ? 'shop' : '');
          const meta = POI_KINDS[kind] || (el.tags?.shop ? { emoji: '🏪', label: `Shop${el.tags.shop !== 'yes' ? ' · ' + el.tags.shop : ''}` } : null);
          if (!meta) continue;
          const label = tr(meta.label);
          list.push({ id: String(el.id), pos: [el.lat, el.lon], emoji: meta.emoji, label: el.tags?.name ? `${label}: ${el.tags.name}` : label });
          if (list.length >= 70) break;
        }
        setPois(list);
      })
      .catch(() => { if (!cancelled) setPois([]); });
    return () => { cancelled = true; };
  }, [center, showPois]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recenter = () => mapRef.current?.flyTo(center, 17, { animate: true, duration: 0.6 });
  const fitRoute = () => {
    if (route && mapRef.current) mapRef.current.fitBounds(L.latLngBounds(route.coords), { padding: [60, 60] });
  };
  const zoomIn = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();

  const wrapperStyle: React.CSSProperties = isFullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#000' }
    : { position: 'absolute', inset: 0 };
  const btn: React.CSSProperties = {
    width: 40, height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(17,24,39,0.85)', color: '#fff', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(6px)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.35)', transition: 'transform .12s ease, background .12s ease',
  };

  return (
    <div style={wrapperStyle}>
      <style>{`
        @keyframes alert-pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); } 70% { box-shadow: 0 0 0 25px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } }
        .leaflet-container { z-index: 1; background: #0b1120; font-family: inherit; }
        .leaflet-control-attribution { font-size: 10px; opacity: .6; }
        .llm-btn:hover { transform: translateY(-1px); background: rgba(31,41,55,0.95) !important; }
      `}</style>

      <MapContainer
        center={center} zoom={17} maxZoom={20} minZoom={3}
        ref={mapRef as any}
        style={{ width: '100%', height: '100%', minHeight: 350 }}
        zoomControl={false} scrollWheelZoom doubleClickZoom
      >
        <MapBridge center={center} isFullscreen={isFullscreen} onMap={(m) => { mapRef.current = m; }} />

        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name={t('Street (detailed)')}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              attribution='&copy; OpenStreetMap &copy; CARTO' maxNativeZoom={20} maxZoom={20} detectRetina />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name={t('Satellite')}>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; Esri World Imagery' maxNativeZoom={19} maxZoom={20} detectRetina />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors' maxNativeZoom={19} maxZoom={20} detectRetina />
          </LayersControl.BaseLayer>
        </LayersControl>

        {route && (
          <>
            <Polyline positions={route.coords} pathOptions={{ color: '#3b82f6', weight: 5, opacity: 0.85 }} />
            <Polyline positions={route.coords} pathOptions={{ color: '#93c5fd', weight: 2, opacity: 0.9, dashArray: '1 10' }} />
          </>
        )}

        <Marker position={center} icon={victimIcon}>
          <Tooltip direction="top" offset={[0, -12]} permanent>{victimLabel || t('SOS Victim')}</Tooltip>
        </Marker>
        <Circle center={center} radius={200} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.12, weight: 2 }} />

        {responders.map((r) => {
          const p = validPoint(r.latitude, r.longitude);
          return p ? (
            <Marker key={r.id} position={p} icon={responderIcon}>
              <Tooltip direction="top" offset={[0, -12]}>{t('Responder')}: {r.user?.profile?.fullName || t('Volunteer')}</Tooltip>
            </Marker>
          ) : null;
        })}

        {showPois && pois.map((p) => (
          <Marker key={p.id} position={p.pos} icon={poiIcon(p.emoji)}>
            <Tooltip direction="top" offset={[0, -10]}>{p.label}</Tooltip>
          </Marker>
        ))}
      </MapContainer>

      {route && (
        <div onClick={fitRoute} title={t('Click to fit route in view')} style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
          background: 'rgba(17,24,39,0.9)', backdropFilter: 'blur(6px)', color: '#e5e7eb',
          border: '1px solid rgba(59,130,246,0.4)', borderRadius: 12, padding: '8px 14px',
          display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        }}>
          <Navigation size={16} color="#60a5fa" />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span style={{ fontSize: 12, color: '#93c5fd' }}>{route.fromName} → {t('victim')}</span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {fmt(t('{km} km · ~{min} min drive'), { km: route.km.toFixed(1), min: Math.max(1, Math.round(route.min)) })}
            </span>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1000 }}>
        <button className="llm-btn" style={btn} title={isFullscreen ? t('Exit full screen') : t('Full screen')} onClick={() => setIsFullscreen((v) => !v)}>
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button className="llm-btn" style={btn} title={t('Recenter on victim')} onClick={recenter}><LocateFixed size={18} /></button>
        <button className="llm-btn" style={{ ...btn, background: showPois ? 'rgba(59,130,246,0.85)' : 'rgba(17,24,39,0.85)' }}
          title={showPois ? t('Hide nearby places') : t('Show nearby places')} onClick={() => setShowPois((v) => !v)}>
          <Store size={18} />
        </button>
      </div>

      <div style={{ position: 'absolute', bottom: 24, right: 12, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1000 }}>
        <button className="llm-btn" style={btn} title={t('Zoom in')} onClick={zoomIn}><Plus size={18} /></button>
        <button className="llm-btn" style={btn} title={t('Zoom out')} onClick={zoomOut}><Minus size={18} /></button>
      </div>

      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 1000, background: 'rgba(17,24,39,0.85)',
        backdropFilter: 'blur(6px)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10, padding: '10px 12px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6,
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} /> {t('SOS victim')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} /> {t('Responder')} ({responders.length})</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>🏥🛒🍴 {t('Nearby places')} ({showPois ? pois.length : t('off')})</span>
      </div>
    </div>
  );
}
