/**
 * Axion Model Probability Calibration and Conflict Detection Engine
 * 
 * Implements:
 * 1. Expected Calibration Error (ECE) and Maximum Calibration Error (MCE)
 * 2. Brier Score Decomposition
 * 3. Temperature Scaling (Platt-style logit scaling)
 * 4. Isotonic Regression via Pool Adjacent Violators Algorithm (PAVA)
 * 5. Confidence Truncation & Overconfidence Guards
 * 6. Population Stability Index (PSI) for feature / score drift detection
 */

export interface CalibrationBin {
  binIndex: number;
  binLower: number;
  binUpper: number;
  count: number;
  meanConfidence: number;
  meanAccuracy: number;
  calibrationError: number;
}

export interface CalibrationMetrics {
  brierScore: number;
  ece: number; // Expected Calibration Error (0 to 1)
  mce: number; // Maximum Calibration Error (0 to 1)
  sampleCount: number;
  bins: CalibrationBin[];
  passedThreshold: boolean;
}

export interface IsotonicStep {
  threshold: number;
  calibrated: number;
  weight: number;
}

export interface CalibrationGateCheck {
  passed: boolean;
  ece: number;
  eceThreshold: number;
  brierScore: number;
  recommendation: 'PROCEED_AUTOMATED' | 'PAPER_ONLY_RECALIBRATE' | 'HALT_HIGH_DRIFT';
  reason: string;
}

/**
 * Truncates raw probability if it exceeds the empirical reliability ceiling.
 * Default ceiling is 0.85 (85%) per Year 2 calibration governance.
 */
export function truncateConfidence(
  probability: number,
  maxCeiling: number = 0.85,
  minFloor: number = 0.15
): number {
  if (isNaN(probability) || !isFinite(probability)) {
    return 0.5;
  }
  const clamped = Math.max(0, Math.min(1, probability));
  return Math.max(minFloor, Math.min(maxCeiling, clamped));
}

/**
 * Converts probability p in (0, 1) to logit z.
 */
