import { useEffect, useState } from 'react';
import api from '../services/api';
import LeafletLocationMap from './LiveLocationMap';
import GoogleLocationMap from './GoogleLocationMap';

interface Station { id: string; name?: string; latitude?: unknown; longitude?: unknown }
interface Responder { id: string; latitude?: unknown; longitude?: unknown; user?: { profile?: { fullName?: string } } }
interface Props { center: [number, number]; stations?: Station[]; responders?: Responder[]; victimLabel?: string }

// Module-level cache so we only hit /config once per session.
let cachedKey: string | null | undefined; // undefined = not fetched yet
let inflight: Promise<string | null> | null = null;

function fetchKey(): Promise<string | null> {
  if (cachedKey !== undefined) return Promise.resolve(cachedKey);
  if (!inflight) {
    inflight = api.get('/config')
      .then((r) => { cachedKey = (r.data?.data?.googleMapsApiKey ?? null) as string | null; return cachedKey; })
      .catch(() => { cachedKey = null; return null; });
  }
  return inflight;
}

/**
 * Chooses the map implementation at runtime:
 *  - Google Maps when an API key has been configured in admin Settings.
 *  - Falls back to the free Leaflet/OpenStreetMap map when no key is set,
 *    so the system keeps working before/without a key.
 */
export default function SmartLocationMap(props: Props) {
  const [apiKey, setApiKey] = useState<string | null | undefined>(cachedKey);
  useEffect(() => {
    let mounted = true;
    fetchKey().then((k) => { if (mounted) setApiKey(k); });
    return () => { mounted = false; };
  }, []);

  if (apiKey === undefined) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-sub)' }}>
        Loading map…
      </div>
    );
  }
  return apiKey
    ? <GoogleLocationMap {...props} apiKey={apiKey} />
    : <LeafletLocationMap {...props} />;
}
