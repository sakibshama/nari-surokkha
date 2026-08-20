import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import api from './api';
import { useLocationStore } from '../store/locationStore';
import { sendOrQueue, flush, clear as clearOutbox } from './locationOutbox';

const LOCATION_TASK_NAME = 'background-location-task';

if (Platform.OS !== 'web') {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      if (__DEV__) console.error('Background location task error:', error);
      return;
    }
    if (data) {
      const { locations } = data as any;
      if (locations && locations.length > 0) {
        const loc = locations[0];
        const { isSosActive, activeAlertId, activeRouteId } = useLocationStore.getState();

        try {
          if (isSosActive && activeAlertId) {
            // Queued rather than dropped when offline. Coverage is worst
            // exactly where this app matters most, and a silent gap in the
            // trail is indistinguishable from "she stopped moving".
            const delivered = await sendOrQueue({
              alertId: activeAlertId,
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy ?? undefined,
              timestamp: new Date(loc.timestamp ?? Date.now()).toISOString(),
            });

            // A ping getting through is the clearest signal connectivity is
            // back — drain anything that queued up while it was not.
            if (delivered) {
              const { sent } = await flush();
              if (__DEV__ && sent > 0) console.log(`Flushed ${sent} queued location pings`);
            }
          }

          if (activeRouteId) {
            const res = await api.post(`/alerts/safe-route/${activeRouteId}/location`, {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
            
            if (res.data?.data?.deviated) {
              if (__DEV__) console.log('Background route deviation detected');
              // We could trigger a local push notification here to warn the user
            }
          }
        } catch (err) {
          if (__DEV__) console.error('Failed to send background location:', err);
        }
      }
    }
  });
}

export const startBackgroundLocationUpdates = async () => {
  if (Platform.OS === 'web') return;
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status === 'granted') {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      // Adaptive by distance rather than fixed by time. `distanceInterval`
      // suppresses updates while the phone is stationary, so a victim waiting
      // in one place stops burning battery and quota on identical fixes, while
      // someone being moved still reports every 10s. Battery life during an
      // emergency is not a minor concern — the tracking link is only useful
      // for as long as the phone is alive.
      timeInterval: 10000,
      distanceInterval: 10,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Nari Surokkha is active',
        notificationBody: 'Monitoring your safety in the background',
        notificationColor: '#ef4444',
      },
    });
    if (__DEV__) console.log('Background location updates started');
  } else {
    if (__DEV__) console.warn('Background location permission denied');
  }
};

export const stopBackgroundLocationUpdates = async () => {
  // The alert is over; a queued trail from it is no longer useful and must not
  // be delivered against the next one.
  await clearOutbox();
  if (Platform.OS === 'web') return;
  const hasTask = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (hasTask) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (__DEV__) console.log('Background location updates stopped');
  }
};
