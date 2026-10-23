#!/usr/bin/env node
/**
 * Axion Daily Market Session Briefing CLI Runner
 *
 * Generates a dated market gap briefing. Retired paper-cohort metrics are excluded.
 *
 * Usage:
 *   node scripts/generate-market-report.mjs [YYYY-MM-DD]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateDailyMarketSessionReport } from '../lib/market-report-generator.ts';
import { indiaDay } from '../lib/market-quote.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const reportsDir = path.join(rootDir, '.axion', 'reports');

const args = process.argv.slice(2);
const sessionDate = args[0] || indiaDay(new Date());

async function main() {
  console.log(`\n======================================================`);
  console.log(`[SESSION REPORT] Generating Daily Briefing for ${sessionDate}`);
  console.log(`======================================================\n`);

  try {
    const report = await generateDailyMarketSessionReport(sessionDate);

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportPath = path.join(reportsDir, `session_report_${report.date}.md`);
    const latestPath = path.join(reportsDir, 'latest_session_report.md');

    fs.writeFileSync(reportPath, report.markdownContent, 'utf-8');
    fs.writeFileSync(latestPath, report.markdownContent, 'utf-8');

    console.log(`✓ Daily report successfully written to:`);
    console.log(`  - ${reportPath}`);
    console.log(`  - ${latestPath}`);
    console.log(`\n[SUMMARY] Quotes evaluated: ${report.universeScanned}/${report.universeTotal} | Gaps observed: ${report.gapSummary.totalGaps} | Observed gap fill rate: ${report.gapSummary.fillRatePercent}%`);

    // Optional webhook broadcast
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      console.log(`\n[WEBHOOK] Broadcasting briefing to configured endpoint...`);
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `Axion Market Session Briefing [${report.date}]\nProvider quotes evaluated: ${report.universeScanned}/${report.universeTotal}. Observed ${report.gapSummary.totalGaps} opening gaps; observed fill rate: ${report.gapSummary.fillRatePercent}%.\nReport saved under .axion/reports.`,
          }),
        });
        if (res.ok) {
          console.log(`✓ Webhook alert broadcast successfully!`);
        } else {
          console.warn(`⚠️ Webhook returned status ${res.status}`);
        }
      } catch (err) {
        console.warn(`⚠️ Webhook broadcast skipped:`, err?.message);
      }
    }
  } catch (err) {
    console.error(`❌ Failed to generate daily session report:`, err?.message);
    process.exit(1);
  }
}

main();
