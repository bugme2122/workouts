import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod;

// Spin up an isolated in-memory MongoDB for a test file and connect Mongoose to it.
export async function connectMemoryDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'workouts_test' });
}

export async function clearDb() {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

export async function disconnectMemoryDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

// Best-effort connect. Returns true if an in-memory Mongo is available, false if the mongod binary
// can't be provisioned (e.g. a sandbox that blocks the download) — so DB-backed suites can skip
// cleanly instead of failing. Where Mongo IS available (CI, local dev) the suites run fully.
export async function tryConnectMemoryDb() {
  try {
    await connectMemoryDb();
    return true;
  } catch (e) {
    console.warn(`[tests] in-memory MongoDB unavailable — skipping DB-backed suites: ${e.message}`);
    return false;
  }
}
