/**
 * Loads the four bundled TFLite models through react-native-fast-tflite and
 * adapts them to the TensorModel interface.
 *
 * Models (apps/mobile/assets/models/):
 *   yamnet.tflite            Google YAMNet, AudioSet sound events      4.1 MB
 *   kws_mel.tflite           speech_embedding mel front-end (1760 → 8×32)
 *   kws_embedding.tflite     speech_embedding (76×32 → 96)
 *   kws_head.tflite          our Help / Bachao classifier (16×96 → 2)
 *
 * fast-tflite runs inference on a native thread (`run`), so the JS thread
 * stays free for the UI while the microphone is being analysed.
 */

import { Platform } from 'react-native';
import type { TensorModel } from './TensorModel';

export interface EmergencyModels {
  yamnet: TensorModel;
  kwsMel: TensorModel;
  kwsEmbedding: TensorModel;
  kwsHead: TensorModel;
}

interface FastTfliteModel {
  run(input: ArrayBuffer[]): Promise<ArrayBuffer[]>;
}

function wrap(model: FastTfliteModel): TensorModel {
  return {
    async run(inputs) {
      const buffers = inputs.map((a) =>
        a.byteOffset === 0 && a.byteLength === a.buffer.byteLength
          ? (a.buffer as ArrayBuffer)
          : (a.slice().buffer as ArrayBuffer),
      );
      const out = await model.run(buffers);
      return out.map((b) => new Float32Array(b));
    },
  };
}

let cached: Promise<EmergencyModels> | null = null;

/** Throws if the native module is missing (web, Expo Go, or an old dev build). */
export function loadEmergencyModels(): Promise<EmergencyModels> {
  if (Platform.OS === 'web') return Promise.reject(new Error('On-device detection is not available on web.'));
  if (!cached) {
    cached = (async () => {
      // Lazy require: a missing native module must not crash app start-up.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { loadTensorflowModel } = require('react-native-fast-tflite') as {
        loadTensorflowModel: (src: number, delegates: string[]) => Promise<FastTfliteModel>;
      };
      const [yamnet, kwsMel, kwsEmbedding, kwsHead] = await Promise.all([
        loadTensorflowModel(require('../../../assets/models/yamnet.tflite'), []),
        loadTensorflowModel(require('../../../assets/models/kws_mel.tflite'), []),
        loadTensorflowModel(require('../../../assets/models/kws_embedding.tflite'), []),
        loadTensorflowModel(require('../../../assets/models/kws_head.tflite'), []),
      ]);
      return {
        yamnet: wrap(yamnet),
        kwsMel: wrap(kwsMel),
        kwsEmbedding: wrap(kwsEmbedding),
        kwsHead: wrap(kwsHead),
      };
    })().catch((e) => {
      cached = null; // allow a retry after e.g. installing a new build
      throw e;
    });
  }
  return cached;
}
