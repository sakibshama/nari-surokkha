/**
 * Runtime theme.
 *
 * The previous theme exported plain constants, which every screen consumed
 * inside a module-level `StyleSheet.create(...)`. That call runs once, when the
 * module is first imported, so no toggle could ever have reached it — the
 * colours were baked in before the app rendered a frame.
 *
 * So the palette is now context, and styles are built per scheme through
 * `useThemedStyles`. The memo cache is keyed on the scheme, which means each
 * screen creates at most two StyleSheets for its whole lifetime — one light,
 * one dark — not one per render.
 *
 * Three modes, not two: `system` is the default and follows the OS, and is a
 * distinct state from having explicitly chosen light or dark. A user who never
 * opens Settings gets whatever their phone does, which is what they expect.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ColorScheme,
  Gradients,
  Palette,
  Shadows,
  ThemeMode,
  makeGradients,
  makeShadows,
  palettes,
  radius,
  spacing,
  type,
} from './tokens';

const STORAGE_KEY = 'theme_mode_v1';

export interface Theme {
  /** The resolved scheme actually on screen. */
  scheme: ColorScheme;
  /** What the user picked — `system` included. */
  mode: ThemeMode;
  colors: Palette;
  shadows: Shadows;
  gradients: Gradients;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  /** Cycles light → dark → light. Used by the one-tap control. */
  toggle: () => void;
}

const ThemeContext = createContext<Theme | null>(null);

function buildTheme(
  scheme: ColorScheme,
  mode: ThemeMode,
  setMode: (m: ThemeMode) => void,
  toggle: () => void,
): Theme {
  return {
    scheme,
    mode,
    colors: palettes[scheme],
    shadows: makeShadows(scheme),
    gradients: makeGradients(palettes[scheme]),
    spacing,
    radius,
    type,
    isDark: scheme === 'dark',
    setMode,
    toggle,
  };
}

export function ThemeProvider({
  children,
  initialMode = 'system',
}: {
  children: React.ReactNode;
  /**
   * Starting mode before the stored preference loads. Production leaves this
   * as `system`; tests and the design preview pin a scheme with it.
   */
  initialMode?: ThemeMode;
}) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  /**
   * Until the stored preference has been read we render with the system
   * scheme. Blocking the tree on an AsyncStorage round trip would put a blank
   * frame in front of an app whose entire job is to be reachable instantly.
   */
  const [hydrated, setHydrated] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        if (initialMode !== 'system') return; // pinned by the caller
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (mounted.current && (stored === 'light' || stored === 'dark' || stored === 'system')) {
          setModeState(stored);
        }
      } catch {
        /* No stored preference is a perfectly good state: follow the system. */
      } finally {
        if (mounted.current) setHydrated(true);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [initialMode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    // Fire and forget: the UI must not wait on the disk to repaint.
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      /* Preference simply will not survive a restart. Not worth an alert. */
    });
  }, []);

  const resolved: ColorScheme =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const toggle = useCallback(() => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setMode]);

  const theme = useMemo(
    () => buildTheme(resolved, mode, setMode, toggle),
    [resolved, mode, setMode, toggle],
  );

  // `hydrated` is intentionally not gating render — it is exposed only so a
  // future splash can wait on it if we ever want to avoid the one-frame flip.
  void hydrated;

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * The active theme.
 *
 * Pass a scheme to pin one. A few screens are deliberately single-scheme —
 * the active-SOS screen and the fake-call screen are full-bleed states that
 * imitate a system alarm and a system call. Rendering those light would cost
 * night legibility and drop the alarm register, and nobody expects a ringing
 * phone to respect their reading preference.
 *
 * Falls back to a light theme rather than throwing when no provider is above
 * it. A missing provider should show an ugly screen, never crash a safety app.
 */
export function useTheme(force?: ColorScheme): Theme {
  const ctx = useContext(ThemeContext);
  const base =
    ctx ??
    buildTheme('light', 'system', () => undefined, () => undefined);
  if (!force || force === base.scheme) return base;
  return buildTheme(force, base.mode, base.setMode, base.toggle);
}

type StyleFactory<T> = (theme: Theme) => T;

/**
 * Build a StyleSheet from the active theme, caching one sheet per scheme.
 *
 * Usage mirrors the old pattern closely, so migrating a screen is mechanical:
 *
 *   const styles = useThemedStyles(makeStyles);
 *   ...
 *   const makeStyles = ({ colors, spacing, type }: Theme) => StyleSheet.create({ … });
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: StyleFactory<T>,
  force?: ColorScheme,
): T {
  const theme = useTheme(force);
  const cache = useRef<Partial<Record<ColorScheme, T>>>({});

  return useMemo(() => {
    const hit = cache.current[theme.scheme];
    if (hit) return hit;
    const built = factory(theme);
    cache.current[theme.scheme] = built;
    return built;
    // `factory` is a module-level function in every call site, so it is stable;
    // depending on it would defeat the cache for inline factories anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.scheme, theme]);
}

/** Convenience for components that only need colours. */
export function useColors(): Palette {
  return useTheme().colors;
}

export { ThemeContext };
