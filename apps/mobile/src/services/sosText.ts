/**
 * The SOS text sent from the phone's own SIM, and SMS segment arithmetic.
 *
 * Pure (no React Native imports) so it is unit tested. The text is kept short
 * on purpose: every extra SMS part is another chance for a carrier to drop the
 * message, and Bangla text is UCS-2, where one part holds only 70 characters.
 */
import type { TFunction } from '../i18n/core';

export interface SosCoords {
  latitude: number;
  longitude: number;
}

/** A Google Maps link with 5 decimals (~1 m), short enough for one SMS part. */
export function mapsLink(c: SosCoords): string {
  return `https://maps.google.com/?q=${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

/** Compact SOS text: who, where, and one short line. */
export function buildSosText(t: TFunction, name: string | undefined, coords: SosCoords | null): string {
  const who = name?.trim() ?? '';
  if (coords) {
    const link = mapsLink(coords);
    return who ? t('SOS! {who} needs help. Location: {link}', { who, link }) : t('SOS! I need help. Location: {link}', { link });
  }
  return who ? t('SOS! {who} needs help. Location unknown, please call.', { who }) : t('SOS! I need help. Location unknown, please call me.');
}

// GSM 03.38 basic character set; the extension table costs two septets each.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

export interface SmsSegments {
  encoding: 'GSM-7' | 'UCS-2';
  /** Septets (GSM-7) or UTF-16 code units (UCS-2). */
  units: number;
  segments: number;
}

/** How many SMS parts a text needs, the way Android's divideMessage() counts. */
export function smsSegments(text: string): SmsSegments {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) septets += 1;
    else if (GSM_EXTENDED.includes(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    return { encoding: 'GSM-7', units: septets, segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  }
  const units = text.length; // UTF-16 code units
  return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** Keep only characters every phone can send in one plain (GSM-7) SMS part. */
function gsmOnly(text: string): string {
  let out = '';
  for (const ch of text) if (GSM_BASIC.includes(ch) && ch !== '\n' && ch !== '\r') out += ch;
  return out.replace(/\s+/g, ' ').trim();
}

/** The first http(s) link in a text (e.g. the live-tracking link in the server's template). */
export function firstLink(text: string | undefined | null): string | null {
  const m = /(https?:\/\/[^\s]+)/.exec(text ?? '');
  return m ? m[1].replace(/[).,;]+$/, '') : null;
}

/**
 * The SOS text sent from the phone's SIM: ALWAYS exactly one SMS part.
 *
 * A Bangla (UCS-2) SOS with a link needed 2–3 parts, and many phones and
 * Bangladeshi carriers deliver those parts as separate messages — the
 * contact saw "2–3 SMS" for one SOS. Plain-alphabet text fits 160
 * characters in a single part, so the SIM SMS is kept in English with the
 * link, and the name is shortened (or dropped) to make it fit.
 *
 * @param link  the live-tracking link if the server gave one, else a map link is used
 */
export function simSosText(name: string | undefined, coords: SosCoords | null, link?: string | null): string {
  const where = link || (coords ? mapsLink(coords) : null);
  const tail = where ? ` Location: ${where}` : ' Location unknown, please call.';
  const build = (who: string) => (who ? `SOS! ${who} needs help.${tail}` : `SOS! I need help.${tail}`);
  let who = gsmOnly(name ?? '');
  let text = build(who);
  while (smsSegments(text).segments > 1 && who.length > 0) {
    who = who.slice(0, Math.max(0, who.length - 4)).trim();
    text = build(who);
  }
  // A link so long that even the bare text needs two parts: use the map link.
  if (smsSegments(text).segments > 1 && coords && where !== mapsLink(coords)) return simSosText(name, coords, null);
  return text;
}
