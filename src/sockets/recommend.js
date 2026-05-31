import { runRecommendation } from '../services/recommend.js';

/**
 * Wire the recommend flow over Socket.IO so a slow multi-call Gemini pipeline
 * never trips a REST timeout, and the client can narrate real progress.
 * Events emitted back: 'brief' -> 'intent' -> 'candidates' -> 'shortlist' (or 'error').
 */
export function registerRecommendSocket(io) {
  io.on('connection', (socket) => {
    socket.on('recommend', async (payload = {}) => {
      const text = String(payload.text || '').trim();
      const chips = Array.isArray(payload.chips) ? payload.chips : [];

      if (text.length < 5) {
        socket.emit('error', {
          code: 'INPUT_TOO_SHORT',
          message: 'Tell us a bit more — who will drive it, about your family members and roughly your budget?',
        });
        return;
      }

      try {
        const result = await runRecommendation(
          { text, chips },
          {
            onBrief: (brief) => socket.emit('brief', brief),
            onIntent: (intent) => socket.emit('intent', intent),
            onCandidates: (info) => socket.emit('candidates', info),
            // Stream the shortlist as soon as it's ready (cars render now)...
            onShortlist: (shortlist) => socket.emit('shortlist', shortlist),
            // ...then the upsell picks arrive a moment later.
            onExpertPicks: (picks) => socket.emit('expertPicks', picks),
          }
        );

        // Guardrail: off-topic / nonsense / prompt-injection input (no onShortlist fired).
        if (result.offTopic) {
          socket.emit('error', {
            code: 'OFF_TOPIC',
            message: "I can only help you choose a car. Tell me how you'll use it — who travels, where you drive, and (optionally) a budget.",
          });
        }
      } catch (err) {
        console.error('[recommend] failed:', err);
        socket.emit('error', {
          code: 'RECOMMEND_FAILED',
          message: 'Something went wrong building your shortlist. Please try again.',
        });
      }
    });
  });
}
