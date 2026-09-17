/**
 * Cross-platform alerts.
 *
 * `Alert.alert()` from react-native is a SILENT NO-OP on react-native-web
 * (see react-native-web/dist/exports/Alert: `static alert() {}`). Every
 * failure message in the app therefore vanished when running in a browser —
 * including "Location required", "SOS failed" and "No trusted contacts", which
 * is why pressing SOS on web looked like nothing happened at all.
 *
 * `showAlert` keeps the familiar Alert.alert signature and works everywhere:
 * native gets the real dialog, web gets window.confirm/alert plus a toast so
 * the message is visible even if dialogs are blocked by the browser.
 */

import { Alert, AlertButton, Platform } from 'react-native';
import Toast from 'react-native-toast-message';

export type NotifyButton = AlertButton;

/** A visible, non-blocking message. Works on web and native. */
export function toast(title: string, message?: string, type: 'success' | 'error' | 'info' = 'info'): void {
  try {
    Toast.show({ type, text1: title, text2: message, position: 'top', visibilityTime: 4000 });
  } catch {
    /* never let a toast break a flow */
  }
}

/**
 * Show a dialog. Falls back to window.confirm/alert on web.
 *
 * Buttons follow Alert.alert semantics: the first non-cancel button is treated
 * as the confirm action on web, and cancel/dismiss runs the `cancel` button's
 * onPress if it has one.
 */
export function showAlert(title: string, message?: string, buttons?: NotifyButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;
  const confirmBtn = buttons?.find((b) => b.style !== 'cancel');
  const cancelBtn = buttons?.find((b) => b.style === 'cancel');

  // Mirror it as a toast too: some browsers suppress dialogs, and a safety app
  // must never fail silently.
  toast(title, message, /fail|error|could not|denied|unavailable/i.test(text) ? 'error' : 'info');

  try {
    if (buttons && buttons.length > 1) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(text);
      if (ok) confirmBtn?.onPress?.();
      else cancelBtn?.onPress?.();
      return;
    }
    // eslint-disable-next-line no-alert
    window.alert(text);
    confirmBtn?.onPress?.();
  } catch {
    /* dialogs blocked — the toast above already carried the message */
  }
}

/** Promise form, for `if (await confirmAlert(...))` flows. */
export function confirmAlert(title: string, message?: string, confirmLabel?: string, cancelLabel?: string): Promise<boolean> {
  return new Promise((resolve) => {
    showAlert(title, message, [
      { text: cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel ?? 'OK', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
