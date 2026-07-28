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
