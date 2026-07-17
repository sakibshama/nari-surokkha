import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import api from './api';
import { useLocationStore } from '../store/locationStore';

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
            await api.post(`/alerts/${activeAlertId}/location`, {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
            });
            if (__DEV__) console.log('Background SOS location updated');
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
  if (Platform.OS === 'web') return;
  const hasTask = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (hasTask) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (__DEV__) console.log('Background location updates stopped');
  }
};
