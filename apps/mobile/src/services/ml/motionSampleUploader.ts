/**
 * motionSampleUploader — the real-data training loop.
 *
 * Captures the latest on-device sensor window and uploads it to the backend
 * as a LABELLED training sample:
 *   • confirmed_sos  → the user confirmed a real emergency (positive)
 *   • false_alarm    → the user dismissed an auto-alert (negative, "normal")
 *
 * These labelled windows are later pulled by services/ml-training/pull_samples.py
 * and folded into the next model version. Uploads are:
 *   • opt-in (mlDataSharingEnabled),
 *   • best-effort (never block or throw into the UI),
 *   • anonymised at rest (server stores only the numeric window + label).
 */

import api from '../api';
import { sensorProcessor } from './SensorProcessor';
import { MODEL_KIND, SAMPLE_RATE_HZ, MotionClass } from './modelConfig';
import { useSettingsStore } from '../../store/settingsStore';

type SampleSource = 'confirmed_sos' | 'false_alarm' | 'manual';

export async function uploadMotionSample(
  label: MotionClass,
  source: SampleSource,
): Promise<void> {
  try {
    if (!useSettingsStore.getState().mlDataSharingEnabled) return;

    const window = sensorProcessor.getLastWindow();
    if (!window) return; // buffer not full yet — nothing meaningful to send

    await api.post('/ml/samples', {
      kind: MODEL_KIND,
      label,
      source,
      window,
      sampleRate: SAMPLE_RATE_HZ,
    });
  } catch {
    // Non-fatal: training-data collection must never affect the emergency flow.
  }
}

/**
 * Convenience for the SOS confirm path: use the model's own last prediction as
 * the positive label when it was an emergency, else fall back to 'struggle'.
 */
export async function uploadConfirmedEmergencySample(): Promise<void> {
  const pred = sensorProcessor.getLastPrediction();
  const label: MotionClass =
    pred && pred.isEmergency ? (pred.label as MotionClass) : 'struggle';
  await uploadMotionSample(label, 'confirmed_sos');
}
