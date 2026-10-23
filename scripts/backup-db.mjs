#!/usr/bin/env node
/**
 * Axion Database Backup Utility.
 * Exports critical collections with SHA-256 integrity checksums and metadata manifest.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_COLLECTIONS = [
  'users',
  'stocks',
  'smallcapstocks',
  'companyprofiles',
  'ipos',
  'radarsnapshots',
  'aipredictions',
  'backendsnapshots',
  'traderecords',
  'ratelimits',
  'jobleases',
];

function loadEnvUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
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

export async function backupDatabase(mongoUri, outputDir, options = {}) {
  if (!mongoUri) {
    throw new Error('Database URI is required for backup.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = outputDir || path.join(rootDir, '.axion', 'backups', timestamp);
  fs.mkdirSync(targetDir, { recursive: true });

  const conn = await mongoose.createConnection(mongoUri).asPromise();
  const db = conn.db;

  const collections = await db.listCollections().toArray();
  const availableNames = new Set(collections.map((c) => c.name));

  // Combine default collections with any existing user collections (excluding system collections)
  const targetCollections = new Set(
    collections
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.') && !n.startsWith('local.'))
  );
  for (const c of DEFAULT_COLLECTIONS) {
    if (availableNames.has(c)) targetCollections.add(c);
  }

  const manifest = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    database: db.databaseName,
    collections: {},
  };

  try {
    for (const collName of targetCollections) {
      if (!availableNames.has(collName)) {
        continue;
      }

      const coll = db.collection(collName);
      const docs = await coll.find({}).toArray();

      if (docs.length === 0 && !DEFAULT_COLLECTIONS.includes(collName)) {
        continue;
      }

      const jsonStr = JSON.stringify(docs, null, 2);
      const hash = crypto.createHash('sha256').update(jsonStr).digest('hex');
      const filePath = path.join(targetDir, `${collName}.json`);

      fs.writeFileSync(filePath, jsonStr, 'utf8');

      manifest.collections[collName] = {
        count: docs.length,
        sha256: hash,
        file: `${collName}.json`,
      };
    }

    const manifestPath = path.join(targetDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // Also update/copy to latest pointer
    const latestDir = path.join(rootDir, '.axion', 'backups', 'latest');
    fs.mkdirSync(latestDir, { recursive: true });
    for (const file of fs.readdirSync(targetDir)) {
      fs.copyFileSync(path.join(targetDir, file), path.join(latestDir, file));
    }

    return {
      success: true,
      backupDir: targetDir,
      latestDir,
      manifest,
    };
  } finally {
    await conn.close();
  }
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const uri = process.env.MONGODB_URI || loadEnvUri();
  const out = process.argv[2];

  if (!uri) {
    console.error('[Backup Error] MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }

  backupDatabase(uri, out)
    .then((result) => {
      console.log(`\n[Backup Success] Created backup in: ${result.backupDir}`);
      console.log(`[Backup Success] Synced to latest pointer: ${result.latestDir}`);
      for (const [name, meta] of Object.entries(result.manifest.collections)) {
        console.log(`  - ${name}: ${meta.count} documents (SHA-256: ${meta.sha256.slice(0, 12)}...)`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Backup Error]', err.message);
      process.exit(1);
    });
}
