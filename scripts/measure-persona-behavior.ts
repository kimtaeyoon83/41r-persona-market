/**
 * Vector → Behavior measurement harness.
 *
 * Generates the empirical numbers cited in ARCHITECTURE.md Appendix D:
 *   (a) Vector cosine distance vs persona_actions Jaccard overlap (50 pairs)
 *   (b) Self-Jaccard for re-running the same persona N times
 *   (c) Focus area determinism (covered by unit test;
 *       persona-actions-focus-areas.test.ts asserts via 100x re-run)
 *
 * Cost: ~50-60 Haiku calls per full run ≈ $0.05, ~1 min wall-clock.
 *
 * Usage:
 *   pnpm tsx scripts/measure-persona-behavior.ts [--pairs N] [--self-runs M] [--out PATH]
 *   pnpm tsx scripts/measure-persona-behavior.ts --pairs 50 --self-runs 10
 *
 * Output: stdout summary + optional JSONL at --out path.
 *
 * Methodology guarantees (vs fabricated numbers):
 *   - Synthetic personas constructed from real PersonaVector schema
 *   - Calls services/llm.ts:generatePersonaActions directly (real Haiku)
 *   - Jaccard computed on action.id-stripped action strings (id is per-call random)
 *   - Cosine distance computed on flattened named-dimension vector
 */
import 'dotenv/config';
import fs from 'node:fs';
import { generatePersonaActions } from '../apps/api/src/services/llm.js';
import type { PersonaVector } from '@41rpm/shared';

// ─── CLI args ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const NUM_PAIRS = Number(flag('pairs', '50'));
const SELF_RUNS = Number(flag('self-runs', '10'));
const OUT_PATH = flag('out', '');
const TARGET_URL = flag('url', 'https://jup.ag');
const TASK = flag('task', 'Evaluate the swap interface UX');

// ─── Vector synthesis (50 distinct personas) ────────────────────────

function rand(seed: number): () => number {
  // mulberry32 — seeded PRNG so the experiment is reproducible
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeVector(rng: () => number): PersonaVector {
  const r = () => Number(rng().toFixed(2));
  const ageGroups = ['teen', 'young_adult', 'adult', 'senior'] as const;
  const visualStyles = ['minimal', 'rich', 'playful', 'professional'] as const;
  return {
    test_style: { thoroughness: r(), speed: r(), ux_focus: r(), bug_detection: r(), creativity: r() },
    expertise: { defi: r(), nft: r(), gaming: r(), ai_tools: r(), general_web: r() },
    feedback_pattern: { ui_critical: r(), security_aware: r(), performance_sensitive: r(), accessibility_focus: r(), detail_oriented: r() },
    reliability: { quality_score: r(), consistency: r(), response_rate: r() },
    demographics: {
      age_group: ageGroups[Math.floor(rng() * ageGroups.length)],
      tech_literacy: r(), crypto_experience: r(),
      design_sensitivity: r(), patience_level: r(),
    },
    ux_preferences: {
      visual_style: visualStyles[Math.floor(rng() * visualStyles.length)],
      mobile_first: rng() > 0.5,
      font_size_preference: r(), information_density: r(),
      animation_tolerance: r(), color_contrast_need: r(),
    },
    voice_sample: `synthetic persona seed=${rng().toFixed(4)}`,
  };
}

// ─── Vector flattening for cosine distance ───────────────────────────

function flatten(v: PersonaVector): number[] {
  const flat: number[] = [];
  for (const k of Object.keys(v.test_style) as Array<keyof typeof v.test_style>) flat.push(v.test_style[k]);
  for (const k of Object.keys(v.expertise) as Array<keyof typeof v.expertise>) flat.push(v.expertise[k]);
  for (const k of Object.keys(v.feedback_pattern) as Array<keyof typeof v.feedback_pattern>) flat.push(v.feedback_pattern[k]);
  for (const k of Object.keys(v.reliability) as Array<keyof typeof v.reliability>) flat.push(v.reliability[k]);
  if (v.demographics) {
    flat.push(v.demographics.tech_literacy, v.demographics.crypto_experience, v.demographics.design_sensitivity, v.demographics.patience_level);
  }
  if (v.ux_preferences) {
    flat.push(v.ux_preferences.font_size_preference, v.ux_preferences.information_density, v.ux_preferences.animation_tolerance, v.ux_preferences.color_contrast_need);
  }
  return flat;
}

function cosineDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── Action set Jaccard (id-stripped, content-based) ────────────────

function actionContent(a: { action: string; reason?: string }): string {
  // Strip id so re-runs of same persona are comparable. action+reason is
  // the semantic payload; small phrasing drift is tolerated by tokenizing.
  return a.action.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 10).join(' ');
}

