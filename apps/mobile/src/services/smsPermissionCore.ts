/**
 * Why the emergency-SMS permission (SEND_SMS) is or is not available, and
 * what the user has to do about it. Pure, so it is unit tested.
 *
 * The reason it was "denied by Android" without any dialog: since Android 15,
 * SMS is a *restricted* permission for apps installed from an APK file or a
 * browser download (not from an app store). Android refuses the request
 * outright until the user opens the app's info page, taps ⋮ → "Allow
 * restricted settings", and then allows SMS. No app can skip that step — it
 * is an OS protection against SMS malware — so the app has to detect it and
 * walk the user through it. Installs from Google Play are not restricted.
 */

export type SmsPermissionState =
  /** Granted: emergency SMS goes out silently. */
  | 'granted'
  /** Not granted yet, Android will show its normal "Allow" dialog. */
  | 'askable'
  /** Android 15+ sideloaded install: needs "Allow restricted settings" first. */
  | 'restricted'
  /** Denied with "Don't ask again" (or by an OEM security app): Settings only. */
  | 'blocked'
  /** Not an Android phone with telephony (iOS, tablet without SIM, web). */
  | 'unsupported';

export interface InstallInfo {
  sdk: number;
  /** PackageInstaller.PACKAGE_SOURCE_* (Android 13+), -1 when unknown. */
  packageSource: number;
  installer: string | null;
  sideloaded: boolean;
}

/** android.content.pm.PackageInstaller.PACKAGE_SOURCE_* */
export const PACKAGE_SOURCE = { UNSPECIFIED: 0, OTHER: 1, STORE: 2, LOCAL_FILE: 3, DOWNLOADED_FILE: 4 } as const;
/** Android 15 (VANILLA_ICE_CREAM): SMS becomes a restricted permission for sideloaded apps. */
export const RESTRICTED_SMS_SDK = 35;

export function isSideloaded(info: Pick<InstallInfo, 'packageSource'>): boolean {
  return info.packageSource === PACKAGE_SOURCE.LOCAL_FILE || info.packageSource === PACKAGE_SOURCE.DOWNLOADED_FILE;
}

/** True when Android itself will refuse SEND_SMS until "Allow restricted settings" is used. */
export function restrictedByOs(info: InstallInfo | null): boolean {
  return !!info && info.sdk >= RESTRICTED_SMS_SDK && (info.sideloaded || isSideloaded(info));
}

/**
 * Work out the state.
 *
 * @param granted         PermissionsAndroid.check(SEND_SMS)
 * @param lastResult      the last PermissionsAndroid.request result, if any
 *                        ('granted' | 'denied' | 'never_ask_again')
 * @param info            install source, from the native module (null if unknown)
 * @param telephony       the phone can send SMS at all
 */
export function smsPermissionState(
  granted: boolean,
  lastResult: string | null,
  info: InstallInfo | null,
  telephony = true,
): SmsPermissionState {
  if (!telephony) return 'unsupported';
  if (granted) return 'granted';
  // A restricted permission is reported as "never ask again" without any
  // dialog, so check the install source before trusting that answer.
  if (restrictedByOs(info)) return 'restricted';
  if (lastResult === 'never_ask_again') return 'blocked';
  return 'askable';
}
