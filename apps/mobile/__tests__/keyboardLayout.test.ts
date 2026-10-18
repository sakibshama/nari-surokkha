import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScrollTarget,
  keyboardOverlap,
  resolveKeyboardTop,
} from '../src/components/ui/keyboardLayout';

test('keyboard top prefers the reported screenY', () => {
  assert.equal(resolveKeyboardTop(500, 300, 900), 500);
});

test('keyboard top falls back to window height minus keyboard height', () => {
  assert.equal(resolveKeyboardTop(0, 300, 900), 600);
  assert.equal(resolveKeyboardTop(900, 300, 900), 600);
  assert.equal(resolveKeyboardTop(0, -5, 900), 900);
});

test('overlap is the part of the container below the keyboard top', () => {
  assert.equal(keyboardOverlap(900, 560), 340);
  // Container already ends above the keyboard (window was resized): no inset.
  assert.equal(keyboardOverlap(540, 560), 0);
  assert.equal(keyboardOverlap(Number.NaN, 560), 0);
});

test('no scroll when the input is already comfortably visible', () => {
  assert.equal(
    computeScrollTarget({ inputY: 100, inputHeight: 52, scrollY: 0, viewportHeight: 400, margin: 24 }),
    null,
  );
});

test('input hidden below the viewport is scrolled up to sit above the keyboard', () => {
  // bottom edge 652 + 24 margin must end at scrollY + 400.
  assert.equal(
    computeScrollTarget({ inputY: 600, inputHeight: 52, scrollY: 0, viewportHeight: 400, margin: 24 }),
    276,
  );
});

test('input above the viewport is scrolled down into view', () => {
  assert.equal(
    computeScrollTarget({ inputY: 50, inputHeight: 52, scrollY: 300, viewportHeight: 400, margin: 24 }),
    26,
  );
});

test('target is clamped to the scrollable range', () => {
  assert.equal(
    computeScrollTarget({ inputY: 10, inputHeight: 52, scrollY: 200, viewportHeight: 400, margin: 24 }),
    0,
  );
  assert.equal(
    computeScrollTarget({
      inputY: 900,
      inputHeight: 52,
      scrollY: 0,
      viewportHeight: 400,
      contentHeight: 960,
      margin: 24,
    }),
    560,
  );
});

test('a multiline input taller than the viewport is aligned by its bottom (caret) edge', () => {
  assert.equal(
    computeScrollTarget({ inputY: 200, inputHeight: 500, scrollY: 0, viewportHeight: 300, margin: 24 }),
    424,
  );
});

test('unknown viewport means no scroll', () => {
  assert.equal(computeScrollTarget({ inputY: 600, inputHeight: 52, scrollY: 0, viewportHeight: 0 }), null);
});
