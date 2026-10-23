#!/usr/bin/env node
/**
 * Deployment Configuration Validator for Axion.
 * Verifies critical environment variables, security secrets, database configuration,
 * and runtime assets before deployment or CI gating.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'ci-only-test-secret-not-for-deployment',
  'test_mock_secret_key_32_characters_minimum',
  'change_this_to_a_complex_random_secret_in_production',
  'your_super_secret_nextauth_key_here_min_32_chars',
  'secret',
  'changeme',
  'password',
]);

export function validateConfig(env = process.env, options = {}) {
  const isProduction = env.NODE_ENV === 'production' || options.production;
  const isStrict = options.strict || isProduction;

  const errors = [];
  const warnings = [];
  const passed = [];

  // 1. NEXTAUTH_SECRET Check
  const nextAuthSecret = env.NEXTAUTH_SECRET;
  if (!nextAuthSecret) {
    errors.push('NEXTAUTH_SECRET is missing. Authentication cannot function.');
  } else if (nextAuthSecret.length < 32) {
    if (isStrict) {
      errors.push(`NEXTAUTH_SECRET is too short (${nextAuthSecret.length} chars). Minimum 32 characters required.`);
    } else {
      warnings.push(`NEXTAUTH_SECRET is short (${nextAuthSecret.length} chars). Recommend 32+ characters in production.`);
    }
  } else if (KNOWN_PLACEHOLDER_SECRETS.has(nextAuthSecret.toLowerCase().trim())) {
    if (isStrict) {
      errors.push('NEXTAUTH_SECRET is using a known test or placeholder secret. Must use a secure random secret in production.');
    } else {
      warnings.push('NEXTAUTH_SECRET is using a known placeholder secret.');
    }
  } else {
    passed.push('NEXTAUTH_SECRET is configured with sufficient entropy.');
  }

  // 2. NEXTAUTH_URL Check
  const nextAuthUrl = env.NEXTAUTH_URL;
  if (!nextAuthUrl) {
    if (isStrict) {
      errors.push('NEXTAUTH_URL is missing.');
    } else {
      warnings.push('NEXTAUTH_URL is missing. Local Next.js may fall back to request host.');
    }
  } else {
    try {
      const parsed = new URL(nextAuthUrl);
      if (isProduction && parsed.protocol !== 'https:' && !options.allowHttp) {
        errors.push(`NEXTAUTH_URL must use HTTPS in production (received ${parsed.protocol}).`);
      } else {
        passed.push(`NEXTAUTH_URL is valid (${parsed.origin}).`);
      }
    } catch {
      errors.push(`NEXTAUTH_URL is an invalid URL: "${nextAuthUrl}".`);
    }
  }

  // 3. MONGODB_URI Check
  const mongoUri = env.MONGODB_URI;
  if (!mongoUri) {
    if (isProduction || env.AXION_PERSONAL_MODE !== 'true') {
      errors.push('MONGODB_URI is missing. Database persistence will fail.');
    } else {
      warnings.push('MONGODB_URI is not set. Running in single-user personal mode fallback.');
    }
  } else {
    if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
      errors.push('MONGODB_URI must start with "mongodb://" or "mongodb+srv://".');
    } else {
      passed.push('MONGODB_URI format is valid.');
    }
  }

  // 4. ADMIN_EMAILS Check
  const adminEmails = env.ADMIN_EMAILS;
  if (!adminEmails || !adminEmails.trim()) {
    warnings.push('ADMIN_EMAILS is not configured. Admin-protected routes will reject all requests.');
  } else {
    const list = adminEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const validEmails = list.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (validEmails.length < list.length) {
      warnings.push(`Some ADMIN_EMAILS are not valid email formats: ${list.filter((e) => !validEmails.includes(e)).join(', ')}`);
    } else {
      passed.push(`ADMIN_EMAILS configured with ${validEmails.length} authorized administrator(s).`);
    }
  }

  // 5. Critical Data Files Check
  const criticalFiles = [
    'nse_2500_stocks_master.csv',
    'data/all_nse_stocks.json',
  ];

  for (const relPath of criticalFiles) {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      if (isStrict) {
        errors.push(`Required data file missing: ${relPath}`);
      } else {
        warnings.push(`Required data file missing: ${relPath}`);
      }
    } else {
      passed.push(`Data file verified: ${relPath}`);
    }
  }

  // 6. Node Engine Check
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) {
    errors.push(`Node.js version ${process.version} is unsupported. Minimum supported version is Node 18.`);
  } else {
    passed.push(`Node.js runtime version ${process.version} is supported.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    passed,
    summary: {
      total: errors.length + warnings.length + passed.length,
      errorsCount: errors.length,
      warningsCount: warnings.length,
      passedCount: passed.length,
    },
  };
}

function loadEnvDefaults() {
  const envCandidates = ['.env.local', '.env.production', '.env'];
  for (const file of envCandidates) {
    const fullPath = path.resolve(rootDir, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(fullPath);
      } else {
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;
          const k = trimmed.slice(0, eq).trim();
          let v = trimmed.slice(eq + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!(k in process.env)) {
            process.env[k] = v;
          }
        }
      }
    } catch {
      // Continue to next file or ignore unreadable
    }
  }
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  loadEnvDefaults();
  const args = process.argv.slice(2);
  const options = {
    strict: args.includes('--strict'),
    production: args.includes('--production'),
    json: args.includes('--json'),
    allowHttp: args.includes('--allow-http'),
  };

  const result = validateConfig(process.env, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n=== Axion Deployment Configuration Audit ===\n');
    for (const p of result.passed) {
      console.log(`  [PASS] ${p}`);
    }
    for (const w of result.warnings) {
      console.warn(`  [WARN] ${w}`);
    }
    for (const e of result.errors) {
      console.error(`  [FAIL] ${e}`);
    }
    console.log(`\nResult: ${result.valid ? 'VALID' : 'FAILED'} (${result.summary.passedCount} passed, ${result.summary.warningsCount} warnings, ${result.summary.errorsCount} errors)\n`);
  }

  if (!result.valid) {
    process.exit(1);
  }
}
