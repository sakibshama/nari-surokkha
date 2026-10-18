import Fastify from 'fastify';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapRoutes, parseTile, upstreamUrl, TILE_TTL_SECONDS } from '@/modules/map/map-tiles';

describe('map tile helpers', () => {
  it('parses valid tiles and rejects out-of-range ones', () => {
    expect(parseTile('15', '24613', '14151.png')).toEqual({ z: 15, x: 24613, y: 14151 });
    expect(parseTile('2', '4', '0')).toBeNull(); // x must be < 2^z
    expect(parseTile('20', '0', '0')).toBeNull();
    expect(parseTile('a', '0', '0')).toBeNull();
    expect(parseTile('3', '-1', '0')).toBeNull();
  });

  it('fills the provider template', () => {
    expect(upstreamUrl('https://{s}.example.com/{z}/{x}/{y}{r}.png', { z: 3, x: 1, y: 2 })).toBe(
      'https://d.example.com/3/1/2.png',
    );
  });
});

describe('GET /map/tiles/:z/:x/:y', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function build(cached: Buffer | null = null) {
    const store = new Map<string, Buffer>();
    const redis = {
      getBuffer: vi.fn(async () => cached),
      set: vi.fn(async (k: string, v: Buffer) => void store.set(k, v)),
    };
    const app = Fastify();
    app.decorate('redis', redis as never);
    await app.register(mapRoutes, { prefix: '/map' });
    await app.ready();
    return { app, redis };
  }

  it('fetches a tile upstream once and caches it', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { app, redis } = await build();
    const res = await app.inject({ method: 'GET', url: '/map/tiles/15/24613/14151.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain(`max-age=${TILE_TTL_SECONDS}`);
    expect(res.rawPayload.equals(png)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).not.toContain('tile.openstreetmap.org');
    expect(redis.set).toHaveBeenCalledWith('map:tile:15/24613/14151', png, 'EX', TILE_TTL_SECONDS);
    await app.close();
  });

  it('serves from cache without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await build(Buffer.from('cached'));
    const res = await app.inject({ method: 'GET', url: '/map/tiles/1/0/0.png' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('falls back to OSM, then answers 502 when no provider has the tile', async () => {
    const fetchMock = vi.fn(async () => new Response('Access blocked', { status: 403, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/map/tiles/1/0/0.png' });
    expect(res.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects invalid tiles', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/map/tiles/2/9/9.png' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
