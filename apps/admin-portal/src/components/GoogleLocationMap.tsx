/// <reference types="google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader, MarkerF, CircleF, DirectionsRenderer, PolylineF } from '@react-google-maps/api';
import { Navigation } from 'lucide-react';

// Stable reference so the loader doesn't reload on every render.
const LIBRARIES: ('places')[] = ['places'];

interface Station { id: string; name?: string; latitude?: unknown; longitude?: unknown }
interface Responder { id: string; latitude?: unknown; longitude?: unknown; user?: { profile?: { fullName?: string } } }
export interface LocationMapProps {
  center: [number, number];
  stations?: Station[];
  responders?: Responder[];
  victimLabel?: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const validLatLng = (lat: unknown, lng: unknown): google.maps.LatLngLiteral | null => {
  const a = num(lat), b = num(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
};
function haversineKm(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const centerBox: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-sub)', textAlign: 'center', padding: 16 };
const routePanel: React.CSSProperties = { position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 5, background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(37,99,235,0.35)', borderRadius: 12, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 6px 18px rgba(0,0,0,0.18)' };

export default function GoogleLocationMap({
  center, stations = [], responders = [], victimLabel = 'SOS Victim', apiKey,
}: LocationMapProps & { apiKey: string }) {
  const { isLoaded, loadError } = useJsApiLoader({ id: 'nari-gmaps', googleMapsApiKey: apiKey, libraries: LIBRARIES });
  const mapRef = useRef<google.maps.Map | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ km: number; min: number; name: string } | null>(null);
  // If Directions ever gets denied (API disabled/billing off), stop retrying so
  // live-location updates don't flood the console — we fall back to a line.
  const directionsBlockedRef = useRef(false);

  const victim = useMemo<google.maps.LatLngLiteral>(() => ({ lat: center[0], lng: center[1] }), [center]);

  // Nearest police station to the victim.
  const nearest = useMemo(() => {
    let best: { pos: google.maps.LatLngLiteral; name: string; km: number } | null = null;
    for (const s of stations) {
      const p = validLatLng(s.latitude, s.longitude);
      if (!p) continue;
      const km = haversineKm(victim, p);
      if (!best || km < best.km) best = { pos: p, name: s.name || 'Police Station', km };
    }
    return best;
  }, [stations, victim]);

  // Road route + ETA from nearest station → victim (Google Directions API).
  useEffect(() => {
    if (!isLoaded || !nearest) { setDirections(null); setRouteInfo(null); return; }

    const straightLine = () => {
      setDirections(null);
      setRouteInfo({ km: nearest.km, min: (nearest.km / 30) * 60, name: nearest.name });
    };

    // Previously denied → estimate instead of calling again.
    if (directionsBlockedRef.current) { straightLine(); return; }

    let cancelled = false;
    const svc = new google.maps.DirectionsService();
    svc.route(
      { origin: nearest.pos, destination: victim, travelMode: google.maps.TravelMode.DRIVING },
      (res, status) => {
        if (cancelled) return;
        if (status === google.maps.DirectionsStatus.OK && res) {
          setDirections(res);
          const leg = res.routes[0]?.legs[0];
          if (leg) setRouteInfo({ km: (leg.distance?.value ?? 0) / 1000, min: (leg.duration?.value ?? 0) / 60, name: nearest.name });
        } else {
          if (status === google.maps.DirectionsStatus.REQUEST_DENIED) directionsBlockedRef.current = true;
          straightLine();
        }
      },
    );
    return () => { cancelled = true; };
  }, [isLoaded, nearest, victim]);

  const onLoad = useCallback((map: google.maps.Map) => { mapRef.current = map; }, []);
  const onUnmount = useCallback(() => { mapRef.current = null; }, []);

  if (loadError) return <div style={centerBox}>Google Maps failed to load. Check the API key, enabled APIs, and billing in Google Cloud.</div>;
  if (!isLoaded) return <div style={centerBox}>Loading Google Maps…</div>;
  if (!Number.isFinite(victim.lat) || !Number.isFinite(victim.lng) || (victim.lat === 0 && victim.lng === 0)) {
    return <div style={centerBox}>No valid location for this alert yet.</div>;
  }

  const mapOptions: google.maps.MapOptions = {
    zoomControl: true, fullscreenControl: true, streetViewControl: true, mapTypeControl: true,
    clickableIcons: true, gestureHandling: 'greedy', mapTypeId: 'roadmap',
    maxZoom: 21, minZoom: 3,
  };

  const stationPts = stations.map((s) => ({ s, p: validLatLng(s.latitude, s.longitude) }));
  const responderPts = responders.map((r) => ({ r, p: validLatLng(r.latitude, r.longitude) }));

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={victim} zoom={16} options={mapOptions} onLoad={onLoad} onUnmount={onUnmount}
      >
        {/* Victim */}
        <MarkerF position={victim} title={victimLabel} zIndex={999}
          icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }} />
        <CircleF center={victim} radius={200} options={{ strokeColor: '#ef4444', strokeWeight: 2, fillColor: '#ef4444', fillOpacity: 0.12 }} />

        {/* Police stations */}
        {stationPts.map(({ s, p }) => p ? (
          <MarkerF key={s.id} position={p} title={`Police Station: ${s.name || 'Station'}`} label={{ text: 'P', color: '#fff', fontSize: '11px', fontWeight: 'bold' }}
            icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#3b82f6', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }} />
        ) : null)}

        {/* Responders */}
        {responderPts.map(({ r, p }) => p ? (
          <MarkerF key={r.id} position={p} title={`Responder: ${r.user?.profile?.fullName || 'Volunteer'}`}
            icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#10b981', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }} />
        ) : null)}

        {/* Route: road route when available, else a straight-line fallback */}
        {directions ? (
          <DirectionsRenderer directions={directions} options={{ suppressMarkers: true, preserveViewport: true, polylineOptions: { strokeColor: '#3b82f6', strokeWeight: 6, strokeOpacity: 0.85 } }} />
        ) : nearest ? (
          <PolylineF path={[nearest.pos, victim]} options={{ strokeColor: '#3b82f6', strokeWeight: 5, strokeOpacity: 0.7, geodesic: true }} />
        ) : null}
      </GoogleMap>

      {routeInfo && (
        <div style={routePanel}>
          <Navigation size={16} color="#2563eb" />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span style={{ fontSize: 12, color: '#2563eb' }}>{routeInfo.name} → victim</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
              {routeInfo.km.toFixed(1)} km · ~{Math.max(1, Math.round(routeInfo.min))} min drive
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
