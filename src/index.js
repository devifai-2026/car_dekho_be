import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { connectDb } from './db/connect.js';
import { seedIfEmpty } from './data/seed.js';
import { healthRouter } from './routes/health.js';
import { carsRouter } from './routes/cars.js';
import { llmLogsRouter } from './routes/llmLogs.js';
import { registerRecommendSocket } from './sockets/recommend.js';

async function main() {
  await connectDb();
  await seedIfEmpty();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', healthRouter);
  app.use('/api', carsRouter);
  app.use('/api', llmLogsRouter);

  const server = http.createServer(app);
  const io = new SocketServer(server, { cors: { origin: '*' } });
  registerRecommendSocket(io);

  server.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
