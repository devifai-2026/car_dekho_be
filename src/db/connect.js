import mongoose from 'mongoose';
import { config } from '../config.js';

let memoryServer = null;

/**
 * Connect to MongoDB. Uses MONGODB_URI when provided (Atlas/Docker),
 * otherwise spins up an in-process mongodb-memory-server so the app
 * runs with zero setup (`npm run dev` just works).
 */
export async function connectDb() {
  let uri = config.mongoUri;
  let mode = 'external';

  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
    mode = 'in-memory';
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: 'car_dekho' });
  console.log(`[db] connected (${mode})`);
  return mode;
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

export function dbReady() {
  return mongoose.connection.readyState === 1;
}
