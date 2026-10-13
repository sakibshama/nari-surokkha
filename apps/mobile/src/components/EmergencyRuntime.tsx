/**
 * <EmergencyRuntime/> — mounted while the user is signed in. Decides when the
 * microphone detector should run and keeps it in step with:
 *   - the detection settings (master switch, background listening),
 *   - the app being in the foreground or background,
 *   - an active SOS (the SOS screen needs the microphone for the live call),
 *   - microphone permission.
 * It also turns notification button presses into cancel / confirm.
 */

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { detector, softAlerts } from '../services/emergency/runtime';
import { useDetectionSettings } from '../services/emergency/detectionSettings';
import { useAlertHistory } from '../services/emergency/alertHistory';
import { hasMicrophone, requestMicrophone, requestNotifications } from '../services/emergency/permissions';
import {
  isBackgroundServiceRunning,
  startBackgroundListening,
  stopBackgroundListening,
} from '../services/emergency/backgroundMonitor';
import { ACTION_HELP, ACTION_SAFE, prepareAlertNotifications } from '../services/emergency/alertNotifications';
import { microphoneStream } from '../services/emergency/MicrophoneStream';
import { hydrateSosState, useLocationStore } from '../store/locationStore';
import { initSosSession } from '../services/sosSession';
import { startOfflineEscalationWatcher } from '../services/offlineEscalation';
import { reconcileLocationTracking } from '../services/backgroundTasks';
import { useSettingsStore } from '../store/settingsStore';
import { useLanguageStore, tStatic } from '../i18n';
import { navigateMain } from '../navigation/navigationRef';
import { showAlert } from '../utils/notify';

let resyncHook: (() => void) | null = null;

export default function EmergencyRuntime() {
  const syncing = useRef(false);
  const again = useRef(false);

  // SOS tracking follows SOS state (including one restored after a restart),
  // and an SMS-only SOS goes online by itself when the connection returns.
  useEffect(() => {
    void useSettingsStore.getState().hydrate();
    const stopSession = initSosSession();
    const stopEscalation = startOfflineEscalationWatcher();
    void hydrateSosState().then(() => {
      if (!useLocationStore.getState().isSosActive) void reconcileLocationTracking();
    });
    return () => {
      stopSession();
      stopEscalation();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      // No microphone pipeline on web, but the settings/history screens still render.
      void useDetectionSettings.getState().hydrate();
      void useAlertHistory.getState().hydrate();
      return;
    }
    let alive = true;

    const sync = async () => {
      if (syncing.current) {
        again.current = true;
        return;
      }
      syncing.current = true;
      try {
        do {
          again.current = false;
          await syncOnce();
        } while (again.current && alive);
      } finally {
        syncing.current = false;
      }
    };

    const syncOnce = async () => {
      const s = useDetectionSettings.getState();
      if (!s.hydrated) return;
      const appActive = AppState.currentState === 'active';
      const sosActive = useLocationStore.getState().isSosActive;
      const micOk = await hasMicrophone();
      const supported = microphoneStream.isSupported();

      if (!s.enabled || !supported || !micOk) {
        detector.stop();
        await stopBackgroundListening();
        return;
      }
      if (sosActive) {
        // The SOS screen streams audio/video to responders; give it the mic.
        detector.pause('sos_active');
        await stopBackgroundListening();
        return;
      }

      if (s.background) {
        // Must be started while visible (Android 14+ rule for microphone services).
        if (appActive && !isBackgroundServiceRunning()) await startBackgroundListening();
      } else {
        await stopBackgroundListening();
      }

      const mayListen = appActive || (s.background && (Platform.OS === 'ios' || isBackgroundServiceRunning()));
      const st = detector.getStatus().state;
      if (mayListen) {
        if (st !== 'listening' && st !== 'starting') await detector.start();
      } else {
        detector.pause('background_disabled');
      }
    };

    (async () => {
      await Promise.all([
        useDetectionSettings.getState().hydrate(),
        useAlertHistory.getState().hydrate(),
        useSettingsStore.getState().hydrate(),
      ]);
      await prepareAlertNotifications();
      const s = useDetectionSettings.getState();
      if (!s.onboarded && s.enabled && !(await hasMicrophone())) {
        await new Promise<void>((resolve) => {
          showAlert(
            tStatic('Automatic emergency detection'),
            tStatic(
              'Nari Surokkha can listen for a shout, crying, "Help" or "Bachao" and start a 15-second alert to your trusted contacts. Audio is analysed on this phone only and is never recorded or uploaded.',
            ),
            [
              {
                text: tStatic('Not now'),
                style: 'cancel',
                onPress: () => resolve(),
              },
              {
                text: tStatic('Turn on'),
                onPress: async () => {
                  await requestMicrophone();
                  await requestNotifications();
                  resolve();
                },
              },
            ],
          );
        });
      }
      useDetectionSettings.getState().setOnboarded(true);
      if (alive) void sync();
    })();

    const unsubSettings = useDetectionSettings.subscribe((s, p) => {
      if (s.enabled !== p.enabled || s.background !== p.background || s.hydrated !== p.hydrated) void sync();
    });
    const unsubSos = useLocationStore.subscribe((s, p) => {
      if (s.isSosActive !== p.isSosActive) void sync();
    });
    const onAppState = (st: AppStateStatus) => {
      void sync();
      // Back in the foreground with a countdown running: show it.
      if (st === 'active' && softAlerts.active?.phase === 'counting') navigateMain('SoftAlert');
    };
    const appSub = AppState.addEventListener('change', onAppState);
    // Re-label notification buttons when the language changes.
    const unsubLang = useLanguageStore.subscribe((s, p) => {
      if (s.lang !== p.lang) void prepareAlertNotifications(true);
    });

    const handleResponse = (r: Notifications.NotificationResponse) => {
      const data = r.notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.type === 'soft_alert') {
        if (r.actionIdentifier === ACTION_SAFE) void softAlerts.cancel();
        else if (r.actionIdentifier === ACTION_HELP) void softAlerts.confirmNow();
        else if (softAlerts.active) navigateMain('SoftAlert');
      } else if (data?.type === 'active_sos' && typeof data.alertId === 'string') {
        navigateMain('ActiveSos', { alertId: data.alertId });
      } else if (data?.type === 'offline_sos') {
        navigateMain('OfflineSos');
      }
    };
    const respSub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    resyncHook = () => void sync();

    return () => {
      alive = false;
      unsubSettings();
      unsubSos();
      unsubLang();
      appSub.remove();
      respSub.remove();
      resyncHook = null;
      detector.stop();
      void stopBackgroundListening();
    };
  }, []);

  return null;
}

/** Re-evaluate after a permission or setting changed outside the settings store. */
export function requestDetectionResync(): void {
  resyncHook?.();
}
