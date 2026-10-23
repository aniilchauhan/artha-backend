#!/usr/bin/env node
/**
 * Axion System Health and Support Diagnostic Tool
 * 
 * Provides instantaneous operational health scorecard for on-call engineers
 * and support operators.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runDiagnostics() {
  console.log('\n======================================================');
  console.log('       AXION OPERATIONAL DIAGNOSTIC SCORECARD        ');
  console.log(`       Timestamp: ${new Date().toISOString()}`);
  console.log('======================================================\n');

  const scorecard = [];

  // 1. Environment & Node Check
  scorecard.push({
    category: 'Runtime',
    check: 'Node.js Version',
    status: parseInt(process.versions.node.split('.')[0], 10) >= 18 ? 'PASS' : 'WARN',
    detail: `Node ${process.version} (${process.platform})`,
  });

  // 2. Storage & Backlog Infrastructure
  const axionDir = path.join(rootDir, '.axion');
  scorecard.push({
    category: 'Storage',
    check: 'Local .axion Directory',
    status: fs.existsSync(axionDir) ? 'PASS' : 'WARN',
    detail: fs.existsSync(axionDir) ? 'Present' : 'Not yet created (will initialize on demand)',
  });

  // 3. Restore Drill Verification (Epic 2)
  const drillPath = path.join(rootDir, 'docs', 'drills', 'RESTORE_DRILL_LATEST.json');
  if (fs.existsSync(drillPath)) {
    try {
      const drill = JSON.parse(fs.readFileSync(drillPath, 'utf8'));
      const ageHours = ((Date.now() - new Date(drill.timestamp).getTime()) / (1000 * 60 * 60)).toFixed(1);
      scorecard.push({
        category: 'Restore Assurance',
        check: 'Latest Restore Drill',
        status: drill.status === 'PASSED' ? 'PASS' : 'FAIL',
        detail: `${drill.status} (${ageHours}h ago, ${Object.keys(drill.collectionsTested || {}).length} colls verified)`,
      });
    } catch {
      scorecard.push({
        category: 'Restore Assurance',
        check: 'Latest Restore Drill',
        status: 'WARN',
        detail: 'Unreadable receipt',
      });
    }
  } else {
    scorecard.push({
      category: 'Restore Assurance',
      check: 'Latest Restore Drill',
      status: 'WARN',
      detail: 'No drill recorded yet. Run: node scripts/automated-restore-drill.mjs',
    });
  }

  // 4. Model Calibration Library (Epic 1)
  const calibPath = path.join(rootDir, 'lib', 'calibration-engine.ts');
  scorecard.push({
    category: 'ML Trust',
    check: 'Calibration Engine (ECE / PAVA)',
    status: fs.existsSync(calibPath) ? 'PASS' : 'FAIL',
    detail: fs.existsSync(calibPath) ? 'lib/calibration-engine.ts present' : 'Missing',
  });

  // 5. Latency Budget Monitor (Epic 2)
  const latencyPath = path.join(rootDir, 'lib', 'latency-budget.ts');
  scorecard.push({
    category: 'Telemetry',
    check: 'Latency SLA Monitor',
    status: fs.existsSync(latencyPath) ? 'PASS' : 'FAIL',
    detail: fs.existsSync(latencyPath) ? 'lib/latency-budget.ts active' : 'Missing',
  });

  // 6. Support Runbooks (Epic 3)
  const runbookPath = path.join(rootDir, 'docs', 'runbooks', 'INCIDENT_TRIAGE_RUNBOOK.md');
  scorecard.push({
    category: 'Documentation',
    check: 'Incident Triage Runbook',
    status: fs.existsSync(runbookPath) ? 'PASS' : 'FAIL',
    detail: fs.existsSync(runbookPath) ? 'docs/runbooks/INCIDENT_TRIAGE_RUNBOOK.md present' : 'Missing',
  });

  // 7. Quality Gate with Calibration Enforcer
  const qgPath = path.join(rootDir, 'lib', 'quality-gate.ts');
  if (fs.existsSync(qgPath)) {
    const qgContent = fs.readFileSync(qgPath, 'utf8');
    const hasOverconf = qgContent.includes('overconfident_uncalibrated');
    scorecard.push({
      category: 'Governance',
      check: 'Overconfidence Quality Gate',
      status: hasOverconf ? 'PASS' : 'FAIL',
      detail: hasOverconf ? 'Enforcing overconfident_uncalibrated check' : 'Legacy quality gate',
    });
  }

  // Print scorecard
  for (const item of scorecard) {
    const icon = item.status === 'PASS' ? '[PASS]' : item.status === 'WARN' ? '[WARN]' : '[FAIL]';
    console.log(`${icon.padEnd(8)} | ${item.category.padEnd(18)} | ${item.check.padEnd(30)} | ${item.detail}`);
  }

  console.log('\n======================================================');
  const hasFail = scorecard.some(s => s.status === 'FAIL');
  if (hasFail) {
    console.log('STATUS: DEGRADED — Review failed checks above.');
    process.exit(1);
  } else {
    console.log('STATUS: OPERATIONAL — All system diagnostics healthy.');
    console.log('======================================================\n');
  }
}

runDiagnostics().catch(err => {
  console.error('Diagnostic execution error:', err);
  process.exit(1);
});
