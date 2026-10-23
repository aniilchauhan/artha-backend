import mongoose from 'mongoose';

function getMongoUri() {
  return process.env.MONGODB_URI?.trim().replace(/^["']|["']$/g, '');
}

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

if (!getMongoUri() && !isBuildPhase) {
  console.warn('Please define the MONGODB_URI environment variable inside .env.local');
}

function shouldSkipDatabaseForBuild() {
  return isBuildPhase || process.env.NODE_ENV === 'production' && process.env.npm_lifecycle_event === 'build';
}

let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

let lastFailureTime = 0;
const FAILURE_COOLDOWN_MS = 60000; // If Atlas failed, don't re-attempt for 60s to keep app ultra-responsive

function formatMongoError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown MongoDB error';
  }
}

export async function getDatabaseHealth() {
  if (shouldSkipDatabaseForBuild()) {
    return {
      status: 'skipped',
      detail: 'Database checks skipped during build phase.',
      readyState: 0,
    };
  }

  const MONGODB_URI = getMongoUri();

  if (!MONGODB_URI) {
    return {
      status: 'skipped',
      detail: 'MONGODB_URI not configured',
      readyState: 0,
    };
  }

  const readyState = mongoose.connection?.readyState ?? 0;

  if (readyState === 1 && mongoose.connection?.db) {
    try {
      await mongoose.connection.db.admin().ping({ maxTimeMS: 2500 });
      return {
        status: 'ok',
        detail: 'Database connection is healthy and reachable.',
        readyState,
      };
    } catch (error) {
      cached.conn = null;
      cached.promise = null;
      return {
        status: 'degraded',
        detail: `Database health check failed: ${formatMongoError(error)}`,
        readyState,
      };
    }
  }

  if (readyState === 1) {
    return {
      status: 'ok',
      detail: 'Database connection is established.',
      readyState,
    };
  }

  return {
    status: readyState === 0 || readyState === 2 || readyState === 3 ? 'degraded' : 'error',
    detail: `Database connection is not ready (state ${readyState}).`,
    readyState,
  };
}

async function connectToDatabase() {
  if (shouldSkipDatabaseForBuild()) {
    return null;
  }

  const MONGODB_URI = getMongoUri();

  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (mongoose.connection?.readyState === 1) {
    cached.conn = mongoose;
    return cached.conn;
  }

  // If recently timed out or failed to connect, fail fast to keep UI responsive
  if (Date.now() - lastFailureTime < FAILURE_COOLDOWN_MS) {
    throw new Error('Database connection currently unavailable (cooldown active)');
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 2500, // Fail fast in 2.5s instead of hanging for 30s
      connectTimeoutMS: 2500,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongooseConnection) => {
      return mongooseConnection;
    });
  }

  try {
    cached.conn = await cached.promise;
    lastFailureTime = 0;
  } catch (e) {
    cached.promise = null;
    lastFailureTime = Date.now();
    throw e;
  }

  return cached.conn;
}

export default connectToDatabase;
