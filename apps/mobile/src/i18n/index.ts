/**
 * Lightweight i18n — English / বাংলা.
 *
 * English strings are the keys, so a screen reads naturally
 * (`t('Trusted Contacts')`) and a missing Bangla entry falls back to English
 * instead of rendering a raw key. No extra native dependency, so EAS builds
 * are unaffected.
 *
 * Interpolation: `t('Alerting in {n}s', { n: 5 })`. Numbers are rendered with
 * Bangla digits when the language is Bangla.
 *
 * The chosen language is persisted. First launch defaults to Bangla on a
 * Bangla-locale phone and English everywhere else.
 */

import { useCallback } from 'react';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { toBnDigits, translate, type Language, type TFunction, type TVars } from './core';

export { toBnDigits, translate } from './core';
export type { Language, TFunction, TVars } from './core';

const STORAGE_KEY = 'app_language_v1';

function deviceDefault(): Language {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    return locale.toLowerCase().startsWith('bn') ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

interface LanguageState {
  lang: Language;
  hydrated: boolean;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  hydrate: () => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  lang: deviceDefault(),
  hydrated: false,
  setLang: (lang) => {
    set({ lang });
    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {
      /* preference just won't survive a restart */
    });
  },
  toggleLang: () => get().setLang(get().lang === 'en' ? 'bn' : 'en'),
  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'bn') set({ lang: stored });
    } catch {
      /* fall back to the device default */
    } finally {
      set({ hydrated: true });
    }
  },
}));


/** Translate outside React (alerts from services, notifications). */
export const tStatic: TFunction = (key, vars) =>
  translate(useLanguageStore.getState().lang, key, vars);

/** Hook: `t(key, vars?)` bound to the current language. Re-renders on change. */
export function useT(): TFunction {
  const lang = useLanguageStore((s) => s.lang);
  return useCallback((key: string, vars?: TVars) => translate(lang, key, vars), [lang]);
}

/** Hook: the current language plus setters and a digit formatter. */
export function useLanguage() {
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);
  const toggleLang = useLanguageStore((s) => s.toggleLang);
  const num = useCallback(
    (n: number | string) => (lang === 'bn' ? toBnDigits(n) : String(n)),
    [lang],
  );
  return { lang, setLang, toggleLang, num, isBangla: lang === 'bn' };
}
