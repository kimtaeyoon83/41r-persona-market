#!/usr/bin/env npx tsx
/**
 * Roll up the JSONL written by ``usage_logger.py`` and
 * ``anthropic_client.ts``. Answers the three questions that actually
 * matter when you're trying to cut LLM spend:
 *
 *   1. Where did the tokens go?  → total cost by model/service/route
 *   2. What are the heaviest single calls?  → top-N by output_tokens
 *   3. Are we calling the same prompt over and over?  → prompt_hash groups
 *
 * Prices are approximate and environment-overridable. Defaults reflect
 * public Anthropic pricing as of 2026-04:
 *   sonnet-4-6: $3 / $15 per 1M tokens (input / output)
 *   opus-4-6:   $15 / $75
 *   haiku-4-5:  $0.80 / $4
 *
 * Usage:
 *   pnpm tsx scripts/usage-summary.ts                # full report
 *   USAGE_LOG_PATH=/custom/path pnpm tsx ...         # override location
 *   pnpm tsx scripts/usage-summary.ts --since 2h     # last 2 hours only
 *   pnpm tsx scripts/usage-summary.ts --duplicates   # duplicate-calls view only
 *   pnpm tsx scripts/usage-summary.ts --heaviest 20  # top 20 heaviest calls
 */
import fs from 'node:fs';
import path from 'node:path';

interface Entry {
  ts: number;
  service: string;
  route: string;
  request_id: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  duration_ms: number;
  prompt_hash: string;
  prompt_preview: string;
}

interface ModelPricing {
  input: number;   // USD per 1M tokens
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Fallbacks — unrecognised model names get "sonnet-ish" cost so
  // estimates err on the conservative side.
  default:             { input: 3.0,  output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-opus-4-7':   { input: 15.0, output: 75.0, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-opus-4-6':   { input: 15.0, output: 75.0, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3.0,  output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3.0,  output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-haiku-4-5':  { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
};

function priceOf(model: string | null): ModelPricing {
  if (!model) return PRICING.default;
  return PRICING[model] ?? PRICING.default;
}

function estimateCostCents(e: Entry): number {
  const p = priceOf(e.model);
  return (
    (e.input_tokens         * p.input      +
     e.output_tokens        * p.output     +
     e.cache_read_tokens    * p.cacheRead  +
     e.cache_creation_tokens * p.cacheWrite) / 10_000 // /1M then *100 cents
  );
}

function loadEntries(logPath: string): Entry[] {
  if (!fs.existsSync(logPath)) {
    console.error(`[usage-summary] ${logPath} does not exist — run some LLM calls first`);
    return [];
  }
  const content = fs.readFileSync(logPath, 'utf-8').trim();
  if (!content) return [];
  const entries: Entry[] = [];
  for (const line of content.split('\n')) {
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      /* skip malformed lines */
    }
  }
  return entries;
}

function parseSince(arg: string | undefined): number | null {
  if (!arg) return null;
  const m = /^(\d+)([smhd])$/.exec(arg);
  if (!m) {
    console.error(`[usage-summary] --since expects formats like 30m, 2h, 1d — got ${arg}`);
    return null;
  }
  const mul = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Date.now() / 1000 - Number(m[1]) * mul;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function fmtCents(c: number): string {
  if (c < 1) return `${(c * 10).toFixed(2)}m¢`;          // milli-cents for sub-cent totals
  if (c < 100) return `${c.toFixed(2)}¢`;
  return `$${(c / 100).toFixed(2)}`;
}

function printByGroup(
  entries: Entry[],
  label: string,
  keyFn: (e: Entry) => string,
): void {
  const groups = new Map<string, { calls: number; in: number; out: number; cents: number }>();
  for (const e of entries) {
    const k = keyFn(e) || '—';
    const g = groups.get(k) ?? { calls: 0, in: 0, out: 0, cents: 0 };
    g.calls += 1;
    g.in += e.input_tokens + e.cache_read_tokens;
    g.out += e.output_tokens;
    g.cents += estimateCostCents(e);
    groups.set(k, g);
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].cents - a[1].cents);
  console.log(`\n── by ${label} ──────────────────────────────────`);
  console.log(`${pad(label, 32)}  calls   in_tok    out_tok   est.cost`);
  for (const [key, g] of rows) {
    console.log(
      `${pad(key.slice(0, 32), 32)}  ${pad(String(g.calls), 5)}  ${pad(String(g.in), 8)}  ${pad(String(g.out), 8)}  ${fmtCents(g.cents)}`,
    );
  }
}

function printHeaviest(entries: Entry[], n: number): void {
  const sorted = [...entries].sort((a, b) => estimateCostCents(b) - estimateCostCents(a)).slice(0, n);
  console.log(`\n── top ${n} heaviest calls ────────────────────────`);
  console.log(`${pad('#', 3)} ${pad('service/route', 32)} ${pad('model', 26)} in  out   est   preview`);
  sorted.forEach((e, i) => {
    const key = `${e.service}/${e.route}`;
    console.log(
      `${pad(String(i + 1), 3)} ${pad(key.slice(0, 32), 32)} ${pad((e.model ?? '').slice(0, 26), 26)} ${pad(String(e.input_tokens), 4)} ${pad(String(e.output_tokens), 5)} ${pad(fmtCents(estimateCostCents(e)), 7)} ${e.prompt_preview.slice(0, 50)}`,
    );
  });
}

function printDuplicates(entries: Entry[], minCalls: number = 2): void {
  const byHash = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byHash.get(e.prompt_hash) ?? [];
    arr.push(e);
    byHash.set(e.prompt_hash, arr);
  }
  const dupes = [...byHash.entries()]
    .filter(([, arr]) => arr.length >= minCalls)
    .sort((a, b) => {
      const costA = a[1].reduce((s, e) => s + estimateCostCents(e), 0);
      const costB = b[1].reduce((s, e) => s + estimateCostCents(e), 0);
      return costB - costA;
    });
  console.log(`\n── repeated prompts (hash appears ≥${minCalls}×) ──`);
  if (dupes.length === 0) {
    console.log('  (none — no prompt hash repeats)');
    return;
  }
  console.log(`${pad('hash', 18)} calls  total  model             route              preview`);
  for (const [hash, arr] of dupes.slice(0, 20)) {
    const total = arr.reduce((s, e) => s + estimateCostCents(e), 0);
    const first = arr[0];
    console.log(
      `${pad(hash, 18)} ${pad(String(arr.length), 5)}  ${pad(fmtCents(total), 6)} ${pad((first.model ?? '').slice(0, 17), 17)} ${pad((first.route ?? '').slice(0, 18), 18)} ${first.prompt_preview.slice(0, 50)}`,
    );
  }
}

