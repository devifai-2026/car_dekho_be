// Shared controlled vocabularies. Both prompts and the deterministic code
// reference these so the LLM output, the DB query, and the UI stay in sync.
export const BODY_TYPES = ['hatchback', 'sedan', 'suv', 'compact-suv', 'muv'];
export const FUEL_TYPES = ['petrol', 'diesel', 'cng', 'hybrid', 'ev'];
export const USAGES = ['city', 'highway', 'mixed'];
export const PRIORITIES = ['safety', 'mileage', 'space', 'performance', 'comfort', 'value', 'features', 'luxury', 'off-road'];

// ---- Lifestyle dimensions (produced by the buyer-requirement pre-parser) ----
export const USE_CASES = ['daily-commute', 'long-drive', 'off-road', 'family-trips', 'content-creation', 'first-car'];
export const VIBES = ['luxury', 'premium', 'comfort', 'sporty', 'practical', 'budget'];
export const TERRAINS = ['city', 'highway', 'hilly', 'off-road'];
