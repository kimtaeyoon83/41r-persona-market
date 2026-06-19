#!/usr/bin/env npx tsx
/**
 * Behavior-sim calibration runner (Mode C gate verdict).
 *
 * Reads collected human think-aloud sessions + the simulator's per-subject
 * predictions, scores agreement (calibration.ts), and prints the gate
 * verdict. This is the step that decides whether Mode C may proceed.
 *
 *   human sessions:   spike/think-aloud/<subject>.json   (think-aloud.ts CLI)
 *   sim predictions:  spike/think-aloud/_sim.json        (SimPrediction[])
 *                     — produced by running state.ts over the same graph
 *                       per persona (run.ts adapter; not yet wired).
 *
 * Usage:
 *   pnpm tsx scripts/spike-behavior-sim/calibrate.ts [--gate=0.7]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  calibrate,
  type SimPrediction,
} from '../../apps/api/src/services/behavior_sim/calibration.js';
import {
  validateSession,
  type ThinkAloudSession,
} from '../../apps/api/src/services/behavior_sim/think_aloud.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(repoRoot, 'spike', 'think-aloud');
const gateArg = process.argv.find((a) => a.startsWith('--gate='));
const gateThreshold = gateArg ? Number(gateArg.split('=')[1]) : 0.7;

function main(): void {
  if (!existsSync(dir)) {
    console.error(`No data dir ${dir} — run the think-aloud CLI first.`);
    process.exitCode = 1;
    return;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== '_sim.json');
  const humans: ThinkAloudSession[] = [];
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ThinkAloudSession;
    const issues = validateSession(s);
    if (issues.length) {
      console.warn(`⚠️  ${f}: ${issues.length} validation issue(s) — skipped`);
      continue;
    }
    humans.push(s);
  }
  console.log(`human sessions: ${humans.length} (${humans.map((h) => h.subjectId).join(', ') || 'none'})`);

  const simPath = join(dir, '_sim.json');
  if (!existsSync(simPath)) {
    console.log(`\nNo sim predictions at ${simPath}.`);
    console.log('Produce SimPrediction[] by running the simulator over the same');
    console.log('graph per persona, then re-run. (Calibration needs both sides.)');
    return;
  }
  const sims = JSON.parse(readFileSync(simPath, 'utf8')) as SimPrediction[];

  const r = calibrate(humans, sims, { gateThreshold });
  console.log('\n── calibration ──');
  console.log(`  paired:            ${r.nPaired}`);
  console.log(`  outcome agreement: ${(r.outcomeAgreement * 100).toFixed(0)}%  (gate ≥ ${(gateThreshold * 100).toFixed(0)}%)`);
  console.log(`  reason agreement:  ${r.leaveReasonAgreement == null ? '—' : (r.leaveReasonAgreement * 100).toFixed(0) + '%'}`);
  console.log(`  path agreement:    ${r.pathAgreement == null ? '—' : (r.pathAgreement * 100).toFixed(0) + '%'}`);
  for (const p of r.perSubject) {
    console.log(`    ${p.subjectId}: outcome=${p.outcomeMatch ? '✓' : '✗'} reason=${p.reasonMatch == null ? '—' : p.reasonMatch ? '✓' : '✗'} path=${p.pathMatch == null ? '—' : (p.pathMatch * 100).toFixed(0) + '%'}`);
  }
  console.log(`\n  GATE: ${r.passesGate ? '✅ PASSES — Mode C may proceed' : '⛔ does not pass — recalibrate before Mode C'}`);
}

main();
