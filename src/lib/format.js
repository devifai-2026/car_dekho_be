// Shared formatting helpers. Prices are stored in INR rupees; the API exposes
// a `priceLakh` number for the UI. Single source of truth for that conversion.

/** Convert INR rupees to a 2-decimal lakh number: inrToLakh(1200000) -> 12. */
export const inrToLakh = (inr) => +(inr / 100000).toFixed(2);
