import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE, lonLatToTile, tileUrl, tileView } from '../src/services/mapTiles';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('origin and corners of the Web-Mercator grid', () => {
  const c = lonLatToTile(0, 0, 1);
  close(c.x, 1);
  close(c.y, 1);
  close(lonLatToTile(85.05112878, -180, 3).x, 0);
  close(lonLatToTile(85.05112878, -180, 3).y, 0, 1e-5);
});

test('Dhaka at zoom 15 lands on the known OSM tile', () => {
  const t = lonLatToTile(23.8103, 90.4125, 15);
  assert.equal(Math.floor(t.x), 24613);
  assert.equal(Math.floor(t.y), 14151);
});

test('3x3 grid centred on the point', () => {
  const W = 360;
  const H = 240;
  const v = tileView(23.8103, 90.4125, 15, W, H);
  assert.equal(v.tiles.length, 9);
  const centre = v.tiles[4];
  assert.equal(centre.key, '15/24613/14151');
  assert.equal(centre.url, tileUrl(15, 24613, 14151));
  // The user's point projects to the middle of the viewport…
  const p = v.project(23.8103, 90.4125);
  close(p.x, W / 2);
  close(p.y, H / 2);
  // …and lies inside the centre tile.
  assert.ok(p.x >= centre.left && p.x < centre.left + TILE_SIZE);
  assert.ok(p.y >= centre.top && p.y < centre.top + TILE_SIZE);
  // Neighbours are exactly one tile apart.
  assert.equal(v.tiles[5].left - centre.left, TILE_SIZE);
  assert.equal(v.tiles[7].top - centre.top, TILE_SIZE);
  // The grid covers the whole viewport.
  assert.ok(v.tiles[0].left <= 0 && v.tiles[0].top <= 0);
  assert.ok(v.tiles[8].left + TILE_SIZE >= W && v.tiles[8].top + TILE_SIZE >= H);
});

test('wraps around the antimeridian and drops rows beyond the poles', () => {
  const v = tileView(0, 179.99, 2, 300, 300);
  const xs = new Set(v.tiles.map((t) => Number(t.key.split('/')[1])));
  assert.ok(xs.has(0), 'east of 180° wraps to x=0');
  const polar = tileView(85, 0, 2, 300, 300);
  assert.ok(polar.tiles.every((t) => Number(t.key.split('/')[2]) >= 0));
  assert.equal(polar.tiles.length, 6);
});
