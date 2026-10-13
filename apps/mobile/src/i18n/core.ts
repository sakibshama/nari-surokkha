/**
 * Pure translation helpers (no React Native imports), shared by the app and
 * the node tests.
 */
import { bn } from './bn';

export type Language = 'en' | 'bn';

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** Convert ASCII digits to Bangla digits. */
export function toBnDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export type TVars = Record<string, string | number>;
export type TFunction = (key: string, vars?: TVars) => string;

export function translate(lang: Language, key: string, vars?: TVars): string {
  const template = lang === 'bn' ? bn[key] ?? key : key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    const value = vars[name];
    return lang === 'bn' && typeof value === 'number' ? toBnDigits(value) : String(value);
  });
}
