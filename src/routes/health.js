import { Router } from 'express';
import { dbReady } from '../db/connect.js';
import { geminiConfigured } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, db: dbReady(), geminiConfigured });
});
