import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/axion_stocks';

const BackendSnapshotSchema = new mongoose.Schema(
  {
    job: { type: String, required: true, unique: true, index: true },
    version: { type: Number, default: 1 },
    generatedAt: { type: String, required: true },
    marketDataAsOf: { type: String, default: null },
    coverage: {
      evaluated: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    state: { type: String, default: 'ready' },
  },
  { timestamps: true }
);

const BackendSnapshot =
  mongoose.models.BackendSnapshot ||
  mongoose.model('BackendSnapshot', BackendSnapshotSchema);

async function main() {
  console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  console.log('✓ Connected to MongoDB.\n');

  const snapshotDir = path.join(projectRoot, 'data', 'backend-snapshots');
  const files = fs.readdirSync(snapshotDir);

  let migrated = 0;
  for (const file of files) {
    if (!file.endsWith('.json') || file.includes('-status') || file.includes('-progress')) {
      continue;
    }

    const job = file.replace('.json', '');
    const filePath = path.join(snapshotDir, file);

    try {
      console.log(`Loading ${file} (~${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB)...`);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      const doc = {
        job,
        version: parsed.version || 1,
        generatedAt: parsed.generatedAt || new Date().toISOString(),
        marketDataAsOf: parsed.marketDataAsOf || null,
        coverage: parsed.coverage || { evaluated: 0, total: 0 },
        data: parsed.data !== undefined ? parsed.data : parsed,
        state: 'ready',
      };

      await BackendSnapshot.findOneAndUpdate(
        { job },
        { $set: doc },
        { upsert: true, new: true }
      );

      console.log(`  ✓ Synced '${job}' to MongoDB collection 'backendsnapshots'.`);
      migrated++;
    } catch (err) {
      console.error(`  ✗ Error syncing ${file}:`, err.message);
    }
  }

  // Also sync Post-IPO breakouts
  const postIpoPath = path.join(projectRoot, 'data', 'stock-ai', 'post_ipo_breakouts.json');
  if (fs.existsSync(postIpoPath)) {
    try {
      console.log(`Loading post_ipo_breakouts.json...`);
      const raw = fs.readFileSync(postIpoPath, 'utf-8');
      const parsed = JSON.parse(raw);

      await BackendSnapshot.findOneAndUpdate(
        { job: 'post-ipo-breakouts' },
        {
          $set: {
            job: 'post-ipo-breakouts',
            version: 1,
            generatedAt: parsed.generatedAt || new Date().toISOString(),
            coverage: { evaluated: parsed.count || 0, total: parsed.count || 0 },
            data: parsed.data || parsed,
            state: 'ready',
          },
        },
        { upsert: true, new: true }
      );
      console.log(`  ✓ Synced 'post-ipo-breakouts' to MongoDB collection 'backendsnapshots'.`);
      migrated++;
    } catch (err) {
      console.error(`  ✗ Error syncing post_ipo_breakouts.json:`, err.message);
    }
  }

  const totalInDb = await BackendSnapshot.countDocuments();
  console.log(`\n🎉 All ${migrated} snapshots stored in MongoDB! Total snapshots in DB: ${totalInDb}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
