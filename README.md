# CarDekho v2 — from "I don't know what car to buy" to a confident shortlist

A MERN + Gemini app that turns a buyer's plain-language description of their life into a
**ranked, side-by-side comparison** of the 3–5 cars that actually fit them — with honest pros *and*
cons, grounded entirely in real catalog data.

> **The product bet:** confused buyers don't need *more* listings — they need fewer, well-explained
> options they can *compare*. Confidence comes from contrast, not from a longer list.

---

## Run it (one command)

```bash
cp .env.example server/.env      # then set GEMINI_API_KEY and MONGODB_URI in server/.env
npm install
npm run dev                      # server :4000 (Express+Socket.IO) + client :5173 (Vite)
```

Open **http://localhost:5173**. Set **`MONGODB_URI`** (e.g. a free MongoDB Atlas cluster) in
`server/.env` — the app connects directly to it and seeds ~50 cars on first boot (incl. a luxury tier:
Audi, BMW, Mercedes, etc.) when the collection is empty. Without a Gemini key the app still works (see
*Resilience* below).

Useful endpoints: `GET /api/health`, `GET /api/cars/:sku`, `GET /api/llm-logs` (token accounting).

---

## The product decisions (this is the assignment)

**1. No chatbot, no interview — one expressive input.**
The "intent extraction" happens *invisibly* inside a single free-text box ("Tell us about your life…"),
primed with a tappable example and 3–4 optional chips to defeat the blank-page problem. One submit.
There is no chat thread, no follow-up questions, no question-back. Instead of *asking* what we don't
know, we **reflect back what we understood** as a read-only "Here's what we heard" chip strip — the
trust mechanism that replaces the interview and lets the user spot a mis-read.

**2. The result is a comparison, not a feed.**
Cars are shown **side by side** (one column each), with rows limited to the dimensions *this* buyer
cares about. The first view shows the **top 3**; you page/swipe to #4–5. A decision artifact, not a
scroll.

**3. Honesty builds confidence.** Every car shows *why it fits you* **and** an honest *worth-knowing*
caveat. Cons are the strongest trust lever — they make the shortlist feel advised, not sold.

**4. No fancy UI.** Plain, fast, legible. Clarity over polish.

---

## Architecture — three Gemini prompts, deterministic code in between

```
Browser ──socket: recommend {text, chips}──▶ Express + Socket.IO
   │                                            │
   │   ┌── Gemini PROMPT 0 — BUYER REQUIREMENT PARSER (sees NO cars) ─▶ brief
   │   │        normalizes vague/lifestyle text; flags off-topic; no budget invented
   │   │        emit 'brief'  + log to Car_Dekho_LLM_Logs  (off-topic → stop here)
   │   ├── Gemini PROMPT 1 — INTENT EXTRACTION (sees NO cars) ─▶ intent JSON
   │   │        informed by the brief; suggests bodyType/fuelType; emit 'intent'
   │   ├── CODE — buildMongoQuery(intent) → cars.find() → ≤12 candidates
   │   │        (budget filter skipped if no budget; relax ladder if 0) → matchScore 0–100
   │   │        emit 'candidates'
   │   ├── Gemini PROMPT 2 — RANKING (sees ONLY the ≤12 candidates) ─▶ [{sku, rank, pitch, pros, cons}]
   │   │        log to Car_Dekho_LLM_Logs
   │   │   validate SKUs ⊆ candidates → join to DB docs → blend score → top 5
   │   └── Gemini PROMPT 3 — EXPERT'S PICKS — cars +₹2–5L above the shortlist's top price
   │            (anchored to the shortlist, works without a budget) ─▶ up to 2 "worth the stretch" picks
   ◀──socket: shortlist {brief, intent, results, expertPicks, degraded}
```

**Why three prompts:** Prompt 1 alone assumes structured, budget-anchored intent. Real buyers are
vague and lifestyle-driven ("luxury SUV for off-road vlogging, EV maybe, no budget"). **Prompt 0** (a
pre-parser) normalizes that into a clean brief — use-cases, vibe, terrain, EV-openness — which makes
Prompt 1's job reliable and lets us rank on fit even when no budget is given.

**Why a socket, not REST:** the sequential Gemini calls take several seconds; a blocking REST request
risks a timeout. The socket streams real progress (`brief` → `intent` → `candidates` → `shortlist`)
that drives the narrated loader on *real* boundaries.

**Clean split of labor (the AI-native part):**
- **LLM does** requirement parsing (Prompt 0), structured intent (Prompt 1), ranking + persuasive
  rationale (Prompt 2).
- **Code does** everything verifiable: DB filtering, the match score, sorting, SKU validation, and
  rendering every price/spec from the database.

