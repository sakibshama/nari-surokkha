import { useEffect, useState } from 'react';
import { detector, softAlerts } from './runtime';
import type { DetectorStatus, LiveScores } from './EmergencySoundDetector';
import type { ActiveSoftAlert } from './SoftAlertManager';

export function useDetectorStatus(): DetectorStatus {
  const [s, setS] = useState<DetectorStatus>(detector.getStatus());
  useEffect(() => detector.onStatus(setS), []);
  return s;
}

/** Live model scores (≈5 per second) while `enabled`. */
export function useLiveScores(enabled: boolean): LiveScores | null {
  const [s, setS] = useState<LiveScores | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const off = detector.onLiveScores(setS);
    return () => {
      off();
    };
  }, [enabled]);
  return s;
}

export function useSoftAlert(): ActiveSoftAlert | null {
  const [a, setA] = useState<ActiveSoftAlert | null>(softAlerts.active);
  useEffect(() => softAlerts.subscribe(setA), []);
  return a;
}
