import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, geminiConfigured } from '../config.js';
import { LlmLog } from '../models/LlmLog.js';

const client = geminiConfigured ? new GoogleGenerativeAI(config.gemini.apiKey) : null;

function stripFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Fire-and-forget log to Car_Dekho_LLM_Logs; never throws into the caller. */
function logCall(doc) {
  LlmLog.create(doc).catch((e) => console.error('[llm-log] write failed:', e.message));
}

/**
 * Make one structured Gemini call and persist a log doc with token usage.
 * @returns {Promise<object>} parsed + validated JSON (validate is a fn(obj)->obj)
 * @throws if not configured, on transport error, or on validation failure (after one retry)
 */
export async function callGemini({
  requestId,
  promptName,
  system,
  user,
  responseSchema,
  temperature,
  validate,
  candidateSkus,
}) {
  if (!client) throw new Error('GEMINI_NOT_CONFIGURED');

  const model = client.getGenerativeModel({
    model: config.gemini.model,
    systemInstruction: system,
    generationConfig: {
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
      temperature,
    },
  });

  const startedAt = Date.now();
  let lastErr;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.generateContent(user);
      const response = result.response;
      const rawResponse = response.text();
      const usage = response.usageMetadata || {};
      const parsed = validate(JSON.parse(stripFences(rawResponse)));

      logCall({
        requestId,
        promptName,
        model: config.gemini.model,
        temperature,
        requestPayload: { system, user, candidateSkus },
        rawResponse,
        parsedOutput: parsed,
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0,
        latencyMs: Date.now() - startedAt,
        success: true,
      });

      return parsed;
    } catch (err) {
      lastErr = err;
      // Don't retry on quota / client errors (429, 4xx) — it only burns more quota.
      const msg = String(err?.message || '');
      if (/\[4\d\d\b/.test(msg) || /quota|rate.?limit|Too Many Requests/i.test(msg)) break;
    }
  }

  logCall({
    requestId,
    promptName,
    model: config.gemini.model,
    temperature,
    requestPayload: { system, user, candidateSkus },
    rawResponse: '',
    parsedOutput: null,
    latencyMs: Date.now() - startedAt,
    success: false,
    error: lastErr?.message || 'unknown',
  });

  throw lastErr;
}
