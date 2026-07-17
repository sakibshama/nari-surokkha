/**
 * Feature extraction for the on-device motion model.
 *
 * EXACT port of services/ml-training/features.py — the 24 features must be
 * produced in the same order with the same math, or a model trained in Python
 * will misbehave on device. Uses population std (ddof = 0) to match numpy.
 *
 * Input : window as number[][], shape (WINDOW_SIZE, 6) = [ax,ay,az,gx,gy,gz]
 * Output: Float array of length 24 (see FEATURE_NAMES order in features.py)
 */

function mean(a: number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return a.length ? s / a.length : 0;
}

function std(a: number[], m?: number): number {
  if (a.length === 0) return 0;
  const mu = m ?? mean(a);
  let s = 0;
  for (const v of a) s += (v - mu) * (v - mu);
  return Math.sqrt(s / a.length); // population std (ddof=0), matches numpy
}

function min(a: number[]): number {
  let m = Infinity;
  for (const v of a) if (v < m) m = v;
  return m;
}

function max(a: number[]): number {
  let m = -Infinity;
  for (const v of a) if (v > m) m = v;
  return m;
}

function meanAbsDev(a: number[], m: number): number {
  let s = 0;
  for (const v of a) s += Math.abs(v - m);
  return a.length ? s / a.length : 0;
}

function meanSquares(a: number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return a.length ? s / a.length : 0;
}

export function extractFeatures(window: number[][]): number[] {
  const n = window.length;
  const ax: number[] = new Array(n);
  const ay: number[] = new Array(n);
  const az: number[] = new Array(n);
  const gx: number[] = new Array(n);
  const gy: number[] = new Array(n);
  const gz: number[] = new Array(n);
  const accMag: number[] = new Array(n);
  const gyroMag: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const r = window[i];
    ax[i] = r[0]; ay[i] = r[1]; az[i] = r[2];
    gx[i] = r[3]; gy[i] = r[4]; gz[i] = r[5];
    accMag[i] = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
    gyroMag[i] = Math.sqrt(r[3] * r[3] + r[4] * r[4] + r[5] * r[5]);
  }

  // accel jerk = |diff(accMag)|
  const accJerk: number[] = [];
  for (let i = 1; i < n; i++) accJerk.push(Math.abs(accMag[i] - accMag[i - 1]));
  if (accJerk.length === 0) accJerk.push(0);

  const accMagMean = mean(accMag);

  // accel / gyro SMA = mean over samples of (|x|+|y|+|z|)
  let accSma = 0;
  let gyroSma = 0;
  for (let i = 0; i < n; i++) {
    accSma += Math.abs(ax[i]) + Math.abs(ay[i]) + Math.abs(az[i]);
    gyroSma += Math.abs(gx[i]) + Math.abs(gy[i]) + Math.abs(gz[i]);
  }
  accSma = n ? accSma / n : 0;
  gyroSma = n ? gyroSma / n : 0;

  return [
    accMagMean,
    std(accMag, accMagMean),
    min(accMag),
    max(accMag),
    max(accMag) - min(accMag),
    meanSquares(accMag),
    meanAbsDev(accMag, accMagMean),

    mean(accJerk),
    max(accJerk),

    std(ax), std(ay), std(az),
    mean(ax), mean(ay), mean(az),
    accSma,

    mean(gyroMag),
    std(gyroMag),
    max(gyroMag),
    meanSquares(gyroMag),

    std(gx), std(gy), std(gz),
    gyroSma,
  ];
}
