/**
 * Push provider — token-aware routing.
 *
 * The mobile app (Expo) registers Expo push tokens ("ExponentPushToken[…]").
 * Those must be delivered via Expo's push service, which relays to FCM/APNs
 * using the credentials configured in the EAS project. Raw FCM device tokens
 * (if a future bare build registers them) go directly through Firebase Admin.
 */

import { getMessaging } from 'firebase-admin/messaging';
import { PushProvider } from './push.provider';
import { env } from '@/config/env';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isExpoToken(token: string): boolean {
  return token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken');
}

export class FirebasePushProvider implements PushProvider {
  async sendPush(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (isExpoToken(token)) {
      return this.sendViaExpo(token, title, body, data);
    }
    return this.sendViaFcm(token, title, body, data);
  }

  /** Expo push service — handles FCM/APNs relay for Expo-built apps. */
  private async sendViaExpo(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: token,
          title,
          body,
          data: data || {},
          sound: 'default',
          priority: 'high',
          channelId: 'emergency-alerts',
        }),
      });
      const json: any = await resp.json();
      const ticket = json?.data;
      if (ticket?.status === 'ok') {
        return { success: true, messageId: ticket.id };
      }
      return { success: false, error: ticket?.message || ticket?.details?.error || 'Expo push failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /** Direct FCM delivery for native device tokens. */
  private async sendViaFcm(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!env.FIREBASE_PROJECT_ID) {
        return { success: false, error: 'Firebase not configured' };
      }

      const message = {
        token,
        notification: { title, body },
        data: data || {},
        android: {
          priority: 'high' as const,
          notification: {
            channelId: 'emergency-alerts',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: { sound: 'default', badge: 1 },
          },
        },
      };

      const messageId = await getMessaging().send(message);
      return { success: true, messageId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
