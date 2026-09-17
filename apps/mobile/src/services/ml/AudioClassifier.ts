/**
 * AudioClassifier — pure-TypeScript inference for the audio distress model.
 *
 * Mirror of MotionClassifier. Runs the small MLP exported by
 * services/ml-training/audio_train.py entirely on device (no native runtime).
 * Forward pass:
 *   waveform -> features -> standardize -> [Dense+ReLU]* -> Dense+Softmax
 *
 * Weight layout matches scikit-learn's MLPClassifier: each layer's W has shape
 * [nIn][nOut], so out[j] = sum_i x[i]*W[i][j] + b[j].
 */

import { extractAudioFeatures, AudioFeatureParams } from './AudioFeatures';
import { EMERGENCY_CLASSES } from './audioModelConfig';

export interface AudioModelJSON {
  kind: string;
  version: number;
  sampleRateHz: number;
  clipSize: number;
  frameSize: number;
  hopSize: number;
  nFftBins: number;
  nMelBands: number;
  rolloffPercent: number;
  eps: number;
  classes: string[];
  emergencyClasses: string[];
  featureNames: string[];
  melFilterbank: number[][];
  hannWindow: number[];
  standardize: { mean: number[]; std: number[] };
  layers: { W: number[][]; b: number[] }[];
  activations: string[];
  metrics?: Record<string, unknown>;
}

export interface AudioPrediction {
  label: string;
  confidence: number;
  probs: Record<string, number>;
  isEmergency: boolean;
  emergencyConfidence: number; // max prob across emergency classes
}

function relu(v: number[]): number[] {
  return v.map((x) => (x > 0 ? x : 0));
}

function softmax(v: number[]): number[] {
  const m = Math.max(...v);
  const exps = v.map((x) => Math.exp(x - m));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function denseForward(input: number[], W: number[][], b: number[]): number[] {
  const nOut = b.length;
  const out = new Array(nOut).fill(0);
  for (let j = 0; j < nOut; j++) {
    let s = b[j];
    for (let i = 0; i < input.length; i++) s += input[i] * W[i][j];
    out[j] = s;
  }
  return out;
}

export class AudioClassifier {
  private readonly params: AudioFeatureParams;

  constructor(private readonly model: AudioModelJSON) {
    this.params = {
      frameSize: model.frameSize,
      hopSize: model.hopSize,
      nFftBins: model.nFftBins,
      sampleRateHz: model.sampleRateHz,
      rolloffPercent: model.rolloffPercent,
      eps: model.eps,
      melFilterbank: model.melFilterbank,
      hannWindow: model.hannWindow,
    };
  }

  get version(): number {
    return this.model.version;
  }

  predictFromFeatures(features: number[]): AudioPrediction {
    const { mean, std } = this.model.standardize;
    let x = features.map((f, i) => (f - mean[i]) / (std[i] || 1));

    for (let l = 0; l < this.model.layers.length; l++) {
      const { W, b } = this.model.layers[l];
      x = denseForward(x, W, b);
      const act = this.model.activations[l];
      if (act === 'relu') x = relu(x);
      else if (act === 'softmax') x = softmax(x);
    }

    const classes = this.model.classes;
    const probs: Record<string, number> = {};
    let bestIdx = 0;
    for (let i = 0; i < classes.length; i++) {
      probs[classes[i]] = x[i];
      if (x[i] > x[bestIdx]) bestIdx = i;
    }

    const emergencyClasses = this.model.emergencyClasses?.length
      ? this.model.emergencyClasses
      : EMERGENCY_CLASSES;
    let emergencyConfidence = 0;
    for (const c of emergencyClasses) {
      if (probs[c] !== undefined && probs[c] > emergencyConfidence) emergencyConfidence = probs[c];
    }

    const label = classes[bestIdx];
    return {
      label,
      confidence: x[bestIdx],
      probs,
      isEmergency: emergencyClasses.includes(label),
      emergencyConfidence,
    };
  }

  /** waveform: mono Float array (~[-1,1]) at model.sampleRateHz, clipSize long. */
  predict(waveform: ArrayLike<number>): AudioPrediction {
    return this.predictFromFeatures(extractAudioFeatures(waveform, this.params));
  }
}
