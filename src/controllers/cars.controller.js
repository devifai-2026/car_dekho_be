import { Car } from '../models/Car.js';

// Browse the catalog. req.carQuery / req.carLimit are set by buildCarQuery middleware.
export async function listCars(req, res) {
  const cars = await Car.find(req.carQuery).limit(req.carLimit).lean();
  res.json({ count: cars.length, cars });
}

// Fetch a single car by SKU.
export async function getCarBySku(req, res) {
  const car = await Car.findOne({ sku: req.params.sku }).lean();
  if (!car) return res.status(404).json({ error: 'Car not found' });
  res.json(car);
}
