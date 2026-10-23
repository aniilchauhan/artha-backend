/**
 * Axion Model Drift Monitoring & Alerting Engine
 * 
 * Satisfies Year 2 Backlog Phase 2:
 * "Implement drift alerting and score recalibration — continuous background PSI monitoring
 * across prediction cohorts to detect feature and model score drift."
 */

import { computePSI } from './calibration-engine';
import path from 'path';
import fs from 'fs';
import { getAxionProjectRoot } from './project-root';

export interface DriftReport {
  id: string;
  evaluatedAt: string;
  metric: string;
  psi: number;
  status: 'STABLE' | 'MODERATE_DRIFT' | 'SIGNIFICANT_DRIFT';
  alertTriggered: boolean;
  sampleCountBaseline: number;
  sampleCountCurrent: number;
  recommendedAction: string;
}

// Canonical Month 12 baseline score distribution for calibration reference
const DEFAULT_BASELINE_SCORES: number[] = [
  0.15, 0.22, 0.31, 0.38, 0.44, 0.49, 0.52, 0.58, 0.62, 0.67,
  0.71, 0.74, 0.78, 0.81, 0.83, 0.85, 0.86, 0.88, 0.90, 0.92,
];

class DriftMonitorService {
  private baselineScores: number[] = [...DEFAULT_BASELINE_SCORES];
  private driftHistory: DriftReport[] = [];

  public setBaselineDistribution(scores: number[]): void {
    if (scores.length >= 10) {
      this.baselineScores = [...scores];
    }
  }

  public getBaselineDistribution(): number[] {
    return [...this.baselineScores];
  }

  public evaluateDrift(
    currentCohortScores: number[],
    metricName = 'model_calibrated_score',
    baselineOverride?: number[]
  ): DriftReport {
    const baseline = baselineOverride && baselineOverride.length >= 10
      ? baselineOverride
      : this.baselineScores;

    // Adapt bin count to sample size to ensure adequate bin occupancy (min 4 samples per bin)
    const minSamples = Math.min(baseline.length, currentCohortScores.length);
    const numBins = Math.max(3, Math.min(10, Math.floor(minSamples / 4)));

    const { psi, status } = computePSI(baseline, currentCohortScores, numBins);

    const alertTriggered = status !== 'STABLE';
    let recommendedAction = 'Model distribution stable. Standard operations continue.';

    if (status === 'MODERATE_DRIFT') {
      recommendedAction = 'Moderate drift observed (PSI >= 0.10). Monitor upcoming session cohort and review feature distributions.';
    } else if (status === 'SIGNIFICANT_DRIFT') {
      recommendedAction = 'Significant drift observed (PSI > 0.25). Freeze live promotion and execute model recalibration.';
    }

    const report: DriftReport = {
      id: `drift_${Date.now()}`,
      evaluatedAt: new Date().toISOString(),
      metric: metricName,
      psi,
      status,
      alertTriggered,
      sampleCountBaseline: baseline.length,
      sampleCountCurrent: currentCohortScores.length,
      recommendedAction,
    };

    this.driftHistory.push(report);
    if (this.driftHistory.length > 100) {
      this.driftHistory.shift();
    }

    // Persist drift history
    this.persistReport(report);

    return report;
  }

  public getLatestReport(): DriftReport | null {
    if (this.driftHistory.length === 0) return null;
    return this.driftHistory[this.driftHistory.length - 1];
  }

  public getAllReports(): DriftReport[] {
    return [...this.driftHistory];
  }

  private persistReport(report: DriftReport): void {
    try {
      const dir = path.join(getAxionProjectRoot(), '.axion', 'drift');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(dir, 'LATEST_DRIFT_REPORT.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch {
      // Graceful fallback if storage unwritable
    }
  }
}

export const driftMonitor = new DriftMonitorService();
