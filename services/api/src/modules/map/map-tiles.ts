/**
 * Map tile proxy for the mobile Safety Map.
 *
 * The app used to load tiles straight from tile.openstreetmap.org. OSM's
 * volunteer-run servers block app traffic that does not meet their tile usage
 * policy (no proper Referer/User-Agent from React Native's image loader, and
 * no bulk use from apps at all), so users saw "403 Access blocked" instead of
 * a map. The app now asks THIS server for tiles; the server fetches them once
 * from a provider meant for this (CARTO basemaps by default, configurable
 * with MAP_TILE_URL), with an identifying User-Agent, and caches them in
 * Redis so each tile is fetched upstream at most once a week.
 */

import type { FastifyInstance } from 'fastify';
import { env } from '@/config/env';

export const MAX_ZOOM = 19;
export const TILE_TTL_SECONDS = 7 * 24 * 3600;
const UPSTREAM_TIMEOUT_MS = 8000;
const SUBDOMAINS = ['a', 'b', 'c', 'd'];
const OSM_FALLBACK = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface TileCoords {
  z: number;
  x: number;
  y: number;
}

/** Validate z/x/y ("12", "3010", "1755.png"); null when out of range. */
export function parseTile(z: string, x: string, y: string): TileCoords | null {
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(String(y).replace(/\.png$/i, ''));
  if (![zi, xi, yi].every(Number.isInteger)) return null;
  if (zi < 0 || zi > MAX_ZOOM) return null;
  const n = 2 ** zi;
  if (xi < 0 || xi >= n || yi < 0 || yi >= n) return null;
  return { z: zi, x: xi, y: yi };
}

/** Fill a {s}/{z}/{x}/{y}/{r} template; {s} rotates over a–d by tile. */
export function upstreamUrl(template: string, t: TileCoords): string {
  return template
    .replace('{s}', SUBDOMAINS[(t.x + t.y) % SUBDOMAINS.length])
    .replace('{z}', String(t.z))
    .replace('{x}', String(t.x))
    .replace('{y}', String(t.y))
    .replace('{r}', '');
}

async function fetchTile(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': `NariSurokkha/1.0 (+${env.API_BASE_URL})`,
        Referer: env.API_BASE_URL,
        Accept: 'image/png,image/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function mapRoutes(fastify: FastifyInstance, _opts: unknown, done: (err?: Error) => void): void {
  fastify.get<{ Params: { z: string; x: string; y: string } }>(
    '/tiles/:z/:x/:y',
    {
      // Public on purpose: <Image> requests cannot refresh an expired token.
      // A screen shows about nine tiles, so this allows plenty of panning.
      config: { rateLimit: { max: 600, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const t = parseTile(request.params.z, request.params.x, request.params.y);
      if (!t) return reply.code(400).send({ success: false, error: { code: 'MAP_001', message: 'Invalid tile' } });

      const key = `map:tile:${t.z}/${t.x}/${t.y}`;
      let png = await fastify.redis.getBuffer(key).catch(() => null);
      if (!png) {
        png = (await fetchTile(upstreamUrl(env.MAP_TILE_URL, t))) ?? (await fetchTile(upstreamUrl(OSM_FALLBACK, t)));
        if (!png) {
          request.log.warn({ tile: key }, 'Map tile unavailable upstream');
          return reply.code(502).send({ success: false, error: { code: 'MAP_002', message: 'Map tile unavailable' } });
        }
        await fastify.redis.set(key, png, 'EX', TILE_TTL_SECONDS).catch(() => undefined);
      }
      return reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', `public, max-age=${TILE_TTL_SECONDS}, immutable`)
        .send(png);
    },
  );
  done();
}
