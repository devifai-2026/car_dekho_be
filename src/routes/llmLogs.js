import { Router } from 'express';
import { LlmLog } from '../models/LlmLog.js';

export const llmLogsRouter = Router();

// Lightweight observability: recent Gemini calls + token totals.
llmLogsRouter.get('/llm-logs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const logs = await LlmLog.find().sort({ createdAt: -1 }).limit(limit).lean();
  const totals = await LlmLog.aggregate([
    {
      $group: {
        _id: null,
        calls: { $sum: 1 },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        totalTokens: { $sum: '$totalTokens' },
      },
    },
  ]);
  res.json({
    totals: totals[0] || { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    logs: logs.map((l) => ({
      createdAt: l.createdAt,
      requestId: l.requestId,
      promptName: l.promptName,
      model: l.model,
      inputTokens: l.inputTokens,
      outputTokens: l.outputTokens,
      totalTokens: l.totalTokens,
      latencyMs: l.latencyMs,
      success: l.success,
      error: l.error,
    })),
  });
});
