/**
 * Model loader — delivers the on-device motion model with OTA updates and a
 * bundled fallback.
 *
 * Resolution order at startup:
 *   1. Cached OTA model in AsyncStorage (if version >= bundled) — instant.
 *   2. Bundled model shipped in the app binary (guaranteed to exist).
 * Then, in the background, checkForUpdate() asks the server for the active
 * model; if it is newer, the JSON is downloaded, cached, and swapped in — so
 * retrained models reach phones with no app-store release.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';
import { MotionClassifier, MotionModelJSON } from './MotionClassifier';
import { MODEL_KIND } from './modelConfig';
// Bundled fallback — Metro bundles JSON via import.
import bundledMotionModel from '../../../assets/models/motion_model.json';

const CACHE_MODEL_KEY = '@ml_motion_model';
const CACHE_VERSION_KEY = '@ml_motion_version';

class MotionModelLoader {
  private classifier: MotionClassifier | null = null;
  private loading: Promise<MotionClassifier> | null = null;

  /** Returns a ready classifier, loading from cache/bundle on first call. */
  async get(): Promise<MotionClassifier> {
    if (this.classifier) return this.classifier;
    if (this.loading) return this.loading;
    this.loading = this.load();
    this.classifier = await this.loading;
    this.loading = null;
    return this.classifier;
  }

  get version(): number {
    return this.classifier?.version ?? 0;
  }

  private async load(): Promise<MotionClassifier> {
    const bundled = bundledMotionModel as unknown as MotionModelJSON;
    try {
      const [cachedJson, cachedVer] = await Promise.all([
        AsyncStorage.getItem(CACHE_MODEL_KEY),
        AsyncStorage.getItem(CACHE_VERSION_KEY),
      ]);
      if (cachedJson && cachedVer && Number(cachedVer) >= bundled.version) {
        const model = JSON.parse(cachedJson) as MotionModelJSON;
        if (__DEV__) console.log(`[ML] Loaded cached motion model v${model.version}`);
        return new MotionClassifier(model);
      }
    } catch (e) {
      if (__DEV__) console.warn('[ML] Cache load failed, using bundled model', e);
    }
    if (__DEV__) console.log(`[ML] Loaded bundled motion model v${bundled.version}`);
    return new MotionClassifier(bundled);
  }

  /**
   * Ask the server for the active model; download + cache if it is newer.
   * Safe to call on app start / resume — failures are non-fatal (offline etc).
   */
  async checkForUpdate(): Promise<void> {
    // No on-device inference on web, so there's nothing to update there.
    if (Platform.OS === 'web') return;
    try {
      const current = await this.get();
      const res = await api.get('/ml/model/active', { params: { kind: MODEL_KIND } });
      const active = res.data?.data;
      if (!active || active.format !== 'json') return;
      if (active.version <= current.version) return;

      const modelRes = await fetch(active.downloadUrl);
      if (!modelRes.ok) return;
      const model = (await modelRes.json()) as MotionModelJSON;
      if (!model.layers || !model.standardize) return; // sanity check

      await AsyncStorage.multiSet([
        [CACHE_MODEL_KEY, JSON.stringify(model)],
        [CACHE_VERSION_KEY, String(model.version)],
      ]);
      this.classifier = new MotionClassifier(model);
      if (__DEV__) console.log(`[ML] Updated motion model to v${model.version} (OTA)`);
    } catch (e) {
      if (__DEV__) console.warn('[ML] Model update check failed (non-fatal)', e);
    }
  }
}

export const motionModelLoader = new MotionModelLoader();
