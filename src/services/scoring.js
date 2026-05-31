import { Car } from '../models/Car.js';

const CANDIDATE_LIMIT = 12;

/** Build a Mongo query from extracted intent. Chip hints are merged in by the caller. */
function buildQuery(intent, { budgetSlack = 0 } = {}) {
  const q = {};
  if (intent.budgetMax > 0) {
    q.priceMinINR = { $lte: Math.round(intent.budgetMax * (1 + budgetSlack)) };
  }
  if (intent.budgetMin > 0) {
    q.priceMaxINR = { $gte: Math.round(intent.budgetMin * (1 - budgetSlack)) };
  }
  if (intent.seatsMin > 0) q.seats = { $gte: intent.seatsMin };
  if (Array.isArray(intent.bodyType) && intent.bodyType.length) q.bodyType = { $in: intent.bodyType };
  if (Array.isArray(intent.fuelType) && intent.fuelType.length) q.fuelType = { $in: intent.fuelType };
  return q;
}

/**
 * Find candidates with a deterministic relax ladder (NOT a 3rd LLM call):
 * exact -> widen budget +15% -> drop fuel -> drop body -> top by price.
 */
export async function findCandidates(intent) {
  const attempts = [
    () => buildQuery(intent),
    () => buildQuery(intent, { budgetSlack: 0.15 }),
    () => {
      const q = buildQuery(intent, { budgetSlack: 0.15 });
      delete q.fuelType;
      return q;
    },
    () => {
      const q = buildQuery(intent, { budgetSlack: 0.15 });
      delete q.fuelType;
      delete q.bodyType;
      return q;
    },
    () => ({}),
  ];

  for (let i = 0; i < attempts.length; i++) {
    const query = attempts[i]();
    const cars = await Car.find(query)
      .sort({ priceMinINR: 1 })
      .limit(CANDIDATE_LIMIT)
      .lean();
    if (cars.length >= 3 || i === attempts.length - 1) {
      return { cars, relaxed: i > 0 };
    }
  }
  return { cars: [], relaxed: true };
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Code-computed match score 0-100 with a transparent per-factor breakdown.
 * The DISPLAYED score comes from here (reproducible); the LLM only orders + explains.
 */
export function scoreCar(car, intent) {
  const priorities = new Set(intent.priorities || []);
  const factors = {};

  // Budget fit: within budget = full marks; over budget decays.
  if (intent.budgetMax > 0) {
    const ratio = car.priceMinINR / intent.budgetMax;
    factors.budgetFit = ratio <= 1 ? 100 : clamp(100 - (ratio - 1) * 200);
  } else {
    factors.budgetFit = 70;
  }

  // Safety: scaled NCAP stars, boosted if user cares.
  const safetyBase = (car.safety?.ncapStars || 0) * 20;
  factors.safety = priorities.has('safety') ? clamp(safetyBase) : clamp(safetyBase * 0.6 + 40 * 0.4);

  // Mileage: 25 kmpl ~ full; EVs treated as efficient.
  const mileageBase = car.fuelType === 'ev' ? 95 : clamp((car.mileageKmpl / 25) * 100);
  factors.mileage = priorities.has('mileage') ? mileageBase : clamp(mileageBase * 0.6 + 40 * 0.4);

  // Use fit: tag match against usage + priorities + lifestyle signals (vibe/terrain/use-cases).
  const tags = new Set(car.tags || []);
  let useHits = 0;
  let useTotal = 0;
  const credit = (cond) => { useTotal++; if (cond) useHits++; };

  if (intent.usage) credit(tags.has(intent.usage));
  ['space', 'comfort', 'performance', 'luxury', 'off-road'].forEach((p) => {
    if (priorities.has(p)) {
      credit(
        tags.has(p) ||
          (p === 'space' && (car.seats >= 7 || car.bootLitres >= 400)) ||
          (p === 'off-road' && (car.specs?.groundClearanceMm || 0) >= 200)
      );
    }
  });
  // Lifestyle dimensions from the buyer brief (Prompt 0).
  if (intent.vibe) credit(tags.has(intent.vibe));
  (intent.terrain || []).forEach((t) =>
    credit(tags.has(t) || (t === 'hilly' && (car.specs?.groundClearanceMm || 0) >= 200))
  );
  (intent.useCases || []).forEach((u) => credit(tags.has(u) || (u === 'long-drive' && tags.has('highway'))));

  factors.useFit = useTotal ? clamp((useHits / useTotal) * 100) : 70;

  // Features count.
  factors.features = clamp(((car.features?.length || 0) / 8) * 100);

  const weights = { budgetFit: 0.3, safety: 0.25, mileage: 0.2, useFit: 0.15, features: 0.1 };
  const matchScore = clamp(
    Object.entries(weights).reduce((sum, [k, w]) => sum + factors[k] * w, 0)
  );

  return { matchScore, factors };
}

export function scoreAndSort(cars, intent) {
  return cars
    .map((car) => ({ car, ...scoreCar(car, intent) }))
    .sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Upsell candidates: cars priced ₹2–5L ABOVE the shortlist's top price, still
 * matching the buyer's body/fuel preference, excluding cars already shortlisted.
 * Anchored to the shortlist (works even when no budget was given).
 */
export async function findUpsellCandidates({ anchorINR, intent, excludeSkus }) {
  const q = {
    priceMinINR: { $gt: anchorINR + 200000, $lte: anchorINR + 500000 },
    sku: { $nin: excludeSkus },
  };
  if (Array.isArray(intent.bodyType) && intent.bodyType.length) q.bodyType = { $in: intent.bodyType };
  if (Array.isArray(intent.fuelType) && intent.fuelType.length) q.fuelType = { $in: intent.fuelType };

  let cars = await Car.find(q).sort({ priceMinINR: 1 }).limit(6).lean();
  // Relax body/fuel if nothing in band, but keep the price window.
  if (cars.length === 0) {
    cars = await Car.find({
      priceMinINR: { $gt: anchorINR + 200000, $lte: anchorINR + 500000 },
      sku: { $nin: excludeSkus },
    })
      .sort({ priceMinINR: 1 })
      .limit(6)
      .lean();
  }
  return scoreAndSort(cars, intent);
}
