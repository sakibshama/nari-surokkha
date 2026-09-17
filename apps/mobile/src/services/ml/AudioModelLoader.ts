/**
 * Audio model loader — delivers the on-device audio distress model with OTA
 * updates and a bundled fallback. Mirror of ModelLoader (motion).
 *
 * Resolution order at startup:
 *   1. Cached OTA model in AsyncStorage (if version >= bundled) — instant.
 *   2. Bundled model shipped in the app binary (guaranteed to exist).
 * Then checkForUpdate() asks the server for the active audio model; if newer,
 * the JSON is downloaded, cached, and swapped in — no app-store release needed.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';
import { AudioClassifier, AudioModelJSON } from './AudioClassifier';
import { MODEL_KIND } from './audioModelConfig';
// Bundled fallback — Metro bundles JSON via import.
import bundledAudioModel from '../../../assets/models/audio_model.json';

const CACHE_MODEL_KEY = '@ml_audio_model';
const CACHE_VERSION_KEY = '@ml_audio_version';

class AudioModelLoader {
  private classifier: AudioClassifier | null = null;
  private loading: Promise<AudioClassifier> | null = null;

  async get(): Promise<AudioClassifier> {
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

  private async load(): Promise<AudioClassifier> {
    const bundled = bundledAudioModel as unknown as AudioModelJSON;
    try {
      const [cachedJson, cachedVer] = await Promise.all([
        AsyncStorage.getItem(CACHE_MODEL_KEY),
        AsyncStorage.getItem(CACHE_VERSION_KEY),
      ]);
      if (cachedJson && cachedVer && Number(cachedVer) >= bundled.version) {
        const model = JSON.parse(cachedJson) as AudioModelJSON;
        if (__DEV__) console.log(`[ML] Loaded cached audio model v${model.version}`);
        return new AudioClassifier(model);
      }
    } catch (e) {
      if (__DEV__) console.warn('[ML] Audio cache load failed, using bundled model', e);
    }
    if (__DEV__) console.log(`[ML] Loaded bundled audio model v${bundled.version}`);
    return new AudioClassifier(bundled);
  }

  async checkForUpdate(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      const current = await this.get();
      const res = await api.get('/ml/model/active', { params: { kind: MODEL_KIND } });
      const active = res.data?.data;
      if (!active || active.format !== 'json') return;
      if (active.version <= current.version) return;

      const modelRes = await fetch(active.downloadUrl);
      if (!modelRes.ok) return;
      const model = (await modelRes.json()) as AudioModelJSON;
      if (!model.layers || !model.standardize || !model.melFilterbank) return; // sanity check

      await AsyncStorage.multiSet([
        [CACHE_MODEL_KEY, JSON.stringify(model)],
        [CACHE_VERSION_KEY, String(model.version)],
      ]);
      this.classifier = new AudioClassifier(model);
      if (__DEV__) console.log(`[ML] Updated audio model to v${model.version} (OTA)`);
    } catch (e) {
      if (__DEV__) console.warn('[ML] Audio model update check failed (non-fatal)', e);
    }
  }
}

export const audioModelLoader = new AudioModelLoader();
