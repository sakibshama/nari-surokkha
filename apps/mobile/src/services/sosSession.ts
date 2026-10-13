/**
 * The SOS lifecycle, tied to SOS STATE rather than to the SOS screen:
 * whenever `isSosActive` turns on (Home, a soft alert, the offline
 * escalation, or an app restart with a persisted SOS) tracking starts and the
 * socket joins the alert room; when it turns off, both stop. Leaving the SOS
 * screen changes nothing.
 */
import { AppState } from 'react-native';
import api from './api';
import { socketService } from './socket';
import { startLocationTracking, stopLocationTracking } from './backgroundTasks';
import { hydrateSosState, useLocationStore } from '../store/locationStore';

const ENDED_STATUSES = new Set(['resolved', 'closed', 'false_alarm', 'cancelled']);

function begin(alertId: string) {
  void socketService.connect().then(() => socketService.setAlertContext(alertId));
  void startLocationTracking('sos', { interactive: AppState.currentState === 'active' }).catch((e) => {
    if (__DEV__) console.warn('[SOS] tracking failed to start', e);
  });
}

function end(alertId: string | null) {
  if (alertId) socketService.leaveAlert(alertId);
  void stopLocationTracking('sos');
}

/** Called once while signed in. Returns the teardown. */
export function initSosSession(): () => void {
  let disposed = false;
  void hydrateSosState().then(async () => {
    const { isSosActive, activeAlertId } = useLocationStore.getState();
    if (disposed || !isSosActive || !activeAlertId) return;
    // A restored SOS may have been ended while the app was closed (by the
    // user elsewhere, an admin, or the server). If the server can't be
    // reached, keep tracking: a live emergency must not silently stop.
    try {
      const res = await api.get(`/alerts/${activeAlertId}/status`, { timeout: 8000 });
      const status: string | undefined = res.data?.data?.status;
      if (status && ENDED_STATUSES.has(status)) {
        useLocationStore.getState().setSosActive(false);
        return;
      }
    } catch {
      /* offline or older server: resume */
    }
    if (!disposed && useLocationStore.getState().isSosActive) begin(activeAlertId);
  });

  const unsub = useLocationStore.subscribe((s, p) => {
    if (!s.sosHydrated) return;
    const was = p.isSosActive ? p.activeAlertId : null;
    const now = s.isSosActive ? s.activeAlertId : null;
    if (was === now) return;
    if (was) end(was);
    if (now) begin(now);
  });

  // An admin (or the server) closed the alert: stop here too.
  const onStatus = (msg: { alertId?: string; status?: string }) => {
    const { activeAlertId } = useLocationStore.getState();
    if (msg?.alertId && msg.alertId === activeAlertId && msg.status && ENDED_STATUSES.has(msg.status)) {
      useLocationStore.getState().setSosActive(false);
    }
  };
  socketService.on('alert_status_update', onStatus);

  return () => {
    disposed = true;
    unsub();
    socketService.off('alert_status_update', onStatus);
  };
}

/**
 * End the SOS. "I'm safe" resolves it on the server (POST /alerts/:id/resolve);
 * an older server without that route gets the cancel call instead. Tracking
 * stops either way; `serverOk` says whether the server heard it.
 */
export async function endSos(alertId: string): Promise<{ serverOk: boolean }> {
  let serverOk = true;
  try {
    await api.post(`/alerts/${alertId}/resolve`);
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 405) {
      serverOk = await api.patch(`/alerts/${alertId}/cancel`).then(() => true, () => false);
    } else {
      // 409 etc.: already ended on the server — fine. No response: offline.
      serverOk = !!status && status < 500;
    }
  }
  const { activeAlertId } = useLocationStore.getState();
  if (activeAlertId === alertId) useLocationStore.getState().setSosActive(false);
  return { serverOk };
}