**Grounding — the LLM can't invent a car:**
- Prompts 0 & 1 see *zero* cars; Prompt 2 sees only ≤12 lean candidate rows and returns **SKUs only**.
- The server validates every returned SKU against the candidate set, **drops hallucinations**,
  backfills from the code-ranked list, and re-joins to the Mongo docs — so all displayed facts are
  ground truth, never model output.
- All calls use Gemini **structured output** (`responseSchema` + JSON mime type), validated with zod.

**Guardrails (every prompt):** explicit anti-hallucination / no-wild-guess rules, prompt-injection
resistance (user text is treated as data, embedded "instructions" are ignored), and an `offTopic`
flag from Prompt 0 that short-circuits random/abusive input *before* Prompts 1 & 2 run (saving quota).

**Persuasion with honesty:** Prompt 2 returns a lucrative, desire-building `pitch` per car — but built
only on the car's *real* strengths (no fabricated facts), and always paired with an honest `con`. The
pitch sells; the con keeps it credible.

**One score, monotonic with rank:** the displayed match % blends the code fit with the LLM's ordering,
then results are sorted by it — so the #1 pick never shows a lower % than #3 (which would erode
confidence). The per-factor breakdown is kept for transparency.

**LLM observability (`Car_Dekho_LLM_Logs`):** every Gemini call writes one document — request payload,
raw response, parsed output, **input/output/total token counts** (from `usageMetadata`), latency, and
success/error — two docs per recommend, sharing a `requestId`. Logging is fire-and-forget.

---

## Resilience

If the Gemini key is missing, invalid, or rate-limited, the call fails are logged and the app **degrades
gracefully**: a deterministic keyword intent + code scoring + templated rationale still return a
grounded shortlist, with a visible `degraded` notice. The demo never hard-fails.

---

## Project structure

```
server/src/
  index.js            http + Socket.IO + routes
  db/connect.js       connects to MONGODB_URI (Atlas)
  models/Car.js       cars schema (~40 seeded Indian models)
  models/LlmLog.js    -> collection "Car_Dekho_LLM_Logs"
  data/cars.seed.json curated demo dataset (pre-written review summaries)
  prompts/vocab.js          shared controlled vocabularies
  prompts/buyer-brief.prompt.js Prompt 0: requirement parser (lifestyle/vague/off-topic)
  prompts/intent.prompt.js  Prompt 1: system + schema + validator + user builder
  prompts/ranking.prompt.js Prompt 2: ranking + persuasive pitch + honest cons
  prompts/expert-picks.prompt.js Prompt 3: +₹2–5L "worth the stretch" upsell picks
  services/gemini.js  logged structured-output call wrapper
  services/scoring.js Mongo query builder + relax ladder + match score
  services/recommend.js  the 2-call orchestration + grounding + blend
  sockets/recommend.js   intent → candidates → shortlist
client/src/
  pages/Home.jsx, pages/Results.jsx
  components/IntentChips.jsx, CompareGrid.jsx, ExpertPicks.jsx, NarratedLoader.jsx
```

## Demo script (~90s)
1. Type *"family of 4, ~12 lakh, mostly city, safety is my top concern"* → submit.
2. Watch the narrated loader advance on real socket events (with rotating car tips).
3. "Here's what we heard" chips reflect budget/family/city/safety.
4. Side-by-side comparison of the top 3 (swipe to 4–5); rationale quotes your words; cons shown.
5. "Expert's picks" below — 2 cars ₹2–5L above the shortlist, worth the stretch.
6. `GET /api/llm-logs` → the per-request Gemini calls with token counts, one `requestId`.

## Deliberate scope cuts (2–3h MVP)
Auth, cross-refresh persistence, runtime review summarization (pre-written into the dataset),
brochure PDF rendering (links out), vector DB/RAG (the Mongo prefilter is the retrieval layer), and a
real scraped-data pipeline (the seed is curated demo data).

---

## Deployment (Netlify frontend + Render backend)

The frontend and backend deploy as **two separate repos** to different hosts. In production they're on
different domains, so the frontend targets the backend via `VITE_API_URL` and the backend allows the
frontend origin via `CORS_ORIGIN`.

**Backend → Render** (repo root = `server/`, uses `render.yaml`):
1. New Web Service from the backend repo (or "Blueprint" to read `render.yaml`).
2. Set env vars: `GEMINI_API_KEY` (secret), `MONGODB_URI` (your Atlas connection string — **required**),
   `GEMINI_MODEL` (lowercase, e.g. `gemini-2.5-flash`), and `CORS_ORIGIN` (your frontend URL).
   `PORT` is injected by the platform automatically. Build `npm install`, start `npm start`.
3. Note the service URL, e.g. `https://car-dekho-be.onrender.com`.

**Frontend → Netlify** (repo root = `client/`, uses `netlify.toml`):
1. New site from the frontend repo. Build `npm run build`, publish `dist` (already in `netlify.toml`).
2. Add env var **`VITE_API_URL`** = the Render backend URL (build-time; Vite inlines it).
3. Deploy. Then set the backend's `CORS_ORIGIN` to this Netlify site URL and redeploy the backend.

