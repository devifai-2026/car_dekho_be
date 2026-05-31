import { dbReady } from '../db/connect.js';
import { geminiConfigured } from '../config.js';

export function getHealth(_req, res) {
  res.json({ ok: true, db: dbReady(), geminiConfigured });
}
