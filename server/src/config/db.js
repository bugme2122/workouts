import mongoose from 'mongoose';

// mongoose.connect wrapper. Fails loud and clear if the DB is unreachable.
export async function connectDb(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is not set');
  mongoose.connection.on('error', (err) => console.error('[mongo] connection error', err));
  await mongoose.connect(uri);
  console.log('[mongo] connected');
  return mongoose.connection;
}
