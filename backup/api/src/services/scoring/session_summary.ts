/**
 * Compact text rendering of a SessionLog for LLM context prompts.
 *
 * Port of apps/persona-engine/adapters/checklist_adapter.py:_session_summary
 * — kept in a shared module because checklist, questionnaire, and
 * structured_report all embed the same summary in their user messages.
 * Keep the output format byte-stable so a single prompt change can't
 * drift the three scorers out of sync.
 */
import type { SessionLog, SessionTurn } from './types.js';

type SessionLogLike = Pick<SessionLog, 'mode' | 'outcome' | 'turns'> & {
  turns?: SessionTurn[];
};

function pick<T>(obj: unknown, key: string, fallback: T): T {
  if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    return (v ?? fallback) as T;
  }
  return fallback;
}

export function sessionSummary(sessionLog: SessionLogLike | Record<string, unknown>): string {
  const mode = pick<string>(sessionLog, 'mode', 'browser') || 'browser';
  const outcome = pick<string>(sessionLog, 'outcome', '') || '';
  const turns = pick<SessionTurn[]>(sessionLog, 'turns', []) || [];

  const lines: string[] = [
    `mode: ${mode}`,
    `outcome: ${outcome}`,
    `total_turns: ${turns.length}`,
    '',
  ];

  for (const t of turns) {
    if (!t || typeof t !== 'object') continue;
    const parts: string[] = [`turn ${t.turn}:`];

    if (t.tool && typeof t.tool === 'object') {
      const action = t.tool.tool;
      const target = t.tool.target || t.tool.selector;
      if (action) {
        parts.push(`action=${action}${target ? ` target=${target}` : ''}`);
      }
    }

    if (t.observation && typeof t.observation === 'object') {
      const summary = t.observation.summary;
      if (summary) {
        parts.push(`obs=${String(summary).slice(0, 160)}`);
      }
      const url = t.observation.url;
      if (url) parts.push(`url=${url}`);
    }

    if (t.decision && typeof t.decision === 'object') {
      if (t.decision.done) parts.push('done=True');
      if (t.decision.key_behaviors) parts.push(`key_behaviors=${t.decision.key_behaviors}`);
      if (t.decision.frustration_points) parts.push(`frustration=${t.decision.frustration_points}`);
    }

    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}

export const BLOCKING_OUTCOMES = new Set<string>([
  'error',
  'abandoned',
  'patience_exceeded',
]);
