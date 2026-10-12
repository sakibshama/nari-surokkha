/**
 * Navigation from outside React components (the emergency runtime raises a
 * soft alert from a microphone callback, not from a screen).
 */
import { createNavigationContainerRef } from '@react-navigation/native';
import type { MainStackParamList } from './MainStack';

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

export function navigateMain<K extends keyof MainStackParamList>(
  name: K,
  params?: MainStackParamList[K],
): boolean {
  if (!navigationRef.isReady()) return false;
  // Screens live in a stack nested inside the drawer; navigate by name lets
  // React Navigation find the nested navigator.
  (navigationRef.navigate as (n: string, p?: object) => void)(name as string, params as object | undefined);
  return true;
}

export function currentRouteName(): string | undefined {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
}

/** Replace the current screen (used to swap the soft-alert modal for the SOS screen). */
export function replaceMain<K extends keyof MainStackParamList>(name: K, params?: MainStackParamList[K]): boolean {
  if (!navigationRef.isReady()) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StackActions } = require('@react-navigation/native') as typeof import('@react-navigation/native');
  navigationRef.dispatch(StackActions.replace(name as string, params as object | undefined));
  return true;
}
