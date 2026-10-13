/**
 * Phone number matching helpers.
 *
 * Trusted contacts are typed in by hand, so the same person is stored as
 * "+8801712345678", "8801712345678", "01712345678" or "01712-345678"
 * depending on who entered it. Matching a contact against a registered user
 * with `findUnique({ where: { phone } })` therefore missed most of the time —
 * which silently meant "this contact never gets a push notification", the
 * quiet half of an emergency fan-out.
 *
 * Rather than rewrite everyone's stored numbers, we generate the plausible
 * representations of a number and match with `IN`.
 */

/** Bangladesh country calling code. */
const BD_CC = '880';

/** Strip everything that is not a digit or a leading '+'. */
export function cleanPhone(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return plus ? `+${digits}` : digits;
}

/**
 * Reduce a number to its national significant digits — no country code, no
 * trunk '0'. For Bangladesh mobiles that is the 10 digits starting with '1'
 * (e.g. 1712345678).
 */
export function nationalDigits(raw: string): string {
  let d = cleanPhone(raw).replace(/^\+/, '');
  if (d.startsWith(BD_CC)) d = d.slice(BD_CC.length);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  return d;
}

/**
 * Every representation the same number might be stored as, most-canonical
 * first. Use with `where: { phone: { in: phoneVariants(x) } }`.
 *
 * Returns the cleaned input alone for numbers that are not recognisably
 * Bangladeshi, so international contacts still match exactly.
 */
export function phoneVariants(raw: string): string[] {
  const cleaned = cleanPhone(raw);
  const national = nationalDigits(raw);

  // Bangladeshi mobile numbers are 10 national digits beginning with '1'.
  const isBdMobile = /^1\d{9}$/.test(national);
  if (!isBdMobile) {
    return cleaned ? [cleaned] : [];
  }

  return [...new Set([
    `+${BD_CC}${national}`, // +8801712345678
    `${BD_CC}${national}`, //   8801712345678
    `0${national}`, //          01712345678
    national, //                1712345678
    cleaned, //                 whatever was actually passed in
  ])].filter(Boolean);
}

/** True when two numbers refer to the same subscriber. */
export function isSamePhone(a: string, b: string): boolean {
  const na = nationalDigits(a);
  const nb = nationalDigits(b);
  if (na && nb) return na === nb;
  return cleanPhone(a) === cleanPhone(b);
}

/**
 * One canonical form per subscriber: E.164 (+8801XXXXXXXXX) for Bangladeshi
 * mobiles, the cleaned input otherwise. Used wherever a number is a key
 * (OTP state, verification tokens).
 */
export function normalizePhone(raw: string): string {
  return phoneVariants(raw)[0] ?? cleanPhone(raw);
}
