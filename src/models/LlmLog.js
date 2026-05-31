import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One document per Gemini call. Two per /recommend (intent + ranking),
 * sharing a requestId. Written fire-and-forget by services/gemini.js.
 * Collection name is fixed to Car_Dekho_LLM_Logs per requirement.
 */
const llmLogSchema = new Schema(
  {
    requestId: { type: String, index: true },
    promptName: { type: String, enum: ['brief', 'intent', 'ranking', 'expert'], required: true },
    model: { type: String, required: true },
    temperature: { type: Number },
    requestPayload: { type: Schema.Types.Mixed }, // { system, user, candidateSkus? }
    rawResponse: { type: String, default: '' },
    parsedOutput: { type: Schema.Types.Mixed, default: null },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    success: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
);

export const LlmLog = mongoose.model('LlmLog', llmLogSchema, 'Car_Dekho_LLM_Logs');
