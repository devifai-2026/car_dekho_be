import { randomUUID } from 'node:crypto';
import { geminiConfigured } from '../config.js';
import { callGemini } from './gemini.js';
import { findCandidates, scoreAndSort, findUpsellCandidates } from './scoring.js';
import { inrToLakh } from '../lib/format.js';
import {
  INTENT_SYSTEM,
  INTENT_TEMPERATURE,
  intentResponseSchema,
  intentZod,
  buildIntentUser,
} from '../prompts/intent.prompt.js';
import {
  RANK_SYSTEM,
  RANK_TEMPERATURE,
  rankResponseSchema,
  rankZod,
  buildRankUser,
} from '../prompts/ranking.prompt.js';
import {
  BRIEF_SYSTEM,
  BRIEF_TEMPERATURE,
  briefResponseSchema,
  briefZod,
  buildBriefUser,
} from '../prompts/buyer-brief.prompt.js';
import {
  EXPERT_SYSTEM,
  EXPERT_TEMPERATURE,
  expertResponseSchema,
  expertZod,
  buildExpertUser,
} from '../prompts/expert-picks.prompt.js';

// ---- Chip hints -> authoritative intent overrides -------------------------
const CHIP_MAP = {
  family: { addSeats: 5, priorities: ['space', 'safety'] },
  'city-commute': { usage: 'city', priorities: ['mileage', 'value'] },
  highway: { usage: 'highway', priorities: ['comfort', 'performance'] },
  value: { priorities: ['value', 'mileage'] },
  'first-car': { priorities: ['safety', 'value'] },
};

function applyChips(intent, chips = []) {
  const out = { ...intent, priorities: [...intent.priorities] };
  for (const chip of chips) {
    const m = CHIP_MAP[chip];
    if (!m) continue;
    if (m.usage) out.usage = m.usage; // chip is authoritative
    if (m.addSeats && (!out.seatsMin || out.seatsMin < m.addSeats)) out.seatsMin = m.addSeats;
    for (const p of m.priorities || []) if (!out.priorities.includes(p)) out.priorities.push(p);
  }
  // Seating capacity: family size if known, else a floor of 4 (never below 4).
  out.seatsMin = Math.max(out.seatsMin || 0, out.familySize || 0, 4);
  return out;
}

/** Crude keyword fallback when Gemini is unavailable — keeps the app alive. */
function fallbackIntent(text = '', chips = []) {
  const t = text.toLowerCase();
  const intent = {
    budgetMin: 0,
    budgetMax: 0,
    familySize: 0,
    seatsMin: 0,
    usage: /highway|long drive|outstation/.test(t) ? 'highway' : /city|commute|traffic/.test(t) ? 'city' : null,
    bodyType: [],
    fuelType: [],
    priorities: [],
    rawQuotes: [],
    missingFields: [],
  };
  const lakh = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|l\b)/);
  if (lakh) intent.budgetMax = Math.round(parseFloat(lakh[1]) * 100000);
  const fam = t.match(/family of (\d+)/) || t.match(/(\d+)\s*(?:people|members|seater)/);
  if (fam) intent.familySize = Number(fam[1]);
  if (/suv/.test(t)) intent.bodyType.push('suv');
  if (/hatchback|small car/.test(t)) intent.bodyType.push('hatchback');
  if (/sedan/.test(t)) intent.bodyType.push('sedan');
  if (/diesel/.test(t)) intent.fuelType.push('diesel');
  if (/petrol/.test(t)) intent.fuelType.push('petrol');
  if (/\bev\b|electric/.test(t)) intent.fuelType.push('ev');
  if (/safe|safety/.test(t)) intent.priorities.push('safety');
  if (/mileage|fuel efficien|economical/.test(t)) intent.priorities.push('mileage');
  if (/space|spacious|boot|luggage/.test(t)) intent.priorities.push('space');
  return intent;
}