**Performance & troubleshooting:**
- The Gemini calls use `thinkingConfig: { thinkingBudget: 0 }` to disable 2.5-flash's reasoning
  tokens — this cut the ranking call from ~28s to ~8s. The shortlist is streamed to the client first
  (`shortlist` event), then Expert's picks arrive separately (`expertPicks`), so cars render at ~12s
  instead of waiting on the whole chain.
- **"Loader never finishes"** is almost always a cold start (Render free dynos sleep). The frontend
  pings `/api/health` on load to warm it, and gives up after 90s with a retry. An external uptime
  pinger (e.g. cron-job.org → `/api/health` every ~10 min) avoids cold starts entirely.
- **"My Atlas is empty"** → `MONGODB_URI` isn't set (the app requires it). Set it to your Atlas
  connection string; `seedIfEmpty()` populates `car_dekho.cars` (~52 docs) on first boot.
- **`GEMINI_MODEL` must be lowercase** (`gemini-2.5-flash`). An uppercase value is an invalid model ID
  and every call 404s (results fall back to the deterministic, "degraded" path).

---

## Assignment Q&A

### 1. What did you build, and why? What did you deliberately cut?

**Built:** a guided car-discovery tool that moves a confused buyer from *"I don't know what to buy"*
to *"I'm confident about my shortlist."* The user describes their life in one free-text box (no
chatbot, no interview), and a chain of Gemini prompts + deterministic code turns that into a
**ranked, side-by-side comparison** of the best-fit cars — each with a persuasive pitch, honest
pros *and* cons, and a transparent match score, followed by an optional **"Expert's picks"** upsell.

**Why this shape:** the real problem isn't a lack of listings — it's *too many*. Confidence comes
from **contrast**: a few strong, well-explained options compared on the dimensions *you* care about.
So the headline output is a comparison (a decision artifact), not another feed. Trust is engineered
in deliberately — we *reflect understood intent back* instead of interrogating, and we always show
an honest caveat so the shortlist feels *advised*, not *sold*.

**Deliberately cut** (to stay within the time box and keep focus on the core "confused → confident"
loop): user accounts/auth, cross-refresh persistence, runtime review summarization (pre-written into
the dataset instead), brochure PDF rendering (we link out), a vector DB / RAG layer (the deterministic
Mongo prefilter *is* the retrieval layer), and a real scraped-data pipeline (the ~50-car seed is
curated demo data). These are either undifferentiated table-stakes or polish that wouldn't change
whether the core promise lands.

### 2. What's your tech stack, and why?

**MERN** — MongoDB, Express, React (Vite), Node — plus **Socket.IO** and the **Google Gemini** SDK.

- **Why MERN:** it's the stack I'm most confident and fast in, which matters in a tight time box. A
  SQL database would work equally well for this data, but I chose **MongoDB** for fast setup and
  flexible, schema-light iteration. The app connects directly to a MongoDB connection string
  (`MONGODB_URI`, e.g. a free Atlas cluster) and seeds itself on first boot.
- **Why Socket.IO over plain REST:** the pipeline makes several sequential Gemini calls that take a few
  seconds — a blocking REST request risks timing out. The socket keeps the connection alive and streams
  real progress (`brief → intent → candidates → shortlist`) that drives the narrated loading screen.
- **Why Gemini with structured output:** every prompt returns JSON validated against a schema (+ zod),
  which keeps the LLM grounded and the parsing robust.

### 3. What did you delegate to AI tools vs. do manually?

**Delegated to AI:** product brainstorming, documentation assistance, drafting the
requirement-extraction prompt copy, and keeping code quality / the README clean and consistent —
plus most repetitive front-end and back-end boilerplate.

**Done manually (the judgement calls):** the prompt *strategy* (a 4-stage chain, what each call owns),
the database design, the product scope and trade-offs, and the AI-integration decisions (grounding,
the deterministic-vs-LLM split, the score-blend, guardrails).

**3a. Where did the tools help most?** They significantly accelerated implementation speed —
especially repetitive FE/BE boilerplate — which let me spend my attention on the **HOW and WHY**: the
product decisions and a smooth user experience, rather than plumbing.

**3b. Where did they get in the way?** The tools occasionally suggested overly complex or
over-engineered solutions. Human judgement was needed to **simplify the scope** and keep everything
pointed at the core user problem.

### 4. If you had another 4 hours, what would you add?

- A **recommendation feedback system** (thumbs up/down per car) to learn from real choices.
- **Saved user preferences** behind a lightweight **auth module**, so shortlists persist.
- **More advanced comparison insights** (e.g. cost-of-ownership, resale, deeper spec deltas).
- **A/B testing** of recommendation quality (prompt variants, ranking weights) to measure what
  actually drives confident shortlists.
