/**
 * Web-Mercator ("slippy map") tile math for the OpenStreetMap tile grid the
 * Safety Map draws with plain <Image>s — no native map dependency. Pure, so it
 * is unit tested.
 */
export const TILE_SIZE = 256;

/** Fractional tile coordinates of a point at a zoom level. */
export function lonLatToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

export interface PlacedTile {
  key: string;
  url: string;
  /** Position inside the viewport, in px (may be negative: clipped). */
  left: number;
  top: number;
}

export interface TileView {
  tiles: PlacedTile[];
  /** Where a point lands inside the viewport. */
  project(lat: number, lng: number): { x: number; y: number };
}

export function tileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/**
 * Tiles through our own API (GET /api/v1/map/tiles/:z/:x/:y.png), which
 * fetches them from a tile provider and caches them. Loading straight from
 * tile.openstreetmap.org gets "403 Access blocked": OSM's volunteer servers
 * do not serve app traffic.
 */
export function proxiedTileUrl(apiBaseUrl: string, z: number, x: number, y: number): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/map/tiles/${z}/${x}/${y}.png`;
}

/**
 * A `radius`-tile grid ((2r+1)²; 3×3 by default) centred on (lat, lng) and
 * positioned so that point sits at the centre of a width × height viewport.
 */
export function tileView(
  lat: number,
  lng: number,
  zoom: number,
  width: number,
  height: number,
  radius = 1,
  urlFor: (z: number, x: number, y: number) => string = tileUrl,
): TileView {
  const n = 2 ** zoom;
  const c = lonLatToTile(lat, lng, zoom);
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  // Pixel offset of tile (cx, cy)'s top-left corner inside the viewport.
  const originLeft = width / 2 - (c.x - cx) * TILE_SIZE;
  const originTop = height / 2 - (c.y - cy) * TILE_SIZE;

  const tiles: PlacedTile[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = (((cx + dx) % n) + n) % n; // wrap around the antimeridian
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        url: urlFor(zoom, x, y),
        left: originLeft + dx * TILE_SIZE,
        top: originTop + dy * TILE_SIZE,
      });
    }
  }

  return {
    tiles,
    project(pLat, pLng) {
      const p = lonLatToTile(pLat, pLng, zoom);
      return { x: width / 2 + (p.x - c.x) * TILE_SIZE, y: height / 2 + (p.y - c.y) * TILE_SIZE };
    },
  };
}