// ---- PROMPT 0: buyer requirement parser (pre-parser) ----------------------
const EMPTY_BRIEF = {
  normalizedDescription: '',
  useCases: [],
  vibe: null,
  terrain: [],
  evOpen: false,
  passengers: 0,
  budgetMentioned: false,
  offTopic: false,
  rawQuotes: [],
};

async function parseBuyerBrief({ requestId, text, chips }) {
  if (!geminiConfigured) return { brief: { ...EMPTY_BRIEF }, briefDegraded: true };
  try {
    const brief = await callGemini({
      requestId,
      promptName: 'brief',
      system: BRIEF_SYSTEM,
      user: buildBriefUser({ text, chips }),
      responseSchema: briefResponseSchema,
      temperature: BRIEF_TEMPERATURE,
      validate: (obj) => briefZod.parse(obj),
    });
    return { brief, briefDegraded: false };
  } catch {
    return { brief: { ...EMPTY_BRIEF }, briefDegraded: true };
  }
}

// Map the lifestyle brief onto the structured intent so it drives query + scoring.
function mergeBrief(intent, brief) {
  const out = { ...intent, priorities: [...intent.priorities] };
  const addPriority = (p) => { if (p && !out.priorities.includes(p)) out.priorities.push(p); };

  if (brief.vibe === 'luxury' || brief.vibe === 'premium') { addPriority('luxury'); addPriority('comfort'); addPriority('features'); }
  if (brief.vibe === 'comfort') addPriority('comfort');
  if (brief.vibe === 'sporty') addPriority('performance');
  if (brief.vibe === 'budget' || brief.vibe === 'practical') addPriority('value');

  if (brief.terrain?.includes('off-road') || brief.terrain?.includes('hilly')) { addPriority('off-road'); addPriority('performance'); }
  if (brief.terrain?.includes('highway')) addPriority('comfort');

  if (brief.useCases?.includes('off-road')) addPriority('off-road');
  if (brief.useCases?.includes('long-drive')) addPriority('comfort');
  if (brief.useCases?.includes('family-trips')) addPriority('space');

  // EV-openness: ensure ev is allowed alongside whatever Prompt 1 suggested.
  if (brief.evOpen && !out.fuelType.includes('ev')) out.fuelType = [...out.fuelType, 'ev'];

  // Passenger count contributes to the seat floor (still min 4).
  out.seatsMin = Math.max(out.seatsMin || 0, brief.passengers || 0, 4);

  // Carry the lifestyle signals through for ranking context + UI reflection.
  out.vibe = brief.vibe || null;
  out.useCases = brief.useCases || [];
  out.terrain = brief.terrain || [];
  out.evOpen = !!brief.evOpen;
  return out;
}

async function extractIntent({ requestId, text, chips, brief }) {
  let base;
  let intentDegraded = false;
  // Prefer the parser's normalized restatement as input to Prompt 1 (cleaner than vague raw text).
  const intentText = brief?.normalizedDescription ? `${brief.normalizedDescription}\n\nOriginal: ${text}` : text;
  if (geminiConfigured) {
    try {
      base = await callGemini({
        requestId,
        promptName: 'intent',
        system: INTENT_SYSTEM,
        user: buildIntentUser({ text: intentText, chips }),
        responseSchema: intentResponseSchema,
        temperature: INTENT_TEMPERATURE,
        validate: (obj) => intentZod.parse(obj),
      });
    } catch {
      base = intentZod.parse(fallbackIntent(text, chips));
      intentDegraded = true;
    }
  } else {
    base = intentZod.parse(fallbackIntent(text, chips));
    intentDegraded = true;
  }
  // chip overrides -> then lifestyle brief overlay.
  const intent = mergeBrief(applyChips(base, chips), brief || EMPTY_BRIEF);
  return { intent, intentDegraded };
}

