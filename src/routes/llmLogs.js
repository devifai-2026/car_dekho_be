import { Router } from 'express';
import { getLlmLogs } from '../controllers/llmLogs.controller.js';

export const llmLogsRouter = Router();

llmLogsRouter.get('/llm-logs', getLlmLogs);
