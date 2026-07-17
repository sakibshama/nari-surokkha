/**
 * MotionClassifier — pure-TypeScript inference for the motion model.
 *
 * Runs the small MLP exported by services/ml-training/train.py entirely on
 * device (no native runtime, no server call). Forward pass:
 *   features -> standardize((x-mean)/std) -> [Dense+ReLU]* -> Dense+Softmax
 *
 * The weight layout matches scikit-learn's MLPClassifier: each layer's W has
 * shape [nIn][nOut], so out[j] = sum_i x[i]*W[i][j] + b[j].
 */

import { extractFeatures } from './features';
import { EMERGENCY_CLASSES } from './modelConfig';

export interface MotionModelJSON {
  kind: string;
  version: number;
  windowSize: number;
  sampleRateHz: number;
  channels: string[];
  classes: string[];
  emergencyClasses: string[];
  featureNames: string[];
  standardize: { mean: number[]; std: number[] };
  layers: { W: number[][]; b: number[] }[];
  activations: string[]; // e.g. ['relu','softmax']
  metrics?: Record<string, unknown>;
}

export interface MotionPrediction {
  label: string;
  confidence: number; // prob of the winning class
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

export class MotionClassifier {
  constructor(private readonly model: MotionModelJSON) {}

  get version(): number {
    return this.model.version;
  }

  predictFromFeatures(features: number[]): MotionPrediction {
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

  predict(window: number[][]): MotionPrediction {
    return this.predictFromFeatures(extractFeatures(window));
  }
}