function leanCandidate(scored) {
  const c = scored.car;
  return {
    sku: c.sku,
    make: c.make,
    model: c.model,
    variant: c.variant,
    priceLakh: inrToLakh(c.priceMinINR),
    bodyType: c.bodyType,
    fuelType: c.fuelType,
    seats: c.seats,
    mileageKmpl: c.mileageKmpl,
    rangeKm: c.rangeKm,
    ncapStars: c.safety?.ncapStars ?? 0,
    bootLitres: c.bootLitres,
    features: (c.features || []).slice(0, 5),
    reviewSentiment: c.reviewSentiment,
  };
}

// Build a car-specific fallback pitch. Collect every standout this car has, then
// pick by rank so same-category cars don't repeat the same hook, and vary the
// urgency tail. (Only used in degraded mode; the LLM owns pitches when available.)
const URGENCY = [
  'grab it today',
  "book a test drive before it's gone",
  "at this price it won't sit around",
  'this is the one — make it yours now',
  'smart buyers are moving on this fast',
];

function standoutPitch(c, i = 0) {
  const name = `${c.make} ${c.model}`;
  const hooks = [];
  if (c.fuelType === 'ev' && c.rangeKm >= 300) hooks.push(`glide silently for ~${c.rangeKm} km on a charge and slash fuel bills`);
  if ((c.specs?.groundClearanceMm || 0) >= 210) hooks.push(`${c.specs.groundClearanceMm}mm of clearance shrugs off the roughest trails`);
  if ((c.tags || []).includes('luxury') || (c.tags || []).includes('premium')) hooks.push('a genuinely premium cabin that turns every drive into an occasion');
  if ((c.safety?.ncapStars || 0) >= 5) hooks.push('a full 5-star crash rating for real peace of mind');
  if (c.bootLitres >= 500) hooks.push(`a cavernous ${c.bootLitres}L boot that swallows everything you pack`);
  if (c.seats >= 7) hooks.push('7 proper seats so nobody gets left behind');
  if (c.mileageKmpl >= 22) hooks.push(`a frugal ${c.mileageKmpl} kmpl that keeps running costs tiny`);
  if (c.specs?.sunroof) hooks.push('a panoramic sunroof that makes long drives feel special');
  if ((c.safety?.airbags || 0) >= 6) hooks.push(`${c.safety.airbags} airbags wrapping the whole family in protection`);
  if (!hooks.length) hooks.push('exactly the all-rounder you described');

  // Rank-rotate the chosen hook so adjacent same-category cars differ.
  const hook = hooks[i % hooks.length];
  const tail = URGENCY[i % URGENCY.length];
  return `${name}: ${hook} — ${tail}.`;
}

/** Deterministic templated rationale/pros/cons when LLM ranking is unavailable. */
function templatedRanking(scoredList, intent) {
  return scoredList.map((s, i) => {
    const c = s.car;
    const pros = [];
    if (s.factors.budgetFit >= 80) pros.push('Comfortably within your budget');
    if ((c.safety?.ncapStars || 0) >= 4) pros.push(`${c.safety.ncapStars}-star safety rating`);
    if (c.fuelType === 'ev') pros.push(`Electric — approx ${c.rangeKm} km range`);
    else if (c.mileageKmpl >= 18) pros.push(`Good mileage (~${c.mileageKmpl} kmpl)`);
    if (c.seats >= 7) pros.push('7-seater — extra space');
    const cons = [];
    if (s.factors.budgetFit < 70) cons.push('At the upper end of your budget');
    if ((c.safety?.ncapStars || 0) < 4) cons.push('Modest safety rating');
    return {
      sku: c.sku,
      rank: i + 1,
      rationale: `A strong match for your stated needs${intent.usage ? `, well suited to ${intent.usage} driving` : ''}.`,
      pitch: standoutPitch(c, i),
      prosForUser: pros.slice(0, 3),
      consForUser: cons.slice(0, 2),
      matchedPriorities: (intent.priorities || []).slice(0, 3),
      specsThatMatter: ['priceLakh', c.fuelType === 'ev' ? 'rangeKm' : 'mileageKmpl', 'ncapStars', 'seats'],
    };
  });
}

