#!/usr/bin/env npx tsx
/**
 * Spike Phase 2 — mini behavior simulation over the captured graph.
 *
 * Part of docs/41rpm_behavior_sim_spike_v0.md §4. NOT the engine —
 * a deliberately small loop to test H1/H2/H3 before any real build.
 *
 * 3 archetypes × 10 trait perturbations = 30 sessions, max 8 steps.
 * Each step: Haiku vision sees the current node's top-crop screenshot
 * + verbatim edge labels, returns one JSON action. Dual leave record:
 * the LLM may choose to leave on its own (llm_wanted_leave) AND a
 * crude heuristic gate runs in parallel (gate_fired) — which one ends
 * the session is recorded so the spike measures whether LLMs leave
 * unprompted (spec v1 principle 4's empirical basis).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... pnpm tsx scripts/spike-behavior-sim/run.ts
 *   (or rely on root .env via dotenv)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { client, withRoute } from '../../apps/api/src/services/anthropic_client.js';
import { parseJsonSafe, SCORING_MODELS } from '../../apps/api/src/services/llm.js';
import {
  BehaviorTraits,
  initState,
  leaveGate,
  updateState,
} from '../../apps/api/src/services/behavior_sim/state.js';

// argv[2] = graph.json path (default: NHIS run at spike/graph.json)
// flags: --start=<nodeId>  start sessions at a given node (A1 unit test)
//        --n=<count>       limit total sessions (round-robin archetypes)
//        --suffix=<s>      write to sessions.<s>.jsonl instead
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const GRAPH_PATH = positional[0]
  ? path.resolve(positional[0])
  : path.join(process.cwd(), 'spike', 'graph.json');
const START_NODE = flag('start') ?? 'home';
const SESSION_LIMIT = flag('n') ? Number(flag('n')) : null;
const OUT_PATH = path.join(
  path.dirname(GRAPH_PATH),
  flag('suffix') ? `sessions.${flag('suffix')}.jsonl` : 'sessions.jsonl',
);

const MAX_STEPS = 8;
const PERTURBATIONS = 10;
const PERTURB_RANGE = 0.15;
const CONCURRENCY = 5;
// Leave decisions are owned by the internal-state engine
// (apps/api/src/services/behavior_sim/state.ts) as of v5 — the crude
// in-script gates from v2-v4 are retired. The LLM may still choose
// to leave on its own (dual record preserved).
const FRICTION_SEVERITY = 0.7; // crude constant until Ch1 normalization lands

// v7 — Ch1-led relevance (spec §4.2 "Ch1 휴리스틱 + Ch2"). v5/v6
// showed pure LLM self-report can't tell "saw clues" from "found the
// thing" (false-satisfied: gate cut sessions whose last thought was
// still hunting). Attainment is now a CODE fact — what kind of screen
// you reached — and the LLM only judges content-need match.
//   relevance_effective = ch1Factor(screen type) × ch2(need match)
function ch1RelevanceFactor(node: GraphNode): number {
  if (node.login_wall) return 0;
  // detail pages carry concrete attainable info (price, options, photos)
  if (node.id.startsWith('py_') || node.id.startsWith('product_')) return 1.0;
  // listings/menus can only yield clues. v1 crawler should emit an
  // explicit node_type instead of this id-prefix heuristic.
  return 0.25;
}

interface Traits {
  patience: number;
  reading_tolerance: number;
  exploration: number;
}

const ARCHETYPES: { id: string; traits: Traits }[] = [
  { id: 'impatient_scanner', traits: { patience: 0.2, reading_tolerance: 0.2, exploration: 0.5 } },
  { id: 'patient_reader', traits: { patience: 0.8, reading_tolerance: 0.8, exploration: 0.4 } },
  { id: 'mid_pragmatic', traits: { patience: 0.5, reading_tolerance: 0.4, exploration: 0.7 } },
];

// Deterministic PRNG so perturbations are reproducible across runs.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function perturb(traits: Traits, rand: () => number): Traits {
  const p = (v: number) => Math.min(0.95, Math.max(0.05, v * (1 + (rand() * 2 - 1) * PERTURB_RANGE)));
  return {
    patience: p(traits.patience),
    reading_tolerance: p(traits.reading_tolerance),
    exploration: p(traits.exploration),
  };
}

interface GraphNode {
  id: string;
  label: string;
  login_wall?: boolean;
  screenshot_top: string;
  signals?: { visible_word_count: number };
  edges: { label: string; to: string; y?: number | null }[];
}

// B1 — partial perception. A visitor who doesn't scroll only sees
// above-the-fold links; how far they scan scales with patience.
// Edges without y (older graphs, hidden-nav anchors) stay visible.
// Fallback to the full list when filtering leaves <2 options so no
// session dead-ends on perception alone.
function attentionDepth(traits: Traits): number {
  if (traits.patience < 0.35) return 1200;
  if (traits.patience < 0.65) return 1800;
  return 2400; // matches the top-crop screenshot height
}

function perceiveEdges(node: GraphNode, traits: Traits) {
  const depth = attentionDepth(traits);
  const visible = node.edges.filter((e) => e.y == null || e.y <= depth);
  return visible.length >= 2 ? visible : node.edges;
}

function posTag(y: number | null | undefined): string {
  if (y == null) return '';
  if (y < 300) return ' (상단 메뉴)';
  if (y < 900) return ' (첫 화면)';
  return ' (스크롤 아래)';
}

interface StepAction {
  action: 'move' | 'back' | 'leave';
  edge_label?: string;
  leave_mode?: 'satisfied' | 'frustrated' | 'indifferent';
  friction_category?: 'navigation' | 'comprehension' | 'trust' | 'content_mismatch' | null;
  friction_note?: string | null;
  relevance?: number; // Ch2 value signal — feeds value_realized
  thought?: string;
}

const imageCache = new Map<string, string>();
function imageB64(relPath: string): string {
  let b64 = imageCache.get(relPath);
  if (!b64) {
    b64 = fs.readFileSync(path.join(process.cwd(), relPath)).toString('base64');
    imageCache.set(relPath, b64);
  }
  return b64;
}

function buildPrompt(
  need: string,
  traits: Traits,
  node: GraphNode,
  edges: GraphNode['edges'],
  canGoBack: boolean,
  lastAction: string | null,
  correction: string | null,
  visitedTrail: string[],
) {
  const edgeLines = edges.map((e) => `- "${e.label}"${posTag(e.y)}`).join('\n');
  const backLine = canGoBack ? '\n- "(뒤로가기)"' : '';
  const system = [
    '당신은 웹사이트를 둘러보는 한 명의 실제 방문자입니다.',
    '',
    '당신의 성향 (0=매우 낮음, 1=매우 높음):',
    `- 참을성: ${traits.patience.toFixed(2)}`,
    `- 긴 글을 읽으려는 성향: ${traits.reading_tolerance.toFixed(2)}`,
    `- 이것저것 눌러보는 탐색 성향: ${traits.exploration.toFixed(2)}`,
    '',
    `방문 맥락: ${need}`,
    '',
    '당신은 궁금해서 들어왔을 뿐, 반드시 무언가를 완수해야 하는 것은 아닙니다.',
    '흥미가 없거나 답답하면 언제든 떠나도 됩니다. 화면을 보고 실제 사람처럼 자연스럽게 다음 행동 하나를 정하세요.',
    '',
    '반드시 아래 JSON만 출력:',
    '{"action":"move"|"back"|"leave", "edge_label":"이동할 메뉴 텍스트 그대로(move일 때)", "leave_mode":"satisfied"|"frustrated"|"indifferent"(leave일 때), "friction_category":"navigation"|"comprehension"|"trust"|"content_mismatch"|null, "friction_note":"이 화면에서 거슬리거나 불편했던 점 한 문장(없으면 null)", "relevance": 0~1 숫자 — 지금 이 화면에 보이는 내용이 당신의 방문 목적과 관련된 정도. 0=전혀 무관, 0.5=부분적으로 관련, 1.0=정확히 찾던 종류의 내용. 화면 유형(목록/상세)은 따지지 말고 내용의 일치도만, "thought":"지금 드는 생각 한 문장"}',
  ].join('\n');

  // Text trace summary (spec §2.2 history cap: last 1 step + trail
  // summary). Without this the persona forgets it already hit a wall
  // and perseverates on the same menu — v1 run artifact.
  const trail = visitedTrail.length > 1 ? `지금까지 본 화면 순서: ${visitedTrail.join(' → ')}` : '';

  const userText = [
    `현재 화면: ${node.label}`,
    '',
    '이동 가능한 메뉴 (화면에 보이는 텍스트 그대로):',
    edgeLines + backLine,
    '',
    trail,
    lastAction ? `직전 행동: ${lastAction}` : '방금 이 사이트에 도착했습니다.',
    correction ? `\n주의: ${correction}` : '',
    '',
    'JSON으로만 답하세요.',
  ].join('\n');

  return { system, userText };
}

async function llmStep(
  need: string,
  traits: Traits,
  node: GraphNode,
  edges: GraphNode['edges'],
  canGoBack: boolean,
  lastAction: string | null,
  correction: string | null,
  visitedTrail: string[],
): Promise<StepAction> {
  const { system, userText } = buildPrompt(need, traits, node, edges, canGoBack, lastAction, correction, visitedTrail);
  const res = await withRoute('spike.behavior_sim', () =>
    client.messages.create({
      model: SCORING_MODELS.haiku,
      max_tokens: 300,
      system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: imageB64(node.screenshot_top) },
            },
            { type: 'text', text: userText },
          ],
        },
      ],
    }),
  );
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  return parseJsonSafe<StepAction>(text);
}

async function runSession(
  graph: { need: string; nodes: GraphNode[] },
  sessionId: string,
  archetypeId: string,
  traits: Traits,
): Promise<object> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let current = byId.get(START_NODE)!;
  if (!current) throw new Error(`start node not found: ${START_NODE}`);
  const stack: string[] = [];
  const pathTaken = [current.id];
  const steps: object[] = [];
  const btraits: BehaviorTraits = { ...traits };
  let state = initState(btraits);
  let lastAction: string | null = null;
  let leave: { step: number; mode: string; source: string; reason?: string } | null = null;
  const visitedTrail = [current.label];
  const visitCount = new Map<string, number>([[current.id, 1]]);

  for (let step = 1; step <= MAX_STEPS; step++) {
    const noveltyNow = (visitCount.get(current.id) ?? 0) <= 1 ? 1 : 0;
    const visibleEdges = perceiveEdges(current, traits);
    let act: StepAction;
    try {
      act = await llmStep(graph.need, traits, current, visibleEdges, stack.length > 0, lastAction, null, visitedTrail);
    } catch (err) {
      steps.push({ step, node: current.id, error: (err as Error).message });
      break;
    }

    // LLM judges content-need match (Ch2); screen-type attainment is a
    // code fact (Ch1); the engine owns the feelings.
    const ch2 = typeof act.relevance === 'number' ? Math.max(0, Math.min(1, act.relevance)) : 0;
    const relevance = ch1RelevanceFactor(current) * ch2;
    state = updateState(
      state,
      {
        frictions: act.friction_note
          ? [
              {
                category: (act.friction_category ?? 'comprehension') as
                  | 'navigation'
                  | 'comprehension'
                  | 'trust'
                  | 'content_mismatch',
                severity: FRICTION_SEVERITY,
              },
            ]
          : [],
        novelty: noveltyNow,
        relevance,
      },
      btraits,
    );
    const gate = leaveGate(state, btraits, undefined, () => 1); // rng=1 → distracted off in spike
    const llmWantedLeave = act.action === 'leave';

    steps.push({
      step,
      node: current.id,
      action: act.action,
      edge_label: act.edge_label ?? null,
      friction_category: act.friction_category ?? null,
      friction_note: act.friction_note ?? null,
      ch2_relevance: ch2,
      relevance,
      thought: act.thought ?? null,
      visible_edges: visibleEdges.length,
      llm_wanted_leave: llmWantedLeave,
      gate: gate.leave ? gate.mode : null,
      state: {
        frustration: Number(state.frustration.toFixed(3)),
        patience_remaining: Number(state.patience_remaining.toFixed(3)),
        value_realized: Number(state.value_realized.toFixed(3)),
        interest: Number(state.interest.toFixed(3)),
      },
    });

    if (llmWantedLeave) {
      leave = { step, mode: act.leave_mode ?? 'indifferent', source: 'llm' };
      break;
    }
    if (gate.leave) {
      leave = { step, mode: gate.mode, source: 'gate', reason: gate.reason };
      break;
    }

    // navigation
    if (act.action === 'back' && stack.length > 0) {
      current = byId.get(stack.pop()!)!;
      lastAction = '뒤로가기';
    } else if (act.action === 'move' && act.edge_label) {
      const want = act.edge_label.trim();
      let edge = visibleEdges.find((e) => e.label === want);
      if (!edge) edge = visibleEdges.find((e) => e.label.includes(want) || want.includes(e.label));
      if (edge) {
        stack.push(current.id);
        current = byId.get(edge.to)!;
        lastAction = `"${edge.label}" 클릭`;
      } else {
        // one corrective retry, then force back
        try {
          const retry = await llmStep(
            graph.need, traits, current, visibleEdges, stack.length > 0, lastAction,
            `"${want}" 라는 메뉴는 화면에 없습니다. 목록에 있는 텍스트 그대로 고르세요.`,
            visitedTrail,
          );
          const edge2 = retry.edge_label
            ? visibleEdges.find((e) => e.label === retry.edge_label!.trim())
            : undefined;
          if (retry.action === 'move' && edge2) {
            stack.push(current.id);
            current = byId.get(edge2.to)!;
            lastAction = `"${edge2.label}" 클릭`;
          } else if (stack.length > 0) {
            current = byId.get(stack.pop()!)!;
            lastAction = '뒤로가기';
          }
        } catch {
          if (stack.length > 0) {
            current = byId.get(stack.pop()!)!;
            lastAction = '뒤로가기';
          }
        }
      }
    } else if (stack.length > 0) {
      current = byId.get(stack.pop()!)!;
      lastAction = '뒤로가기';
    }
    pathTaken.push(current.id);
    visitedTrail.push(current.label);
    visitCount.set(current.id, (visitCount.get(current.id) ?? 0) + 1);
  }

  if (!leave) leave = { step: MAX_STEPS, mode: 'timeout', source: 'timeout' };

  return {
    session_id: sessionId,
    archetype: archetypeId,
    traits,
    path: pathTaken,
    steps,
    leave,
    state_final: state,
  };
}

async function main() {
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8')) as {
    need: string;
    nodes: GraphNode[];
  };
  const usable = graph.nodes.filter((n) => !(n as { capture_failed?: boolean }).capture_failed);
  console.log(`[run] graph: ${usable.length} nodes · need: ${graph.need.slice(0, 40)}…`);
  fs.writeFileSync(OUT_PATH, '');

  let jobs: { sessionId: string; archetypeId: string; traits: Traits }[] = [];
  // round-robin across archetypes so --n=9 still covers all three
  for (let i = 0; i < PERTURBATIONS; i++) {
    for (const arch of ARCHETYPES) {
      const rand = mulberry32(hashSeed(`${arch.id}_${i}`));
      jobs.push({
        sessionId: `${arch.id}_${String(i).padStart(2, '0')}`,
        archetypeId: arch.id,
        traits: perturb(arch.traits, rand),
      });
    }
  }
  if (SESSION_LIMIT) jobs = jobs.slice(0, SESSION_LIMIT);
  if (START_NODE !== 'home') console.log(`[run] start node override: ${START_NODE}`);

  const results: object[] = [];
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map((j) =>
        runSession({ need: graph.need, nodes: usable }, j.sessionId, j.archetypeId, j.traits).catch(
          (err) => ({ session_id: j.sessionId, archetype: j.archetypeId, fatal: (err as Error).message }),
        ),
      ),
    );
    for (const r of settled) {
      results.push(r);
      fs.appendFileSync(OUT_PATH, JSON.stringify(r) + '\n');
      const rr = r as { session_id: string; leave?: { step: number; mode: string; source: string }; path?: string[] };
      console.log(
        `  ${rr.session_id}: ${rr.leave ? `${rr.leave.mode}@${rr.leave.step} (${rr.leave.source})` : 'FATAL'} · path=${rr.path?.join('→') ?? '-'}`,
      );
    }
  }

  // quick distribution summary
  console.log('\n=== leave mode × archetype ===');
  for (const arch of ARCHETYPES) {
    const rs = results.filter((r) => (r as { archetype: string }).archetype === arch.id) as {
      leave?: { step: number; mode: string };
    }[];
    const modes: Record<string, number> = {};
    const stepsAt: number[] = [];
    for (const r of rs) {
      if (!r.leave) continue;
      modes[r.leave.mode] = (modes[r.leave.mode] ?? 0) + 1;
      stepsAt.push(r.leave.step);
    }
    stepsAt.sort((a, b) => a - b);
    const median = stepsAt.length ? stepsAt[Math.floor(stepsAt.length / 2)] : null;
    console.log(`${arch.id}: ${JSON.stringify(modes)} · median leave step=${median}`);
  }
  console.log(`\n[done] ${results.length} sessions → ${OUT_PATH}`);
}

main();
