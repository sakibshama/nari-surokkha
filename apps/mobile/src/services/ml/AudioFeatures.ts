/**
 * Feature extraction for the on-device audio distress model.
 *
 * EXACT port of services/ml-training/audio_features.py. Given a mono waveform
 * (Float array ~[-1,1] at 16 kHz) it produces the same 26 features, in the same
 * order, so a model trained in Python behaves identically on device.
 *
 * Parity notes:
 *  - The mel filterbank and Hann window are passed in from the model JSON, so
 *    they are byte-identical to training (no re-derivation here).
 *  - numpy uses population std (ddof=0); we match that.
 *  - The FFT below is a standard radix-2 Cooley–Tukey; its magnitudes match
 *    numpy.fft.rfft to floating-point precision, which after log + mean-pooling
 *    is negligible.
 */

export interface AudioFeatureParams {
  frameSize: number;
  hopSize: number;
  nFftBins: number;
  sampleRateHz: number;
  rolloffPercent: number;
  eps: number;
  melFilterbank: number[][]; // (nMel, nFftBins)
  hannWindow: number[];      // (frameSize,)
}

/* ── radix-2 FFT (in-place, complex) ───────────────────────────── */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wpr = Math.cos(ang);
    const wpi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr;
        wr = nwr;
      }
    }
  }
}

function mean(a: number[] | Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

function std(a: number[] | Float64Array): number {
  if (!a.length) return 0;
  const mu = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - mu) * (a[i] - mu);
  return Math.sqrt(s / a.length); // population std (ddof=0), matches numpy
}

/**
 * Extract the 26-feature vector from a waveform.
 * Returns numbers in the exact FEATURE_NAMES order of audio_features.py.
 */
export function extractAudioFeatures(waveform: ArrayLike<number>, p: AudioFeatureParams): number[] {
  const { frameSize, hopSize, nFftBins, sampleRateHz, rolloffPercent, eps, melFilterbank, hannWindow } = p;
  const nMel = melFilterbank.length;

  // waveform -> frames
  const x = waveform;
  const N = x.length;
  const nFrames = N < frameSize ? 1 : 1 + Math.floor((N - frameSize) / hopSize);

  // bin frequencies: linspace(0, SR/2, nFftBins)
  const binFreq = new Float64Array(nFftBins);
  for (let k = 0; k < nFftBins; k++) binFreq[k] = (sampleRateHz / 2) * (k / (nFftBins - 1));

  // per-frame quantity accumulators: nMel bands + rms, zcr, centroid, rolloff, flatness
  const Q = nMel + 5;
  const perFrame: number[][] = Array.from({ length: Q }, () => new Array(nFrames).fill(0));

  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  const mag = new Float64Array(nFftBins);

  for (let f = 0; f < nFrames; f++) {
    const off = f * hopSize;

    // time-domain: rms + zcr on the raw frame
    let sumSq = 0;
    let zc = 0;
    let prevSign = 0;
    for (let n = 0; n < frameSize; n++) {
      const v = off + n < N ? x[off + n] : 0;
      sumSq += v * v;
      const sign = v >= 0 ? 1 : -1; // np.sign with 0->1 handling: 0 treated as +1
      if (n > 0 && sign !== prevSign) zc++;
      prevSign = sign;
      // windowed copy for FFT
      re[n] = v * hannWindow[n];
      im[n] = 0;
    }
    const rms = Math.sqrt(sumSq / frameSize + eps);
    const zcr = zc / (frameSize - 1);

    // spectrum
    fftRadix2(re, im);
    let magSum = 0;
    let powSum = 0;
    let logPowSum = 0;
    for (let k = 0; k < nFftBins; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      magSum += m;
      const pw = m * m;
      powSum += pw;
      logPowSum += Math.log(pw + eps);
    }
    magSum += eps;

    // mel band energies (spec @ filterbank.T) then log
    for (let mI = 0; mI < nMel; mI++) {
      const row = melFilterbank[mI];
      let e = 0;
      for (let k = 0; k < nFftBins; k++) e += mag[k] * row[k];
      perFrame[mI][f] = Math.log(e + eps);
    }

    // spectral centroid
    let cen = 0;
    for (let k = 0; k < nFftBins; k++) cen += mag[k] * binFreq[k];
    cen /= magSum;

    // spectral rolloff: lowest freq bin where cumulative magnitude reaches
    // rolloffPercent of the total magnitude
    let cum = 0;
    const total = magSum - eps;
    const targ = rolloffPercent * total;
    let rollBin = 0;
    for (let k = 0; k < nFftBins; k++) {
      cum += mag[k];
      if (cum >= targ) { rollBin = k; break; }
    }
    const rolloff = binFreq[rollBin];

    // spectral flatness = geomean(power) / mean(power)
    const geo = Math.exp(logPowSum / nFftBins);
    const arith = powSum / nFftBins + eps;
    const flatness = geo / arith;

    perFrame[nMel + 0][f] = rms;
    perFrame[nMel + 1][f] = zcr;
    perFrame[nMel + 2][f] = cen;
    perFrame[nMel + 3][f] = rolloff;
    perFrame[nMel + 4][f] = flatness;
  }

  // aggregate: mean of each quantity, then std of each quantity
  const means: number[] = new Array(Q);
  const stds: number[] = new Array(Q);
  for (let q = 0; q < Q; q++) {
    means[q] = mean(perFrame[q]);
    stds[q] = std(perFrame[q]);
  }
  return means.concat(stds);
}