function printByRequestId(entries: Entry[]): void {
  const groups = new Map<string, { calls: number; cents: number; routes: Set<string> }>();
  for (const e of entries) {
    if (!e.request_id) continue;
    const g = groups.get(e.request_id) ?? { calls: 0, cents: 0, routes: new Set() };
    g.calls += 1;
    g.cents += estimateCostCents(e);
    g.routes.add(e.route);
    groups.set(e.request_id, g);
  }
  if (groups.size === 0) {
    console.log('\n── by request_id ──────── (none tagged)');
    return;
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].cents - a[1].cents).slice(0, 10);
  console.log(`\n── top request_id (cost per /run etc.) ─────`);
  console.log(`${pad('request_id', 38)}  calls  est.cost  routes`);
  for (const [id, g] of rows) {
    console.log(
      `${pad(id.slice(0, 38), 38)}  ${pad(String(g.calls), 5)}  ${pad(fmtCents(g.cents), 8)}  ${[...g.routes].join(',')}`,
    );
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const valueOf = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const logPath = process.env.USAGE_LOG_PATH || '/tmp/llm-usage.jsonl';
  console.log(`[usage-summary] reading ${logPath}`);
  const all = loadEntries(logPath);

  const since = parseSince(valueOf('--since'));
  const entries = since == null ? all : all.filter((e) => e.ts >= since);
  console.log(`[usage-summary] ${entries.length} entries${since ? ` (since ${valueOf('--since')})` : ''} of ${all.length} total`);

  if (entries.length === 0) return;

  const totalIn = entries.reduce((s, e) => s + e.input_tokens + e.cache_read_tokens, 0);
  const totalOut = entries.reduce((s, e) => s + e.output_tokens, 0);
  const totalCents = entries.reduce((s, e) => s + estimateCostCents(e), 0);
  const avgDurMs = entries.reduce((s, e) => s + e.duration_ms, 0) / entries.length;

  console.log('\n── headline ──────────────────────────────────');
  console.log(`calls     : ${entries.length}`);
  console.log(`input tok : ${totalIn}`);
  console.log(`output tok: ${totalOut}`);
  console.log(`est. cost : ${fmtCents(totalCents)} (USD; Anthropic console is source of truth)`);
  console.log(`avg latency: ${avgDurMs.toFixed(0)}ms`);

  const heaviestN = Number(valueOf('--heaviest') ?? '10');

  if (has('--duplicates')) {
    printDuplicates(entries, Number(valueOf('--min-calls') ?? '2'));
    return;
  }

  printByGroup(entries, 'model', (e) => e.model ?? '—');
  printByGroup(entries, 'service', (e) => e.service);
  printByGroup(entries, 'route', (e) => e.route);
  printByRequestId(entries);
  printHeaviest(entries, heaviestN);
  printDuplicates(entries, Number(valueOf('--min-calls') ?? '2'));
}

main();

// Silences "unused path" in an IDE — path is ambient for future env use.
void path;
