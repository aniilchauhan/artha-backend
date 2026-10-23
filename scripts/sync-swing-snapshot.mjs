import { calculateSwingOpportunities } from '../lib/backend-swing';
import { atomicSnapshotFile } from '../lib/backend-snapshots';
import connectToDatabase from '../lib/mongodb';
import BackendSnapshot from '../models/BackendSnapshot';

async function sync() {
  const calculated = await calculateSwingOpportunities();
  console.log('Calculated swing opportunities:', calculated.data.opportunities.length);
  console.log('Portfolio metrics:', calculated.data.portfolioMetrics);
  
  const snapshot = {
    version: 1,
    job: 'swing-opportunities',
    generatedAt: new Date().toISOString(),
    marketDataAsOf: calculated.marketDataAsOf,
    coverage: calculated.coverage,
    data: calculated.data
  };

  await atomicSnapshotFile('swing-opportunities.json', snapshot);
  console.log('Written to disk snapshot data/backend-snapshots/swing-opportunities.json');

  const mongoMod = await import('../lib/mongodb');
  const connectFn = typeof mongoMod.default === 'function' ? mongoMod.default : (typeof mongoMod === 'function' ? mongoMod : mongoMod.connectToDatabase);
  await connectFn();
  const Model = BackendSnapshot.default || BackendSnapshot;
  await Model.findOneAndUpdate(
    { job: 'swing-opportunities' },
    { $set: snapshot },
    { upsert: true }
  );
  console.log('Updated in MongoDB BackendSnapshot successfully!');
}

sync().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
