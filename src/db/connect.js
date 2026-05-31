import mongoose from 'mongoose';
import { config } from '../config.js';

/**
 * Connect to MongoDB via MONGODB_URI (Atlas / any Mongo server).
 * No in-memory fallback — set MONGODB_URI in the environment.
 */
export async function connectDb() {
  const uri = config.mongoUri;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Provide your MongoDB connection string (e.g. Atlas).');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: 'car_dekho' });
  console.log('[db] connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export function dbReady() {
  return mongoose.connection.readyState === 1;
}