async function rankCandidates({ requestId, intent, scoredList }) {
  const candidates = scoredList.map(leanCandidate);
  if (!geminiConfigured || candidates.length === 0) {
    return { ranked: templatedRanking(scoredList, intent), rankDegraded: true };
  }
  try {
    const out = await callGemini({
      requestId,
      promptName: 'ranking',
      system: RANK_SYSTEM,
      user: buildRankUser({ intent, candidates }),
      responseSchema: rankResponseSchema,
      temperature: RANK_TEMPERATURE,
      validate: (obj) => rankZod.parse(obj),
      candidateSkus: candidates.map((c) => c.sku),
    });
    return { ranked: out.ranked, overallNote: out.overallNote, rankDegraded: false };
  } catch {
    return { ranked: templatedRanking(scoredList, intent), rankDegraded: true };
  }
}

// ---- PROMPT 3: expert's picks (gentle upsell, +₹2–5L above the shortlist) ---
function expertCardFromCar(c, llm) {
  return {
    sku: c.sku,
    make: c.make,
    model: c.model,
    variant: c.variant,
    priceLakh: inrToLakh(c.priceMinINR),
    bodyType: c.bodyType,
    fuelType: c.fuelType,
    imageUrl: c.imageUrl,
    brochureUrl: c.brochureUrl,
    headline: llm?.headline || 'Worth the stretch',
    whyStretch:
      llm?.whyStretch ||
      `For a little more, you step up to a more premium, better-equipped ${c.make} ${c.model}.`,
    extraFeatures: (llm?.extraFeatures?.length ? llm.extraFeatures : (c.features || []).slice(0, 3)),
  };
}

