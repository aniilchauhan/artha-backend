#!/usr/bin/env node
/**
 * Axion Database Restore Utility.
 * Restores collections from a backup directory with strict SHA-256 checksum verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function restoreDatabase(mongoUri, backupDir, options = {}) {
  if (!mongoUri) {
    throw new Error('Database URI is required for restore.');
  }
  if (!backupDir || !fs.existsSync(backupDir)) {
    throw new Error(`Backup directory not found: ${backupDir}`);
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 1. Integrity verification against checksums
  const verifiedFiles = {};
  for (const [collName, meta] of Object.entries(manifest.collections || {})) {
    const filePath = path.join(backupDir, meta.file || `${collName}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Collection backup file missing: ${meta.file}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (hash !== meta.sha256) {
      throw new Error(
        `Integrity check failed for ${collName}: expected ${meta.sha256}, got ${hash}. Backup may be corrupted.`
      );
    }

    verifiedFiles[collName] = JSON.parse(content);
  }

  // 2. Connect and restore collections
  const conn = await mongoose.createConnection(mongoUri).asPromise();
  const db = conn.db;

  const restoredSummary = {};

  try {
    for (const [collName, docs] of Object.entries(verifiedFiles)) {
      const coll = db.collection(collName);

      if (options.clean !== false) {
        await coll.deleteMany({});
      }

      if (docs.length > 0) {
        // Bulk upsert / insert preserving original _ids and fields
        const operations = docs.map((doc) => ({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        }));
        await coll.bulkWrite(operations);
      }

      const finalCount = await coll.countDocuments();
      if (finalCount !== docs.length) {
        throw new Error(
          `Restoration count mismatch for ${collName}: expected ${docs.length}, actual ${finalCount}`
        );
      }

      restoredSummary[collName] = {
        restored: docs.length,
        verified: true,
      };
    }

    return {
      success: true,
      backupDir,
      database: db.databaseName,
      collections: restoredSummary,
    };
  } finally {
    await conn.close();
  }
}

function loadEnvUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const rootDir = path.resolve(__dirname, '..');
  for (const filename of ['.env.local', '.env.production', '.env']) {
    const fullPath = path.resolve(rootDir, filename);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (k === 'MONGODB_URI') return v;
    }
  }
  return null;
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const uri = process.env.MONGODB_URI || loadEnvUri();
  let backupDir = process.argv[2];

  if (!backupDir) {
    const rootDir = path.resolve(__dirname, '..');
    const defaultLatest = path.join(rootDir, '.axion', 'backups', 'latest');
    if (fs.existsSync(defaultLatest)) {
      backupDir = defaultLatest;
    }
  }

  if (!uri) {
    console.error('[Restore Error] MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }
  if (!backupDir) {
    console.error('[Restore Error] Usage: node scripts/restore-db.mjs [backup-dir]');
    process.exit(1);
  }

  restoreDatabase(uri, backupDir)
    .then((res) => {
      console.log(`\n[Restore Success] Restored database: ${res.database} from ${res.backupDir}`);
      for (const [name, meta] of Object.entries(res.collections)) {
        console.log(`  - ${name}: ${meta.restored} documents restored and verified.`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Restore Error]', err.message);
      process.exit(1);
    });
}
