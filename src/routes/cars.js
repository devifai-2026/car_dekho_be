import { Router } from 'express';
import { Car } from '../models/Car.js';

export const carsRouter = Router();

// Browse / sanity-check the catalog.
carsRouter.get('/cars', async (req, res) => {
  const { body, fuel, maxLakh, limit = 50 } = req.query;
  const q = {};
  if (body) q.bodyType = body;
  if (fuel) q.fuelType = fuel;
  if (maxLakh) q.priceMaxINR = { $lte: Number(maxLakh) * 100000 };
  const cars = await Car.find(q).limit(Number(limit)).lean();
  res.json({ count: cars.length, cars });
});

carsRouter.get('/cars/:sku', async (req, res) => {
  const car = await Car.findOne({ sku: req.params.sku }).lean();
  if (!car) return res.status(404).json({ error: 'Car not found' });
  res.json(car);
});