async function buildExpertPicks({ requestId, intent, results }) {
  if (!results.length) return [];
  const anchorINR = Math.max(...results.map((r) => r.priceMinINR));
  const excludeSkus = results.map((r) => r.sku);
  const scored = await findUpsellCandidates({ anchorINR, intent, excludeSkus });
  if (!scored.length) return [];

  const candidates = scored.map((s) => leanCandidate(s));
  const byKey = new Map(scored.map((s) => [s.car.sku, s.car]));
  const shortlistNames = results.map((r) => `${r.make} ${r.model}`);

  // Deterministic fallback: top 2 by score, templated copy.
  const fallback = () => scored.slice(0, 2).map((s) => expertCardFromCar(s.car, null));

  if (!geminiConfigured) return fallback();
  try {
    const out = await callGemini({
      requestId,
      promptName: 'expert',
      system: EXPERT_SYSTEM,
      user: buildExpertUser({ intent, shortlistNames, candidates }),
      responseSchema: expertResponseSchema,
      temperature: EXPERT_TEMPERATURE,
      validate: (obj) => expertZod.parse(obj),
      candidateSkus: candidates.map((c) => c.sku),
    });
    const picks = (out.picks || [])
      .filter((p) => byKey.has(p.sku)) // drop hallucinated skus
      .slice(0, 2)
      .map((p) => expertCardFromCar(byKey.get(p.sku), p));
    return picks.length ? picks : fallback();
  } catch {
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// ORCHESTRATION
// ---------------------------------------------------------------------------
export async function runRecommendation({ text, chips = [] }, hooks = {}) {
  const requestId = randomUUID();

  // 1) Prompt 0 — buyer requirement parser (handles vague / lifestyle / no-budget input)
  const { brief, briefDegraded } = await parseBuyerBrief({ requestId, text, chips });
  hooks.onBrief?.(brief);

  // Guardrail: off-topic / nonsense / injection -> stop here (no Prompt 1/2 calls, saves quota).
  if (brief.offTopic) {
    return { offTopic: true, brief, intent: null, results: [], degraded: briefDegraded };
  }

  // 2) Prompt 1 — structured intent (informed by the brief)
  const { intent, intentDegraded } = await extractIntent({ requestId, text, chips, brief });
  hooks.onIntent?.(intent);

  // 3) Code — query + score (budget filter is skipped automatically when no budget was given)
  const { cars, relaxed } = await findCandidates(intent);
  const scoredList = scoreAndSort(cars, intent);
  hooks.onCandidates?.({ count: scoredList.length, relaxed });

  // 4) Prompt 2 — ranking (grounded to candidate SKUs)
  const { ranked, overallNote, rankDegraded } = await rankCandidates({ requestId, intent, scoredList });

  // 4) Validate SKUs subset of candidates; backfill from code score; join to DB docs.
  const byKey = new Map(scoredList.map((s) => [s.car.sku, s]));
  const seen = new Set();
  const ordered = [];
  for (const r of ranked.sort((a, b) => a.rank - b.rank)) {
    const s = byKey.get(r.sku);
    if (!s || seen.has(r.sku)) continue; // drop hallucinated / duplicate skus
    seen.add(r.sku);
    ordered.push({ scored: s, llm: r });
  }
  // Backfill if the model returned fewer than the available candidates (cap 5).
  for (const s of scoredList) {
    if (ordered.length >= 5) break;
    if (seen.has(s.car.sku)) continue;
    seen.add(s.car.sku);
    ordered.push({ scored: s, llm: null });
  }

  // Blend the LLM's ordering with the code-computed fit into ONE score, then
  // sort by it. This guarantees the displayed match% is monotonic with rank
  // (so the #1 pick never shows a lower % than #3) — preserving user confidence
  // while still honoring Prompt 2's ranking as a primary signal.
  const blended = ordered.slice(0, 5).map(({ scored, llm }, i) => {
    const llmPoints = Math.max(45, 100 - i * 12); // i = position in LLM order
    const matchScore = Math.round(0.5 * scored.matchScore + 0.5 * llmPoints);
    return { scored, llm, matchScore };
  });
  blended.sort((a, b) => b.matchScore - a.matchScore);

  const results = blended.map(({ scored, llm, matchScore }, idx) => {
    const c = scored.car;
    const tmpl = llm || templatedRanking([scored], intent)[0];
    return {
      rank: idx + 1,
      sku: c.sku,
      make: c.make,
      model: c.model,
      variant: c.variant,
      priceMinINR: c.priceMinINR,
      priceMaxINR: c.priceMaxINR,
      priceLakh: inrToLakh(c.priceMinINR),
      bodyType: c.bodyType,
      fuelType: c.fuelType,
      transmission: c.transmission,
      seats: c.seats,
      mileageKmpl: c.mileageKmpl,
      rangeKm: c.rangeKm,
      safety: c.safety,
      bootLitres: c.bootLitres,
      specs: c.specs,
      features: c.features,
      reviewSummary: c.reviewSummary,
      reviewSentiment: c.reviewSentiment,
      brochureUrl: c.brochureUrl,
      imageUrl: c.imageUrl,
      // blended score (code fit + LLM rank), monotonic with rank; breakdown kept for transparency
      matchScore,
      factors: scored.factors,
      // LLM (or templated) qualitative layer
      rationale: tmpl.rationale,
      pitch: tmpl.pitch,
      prosForUser: tmpl.prosForUser,
      consForUser: tmpl.consForUser,
      matchedPriorities: tmpl.matchedPriorities,
      specsThatMatter: tmpl.specsThatMatter,
    };
  });

  // 5) Prompt 3 — expert's picks (optional upsell, +₹2–5L above the shortlist)
  const expertPicks = await buildExpertPicks({ requestId, intent, results });

  return {
    brief,
    intent,
    results,
    expertPicks,
    overallNote: overallNote || '',
    relaxed,
    noBudget: !intent.budgetMax,
    degraded: briefDegraded || intentDegraded || rankDegraded,
  };
}
