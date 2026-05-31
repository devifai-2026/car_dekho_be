import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Car } from '../models/Car.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadSeedData() {
  const raw = await readFile(path.resolve(__dirname, 'cars.seed.json'), 'utf-8');
  return JSON.parse(raw);
}

/** Seed the cars collection on boot only when empty (idempotent). */
export async function seedIfEmpty() {
  const count = await Car.countDocuments();
  if (count > 0) {
    console.log(`[seed] cars already present (${count}) — skipping`);
    return count;
  }
  const cars = await loadSeedData();
  await Car.insertMany(cars);
  console.log(`[seed] inserted ${cars.length} cars`);
  return cars.length;
}

// Allow `npm run seed` to force a reseed.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb();
  await Car.deleteMany({});
  const cars = await loadSeedData();
  await Car.insertMany(cars);
  console.log(`[seed] reseeded ${cars.length} cars`);
  await disconnectDb();
  process.exit(0);
}
