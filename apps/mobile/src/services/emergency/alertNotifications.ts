/**
 * Local notifications for the soft alert. When the phone is in a pocket the
 * notification (plus vibration) is how the user learns an alert is counting
 * down — and its buttons let her cancel or send without unlocking.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { tStatic } from '../../i18n';

export const SOFT_ALERT_CHANNEL = 'soft-alerts';
export const SOFT_ALERT_CATEGORY = 'softalert'; // no ':' or '-' (expo-notifications rule)
export const ACTION_SAFE = 'SAFE';
export const ACTION_HELP = 'HELP';

let prepared: Promise<void> | null = null;

/** Channel + category. Idempotent; call again after a language change to relabel the buttons. */
export function prepareAlertNotifications(force = false): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (prepared && !force) return prepared;
  prepared = (async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(SOFT_ALERT_CHANNEL, {
          name: tStatic('Emergency detection'),
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 500, 300, 500, 300, 500],
          lightColor: '#ef4444',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          bypassDnd: true,
          sound: 'default',
        });
      }
      await Notifications.setNotificationCategoryAsync(SOFT_ALERT_CATEGORY, [
        { identifier: ACTION_SAFE, buttonTitle: tStatic("I'm safe"), options: { opensAppToForeground: false } },
        { identifier: ACTION_HELP, buttonTitle: tStatic('Send SOS now'), options: { opensAppToForeground: true } },
      ]);
    } catch (e) {
      if (__DEV__) console.warn('[notify] prepare failed', e);
    }
  })();
  return prepared;
}

export async function showSoftAlertNotification(alertId: string, triggerLabel: string, seconds: number): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    await prepareAlertNotifications();
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: tStatic('{trigger} detected — are you okay?', { trigger: triggerLabel }),
        body: tStatic('SOS will be sent to your contacts in {n} seconds. Tap "I\'m safe" to cancel.', { n: seconds }),
        data: { type: 'soft_alert', id: alertId },
        categoryIdentifier: SOFT_ALERT_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: true,
        sound: 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: SOFT_ALERT_CHANNEL } : null,
    });
  } catch (e) {
    if (__DEV__) console.warn('[notify] soft alert notification failed', e);
    return null;
  }
}

export async function showResultNotification(title: string, body: string, data: Record<string, unknown>): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, priority: Notifications.AndroidNotificationPriority.HIGH },
      trigger: Platform.OS === 'android' ? { channelId: SOFT_ALERT_CHANNEL } : null,
    });
  } catch {
    /* best effort */
  }
}

export async function dismissNotification(id: string | null): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    /* already gone */
  }
}