function jaccard(setA: Set<string>, setB: Set<string>): number {
  const inter = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

// ─── Logging ────────────────────────────────────────────────────────

const records: unknown[] = [];
function record(rec: unknown): void {
  records.push(rec);
  if (OUT_PATH) fs.appendFileSync(OUT_PATH, JSON.stringify(rec) + '\n');
}

// ─── Experiment (a): pairwise distance vs Jaccard ───────────────────

async function experimentA(): Promise<void> {
  console.log(`[exp-A] generating ${NUM_PAIRS} persona pairs...`);
  const rng = rand(42);
  const personas: PersonaVector[] = Array.from({ length: NUM_PAIRS * 2 }, () => makeVector(rng));

  const actionSets: Array<Set<string>> = [];
  for (let i = 0; i < personas.length; i++) {
    process.stdout.write(`\r[exp-A] generatePersonaActions ${i + 1}/${personas.length}`);
    const actions = await generatePersonaActions(personas[i], TARGET_URL, [], [], [], TASK);
    actionSets.push(new Set(actions.map(actionContent)));
  }
  console.log('');

  const samples: Array<{ distance: number; overlap: number }> = [];
  for (let i = 0; i < NUM_PAIRS; i++) {
    const a = personas[i * 2];
    const b = personas[i * 2 + 1];
    const distance = cosineDistance(flatten(a), flatten(b));
    const overlap = jaccard(actionSets[i * 2], actionSets[i * 2 + 1]);
    samples.push({ distance, overlap });
    record({ exp: 'a', pair: i, distance, overlap });
  }

  // Bucketed summary
  const near = samples.filter((s) => s.distance < 0.3);
  const mid = samples.filter((s) => s.distance >= 0.3 && s.distance < 0.6);
  const far = samples.filter((s) => s.distance >= 0.6);
  const avg = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;

  console.log('\n[exp-A] Vector distance vs action Jaccard overlap:');
  console.log(`  distance < 0.3 : avg overlap ${avg(near.map((s) => s.overlap)).toFixed(3)} (n=${near.length})`);
  console.log(`  0.3 ≤ d < 0.6  : avg overlap ${avg(mid.map((s) => s.overlap)).toFixed(3)} (n=${mid.length})`);
  console.log(`  distance ≥ 0.6 : avg overlap ${avg(far.map((s) => s.overlap)).toFixed(3)} (n=${far.length})`);
  console.log('  Hypothesis: nearer vectors → higher overlap (monotonic decrease)');
}

// ─── Experiment (b): self-Jaccard reproducibility ───────────────────

async function experimentB(): Promise<void> {
  console.log(`\n[exp-B] re-running same persona ${SELF_RUNS} times...`);
  const rng = rand(99);
  const persona = makeVector(rng);

  const sets: Array<Set<string>> = [];
  for (let i = 0; i < SELF_RUNS; i++) {
    process.stdout.write(`\r[exp-B] generatePersonaActions ${i + 1}/${SELF_RUNS}`);
    const actions = await generatePersonaActions(persona, TARGET_URL, [], [], [], TASK);
    sets.push(new Set(actions.map(actionContent)));
  }
  console.log('');

  let total = 0, count = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const j_ = jaccard(sets[i], sets[j]);
      total += j_; count += 1;
      record({ exp: 'b', i, j, jaccard: j_ });
    }
  }
  console.log(`\n[exp-B] Same persona, ${SELF_RUNS} runs:`);
  console.log(`  Pairwise self-Jaccard avg: ${(total / count).toFixed(3)} (${count} pairs)`);
  console.log('  Interpretation: high → axes stable, content varied by LLM');
  console.log('                  low → vector signal weak / LLM dominates');
}

// ─── Main ───────────────────────────────────────────────────────────

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY required. Set it in .env or env var.');
    process.exit(1);
  }
  if (OUT_PATH) {
    fs.writeFileSync(OUT_PATH, ''); // truncate
    console.log(`[output] writing JSONL to ${OUT_PATH}`);
  }
  console.log(`[config] pairs=${NUM_PAIRS} self-runs=${SELF_RUNS} url=${TARGET_URL}`);
  console.log(`[config] estimated cost: ~$${((NUM_PAIRS * 2 + SELF_RUNS) * 0.001).toFixed(3)}`);

  const start = Date.now();
  await experimentA();
  await experimentB();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n[done] elapsed ${elapsed}s, ${records.length} records`);
  if (OUT_PATH) console.log(`       JSONL → ${OUT_PATH}`);
})();