export function probToLogit(p: number, eps: number = 1e-7): number {
  const clamped = Math.max(eps, Math.min(1 - eps, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Converts logit z back to probability in (0, 1).
 */
export function logitToProb(z: number): number {
  if (z > 40) return 1.0;
  if (z < -40) return 0.0;
  return 1 / (1 + Math.exp(-z));
}

/**
 * Applies temperature scaling to a raw probability score.
 * Formula: sigma(logit(p) / T)
 * Where T > 1 softens overconfident predictions towards 0.5.
 */
export function applyTemperatureScaling(
  rawProbability: number,
  temperature: number = 1.0
): number {
  if (isNaN(rawProbability) || !isFinite(rawProbability)) {
    return 0.5;
  }
  if (temperature <= 0 || !isFinite(temperature)) {
    throw new Error('Temperature parameter T must be strictly positive and finite.');
  }
  if (temperature === 1.0) {
    return Math.max(0, Math.min(1, rawProbability));
  }
  const logit = probToLogit(rawProbability);
  const scaledLogit = logit / temperature;
  return logitToProb(scaledLogit);
}

/**
 * Fits optimal temperature T > 0 on validation pairs using Negative Log-Likelihood (NLL).
 * Uses bounded golden section search over T in [0.2, 5.0].
 */
export function fitTemperatureScaling(
  probabilities: number[],
  actualOutcomes: number[],
  minT = 0.2,
  maxT = 5.0,
  iterations = 35
): { temperature: number; nllBefore: number; nllAfter: number } {
  if (probabilities.length !== actualOutcomes.length) {
    throw new Error('Probabilities and actual outcomes must have equal length.');
  }
  if (probabilities.length === 0) {
    return { temperature: 1.0, nllBefore: 0, nllAfter: 0 };
  }

  const computeNLL = (T: number): number => {
    let loss = 0;
    const eps = 1e-12;
    for (let i = 0; i < probabilities.length; i++) {
      const p = applyTemperatureScaling(probabilities[i], T);
      const y = actualOutcomes[i] >= 0.5 ? 1 : 0;
      loss -= (y * Math.log(Math.max(eps, p)) + (1 - y) * Math.log(Math.max(eps, 1 - p)));
    }
    return loss / probabilities.length;
  };

  const nllBefore = computeNLL(1.0);

  // Golden section search
  const phi = (1 + Math.sqrt(5)) / 2;
  const resphi = 2 - phi;

  let a = minT;
  let b = maxT;
  let x1 = a + resphi * (b - a);
  let x2 = b - resphi * (b - a);
  let f1 = computeNLL(x1);
  let f2 = computeNLL(x2);

  for (let i = 0; i < iterations; i++) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + resphi * (b - a);
      f1 = computeNLL(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = b - resphi * (b - a);
      f2 = computeNLL(x2);
    }
  }

  const bestT = (a + b) / 2;
  const nllAfter = computeNLL(bestT);

  return {
    temperature: parseFloat(bestT.toFixed(4)),
    nllBefore: parseFloat(nllBefore.toFixed(5)),
    nllAfter: parseFloat(nllAfter.toFixed(5)),
  };
}

/**
 * Fits isotonic calibration table using the Pool Adjacent Violators Algorithm (PAVA).
 * Guarantees monotonic non-decreasing calibrated probability mappings.
 */
export function fitIsotonicRegression(
  probabilities: number[],
  outcomes: number[]
): IsotonicStep[] {
  if (probabilities.length !== outcomes.length || probabilities.length === 0) {
    return [];
  }

  // 1. Sort pairs ascending by raw probability
  const pairs = probabilities.map((p, i) => ({
    x: Math.max(0, Math.min(1, p)),
    y: outcomes[i] >= 0.5 ? 1 : 0,
  }));
  pairs.sort((a, b) => a.x - b.x);

  // 2. Initialize blocks
  interface Block {
    weight: number;
    valueSum: number;
    xMax: number;
  }

  const blocks: Block[] = pairs.map(p => ({
    weight: 1,
    valueSum: p.y,
    xMax: p.x,
  }));

  // 3. Pool adjacent violators
  let i = 0;
  while (i < blocks.length - 1) {
    const currentVal = blocks[i].valueSum / blocks[i].weight;
    const nextVal = blocks[i + 1].valueSum / blocks[i + 1].weight;

    if (currentVal > nextVal) {
      // Violation: merge blocks
      blocks[i].weight += blocks[i + 1].weight;
      blocks[i].valueSum += blocks[i + 1].valueSum;
      blocks[i].xMax = blocks[i + 1].xMax;
      blocks.splice(i + 1, 1);

      // Backtrack to check preceding blocks
      if (i > 0) i--;
    } else {
      i++;
    }
  }

  return blocks.map(b => ({
    threshold: parseFloat(b.xMax.toFixed(4)),
    calibrated: parseFloat((b.valueSum / b.weight).toFixed(4)),
    weight: b.weight,
  }));
}

/**
 * Applies isotonic calibration table to a new score via piecewise lookup.
 */
export function applyIsotonicCalibration(
  rawScore: number,
  lookupTable: IsotonicStep[]
): number {
  if (!lookupTable || lookupTable.length === 0) {
    return Math.max(0, Math.min(1, rawScore));
  }
  const score = Math.max(0, Math.min(1, rawScore));

  if (score <= lookupTable[0].threshold) {
    return lookupTable[0].calibrated;
  }
  const last = lookupTable[lookupTable.length - 1];
  if (score >= last.threshold) {
    return last.calibrated;
  }

  // Binary search or linear interpolation
  for (let i = 0; i < lookupTable.length - 1; i++) {
    const current = lookupTable[i];
    const next = lookupTable[i + 1];
    if (score >= current.threshold && score <= next.threshold) {
      const span = next.threshold - current.threshold;
      if (span < 1e-6) return current.calibrated;
      const t = (score - current.threshold) / span;
      return parseFloat((current.calibrated + t * (next.calibrated - current.calibrated)).toFixed(4));
    }
  }

  return last.calibrated;
}

/**
 * Computes Expected Calibration Error (ECE) and Brier Score over a set of forecasts and outcomes.
 */
export function computeECE(
  confidences: number[],
  outcomes: number[],
  numBins = 10,
  eceTarget = 0.05
): CalibrationMetrics {
  const N = confidences.length;
  if (N === 0 || N !== outcomes.length) {
    return {
      brierScore: 0,
      ece: 0,
      mce: 0,
      sampleCount: 0,
      bins: [],
      passedThreshold: false,
    };
  }

  let totalBrier = 0;
  for (let i = 0; i < N; i++) {
    const y = outcomes[i] >= 0.5 ? 1 : 0;
    const p = Math.max(0, Math.min(1, confidences[i]));
    totalBrier += Math.pow(p - y, 2);
  }
  const brierScore = parseFloat((totalBrier / N).toFixed(4));

  const binStep = 1.0 / numBins;
  const bins: CalibrationBin[] = [];
  let weightedECE = 0;
  let maxCE = 0;

  for (let b = 0; b < numBins; b++) {
    const binLower = b * binStep;
    const binUpper = (b + 1) * binStep;

    const indices: number[] = [];
    for (let i = 0; i < N; i++) {
      const p = Math.max(0, Math.min(1, confidences[i]));
      if (b === numBins - 1) {
        if (p >= binLower && p <= binUpper) indices.push(i);
      } else {
        if (p >= binLower && p < binUpper) indices.push(i);
      }
    }

    const count = indices.length;
    if (count === 0) {
      bins.push({
        binIndex: b,
        binLower: parseFloat(binLower.toFixed(2)),
        binUpper: parseFloat(binUpper.toFixed(2)),
        count: 0,
        meanConfidence: parseFloat(((binLower + binUpper) / 2).toFixed(4)),
        meanAccuracy: 0,
        calibrationError: 0,
      });
      continue;
    }

    let sumConf = 0;
    let sumAcc = 0;
    for (const idx of indices) {
      sumConf += Math.max(0, Math.min(1, confidences[idx]));
      sumAcc += outcomes[idx] >= 0.5 ? 1 : 0;
    }

    const meanConfidence = sumConf / count;
    const meanAccuracy = sumAcc / count;
    const error = Math.abs(meanAccuracy - meanConfidence);

    weightedECE += (count / N) * error;
    if (error > maxCE) maxCE = error;

    bins.push({
      binIndex: b,
      binLower: parseFloat(binLower.toFixed(2)),
      binUpper: parseFloat(binUpper.toFixed(2)),
      count,
      meanConfidence: parseFloat(meanConfidence.toFixed(4)),
      meanAccuracy: parseFloat(meanAccuracy.toFixed(4)),
      calibrationError: parseFloat(error.toFixed(4)),
    });
  }

  const finalECE = parseFloat(weightedECE.toFixed(4));
  const finalMCE = parseFloat(maxCE.toFixed(4));

  return {
    brierScore,
    ece: finalECE,
    mce: finalMCE,
    sampleCount: N,
    bins,
    passedThreshold: finalECE <= eceTarget,
  };
}

/**
 * Computes Population Stability Index (PSI) between a baseline feature distribution
 * and a recent observation distribution.
 * 
 * Rule of Thumb:
 * - PSI < 0.10: Stable (no significant drift)
 * - 0.10 <= PSI <= 0.25: Moderate drift, requires monitoring
 * - PSI > 0.25: Significant drift, trigger model recalibration
 */
export function computePSI(
  baselineValues: number[],
  targetValues: number[],
  numBins = 10
): { psi: number; status: 'STABLE' | 'MODERATE_DRIFT' | 'SIGNIFICANT_DRIFT' } {
  if (baselineValues.length === 0 || targetValues.length === 0) {
    return { psi: 0, status: 'STABLE' };
  }

  const minVal = Math.min(...baselineValues, ...targetValues);
  const maxVal = Math.max(...baselineValues, ...targetValues);

  if (minVal === maxVal) {
    return { psi: 0, status: 'STABLE' };
  }

  const binStep = (maxVal - minVal) / numBins;
  const eps = 1e-4; // Smoothing factor to prevent log(0)
  let totalPsi = 0;

  for (let b = 0; b < numBins; b++) {
    const low = minVal + b * binStep;
    const high = b === numBins - 1 ? maxVal : minVal + (b + 1) * binStep;

    const baseCount = baselineValues.filter(v => (b === numBins - 1 ? v >= low && v <= high : v >= low && v < high)).length;
    const targetCount = targetValues.filter(v => (b === numBins - 1 ? v >= low && v <= high : v >= low && v < high)).length;

    // Laplace smoothing to prevent small sample bin instability and division by zero
    const basePct = (baseCount + 1) / (baselineValues.length + numBins);
    const targetPct = (targetCount + 1) / (targetValues.length + numBins);

    totalPsi += (targetPct - basePct) * Math.log(targetPct / basePct);
  }

  const psi = parseFloat(totalPsi.toFixed(4));
  let status: 'STABLE' | 'MODERATE_DRIFT' | 'SIGNIFICANT_DRIFT' = 'STABLE';
  if (psi > 0.25) {
    status = 'SIGNIFICANT_DRIFT';
  } else if (psi >= 0.10) {
    status = 'MODERATE_DRIFT';
  }

  return { psi, status };
}

/**
 * Gate evaluator verifying whether a model cohort meets the Year 2 promotion threshold.
 */
export function evaluateCalibrationGate(
  metrics: CalibrationMetrics,
  targetECE = 0.05
): CalibrationGateCheck {
  if (metrics.sampleCount < 30) {
    return {
      passed: false,
      ece: metrics.ece,
      eceThreshold: targetECE,
      brierScore: metrics.brierScore,
      recommendation: 'PAPER_ONLY_RECALIBRATE',
      reason: `Insufficient sample size (${metrics.sampleCount} < 30 required outcomes).`,
    };
  }

  if (metrics.ece > targetECE) {
    return {
      passed: false,
      ece: metrics.ece,
      eceThreshold: targetECE,
      brierScore: metrics.brierScore,
      recommendation: 'PAPER_ONLY_RECALIBRATE',
      reason: `Expected Calibration Error of ${(metrics.ece * 100).toFixed(1)}% exceeds maximum allowable limit of ${(targetECE * 100).toFixed(1)}%. Model overconfidence detected.`,
    };
  }

  return {
    passed: true,
    ece: metrics.ece,
    eceThreshold: targetECE,
    brierScore: metrics.brierScore,
    recommendation: 'PROCEED_AUTOMATED',
    reason: `Calibration verified. ECE ${(metrics.ece * 100).toFixed(2)}% meets target <= ${(targetECE * 100).toFixed(1)}%.`,
  };
}
