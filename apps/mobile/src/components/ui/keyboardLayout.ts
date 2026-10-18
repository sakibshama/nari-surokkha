/**
 * Pure geometry for keeping the focused input above the software keyboard.
 *
 * No react-native imports on purpose: this runs under `node --test`.
 * Every y value is in window coordinates (dp) unless the name says otherwise.
 */

/** Gap kept between the focused input and the keyboard / viewport edge. */
export const FOCUS_MARGIN = 24;

/** Share of the screen assumed for the keyboard when the OS reports nothing. */
export const FALLBACK_KEYBOARD_RATIO = 0.42;

/**
 * Top edge of the keyboard in window coordinates.
 *
 * Android reports `screenY` as the bottom of the visible display frame, which
 * is the keyboard's top edge; `height` there excludes the navigation bar, so it
 * is only a fallback when `screenY` is unusable (0, or at/after the window bottom).
 */
export function resolveKeyboardTop(screenY: number, height: number, windowHeight: number): number {
  if (screenY > 0 && screenY < windowHeight - 1) return screenY;
  return Math.max(0, windowHeight - Math.max(0, height));
}

/** How much of a container (bottom edge at `containerBottom`) the keyboard covers. */
export function keyboardOverlap(containerBottom: number, keyboardTop: number): number {
  if (!Number.isFinite(containerBottom) || !Number.isFinite(keyboardTop)) return 0;
  return Math.max(0, Math.round(containerBottom - keyboardTop));
}

export interface ScrollTargetInput {
  /** Input's top, relative to the scroll content. */
  inputY: number;
  inputHeight: number;
  /** Current vertical scroll offset. */
  scrollY: number;
  /** Visible height of the scroll view (already shrunk by the keyboard inset). */
  viewportHeight: number;
  /** Total scrollable content height; used to clamp. 0 = unknown. */
  contentHeight?: number;
  margin?: number;
}

/**
 * The scroll offset that brings the input fully into view, or `null` when it is
 * already visible. An input taller than the viewport (a long multiline field)
 * is aligned by its bottom edge: that is where the caret sits while typing.
 */
export function computeScrollTarget({
  inputY,
  inputHeight,
  scrollY,
  viewportHeight,
  contentHeight = 0,
  margin = FOCUS_MARGIN,
}: ScrollTargetInput): number | null {
  if (!(viewportHeight > 0)) return null;
  const m = Math.max(0, Math.min(margin, viewportHeight / 4));
  const top = inputY - m;
  const bottom = inputY + inputHeight + m;

  let target: number;
  if (bottom - top > viewportHeight) {
    target = bottom - viewportHeight;
  } else if (bottom > scrollY + viewportHeight) {
    target = bottom - viewportHeight;
  } else if (top < scrollY) {
    target = top;
  } else {
    return null;
  }

  const maxY = contentHeight > 0 ? Math.max(0, contentHeight - viewportHeight) : Number.POSITIVE_INFINITY;
  target = Math.max(0, Math.min(target, maxY));
  return Math.abs(target - scrollY) < 1 ? null : Math.round(target);
}
