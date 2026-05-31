import { Router } from 'express';
import { buildCarQuery } from '../middleware/carQuery.js';
import { listCars, getCarBySku } from '../controllers/cars.controller.js';

export const carsRouter = Router();

carsRouter.get('/cars', buildCarQuery, listCars);
carsRouter.get('/cars/:sku', getCarBySku);
