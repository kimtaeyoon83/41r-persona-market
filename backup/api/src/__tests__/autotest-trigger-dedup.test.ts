import { describe, it, expect } from 'vitest';
import { selectQueueableJobs } from '../services/queue_dedup.js';

// Repros the bug seen on the example.com run today: matchPersonas
// returned 2 personas (different IDs) sharing the same testerAddr.
// Both got queued, both ran a full stagehand+scoring pass (~$0.10 each),
// but the second one's DB insert hit the unique constraint
// (testerAddr, testId, isPersonaTest, sourceMode) and threw — work
// thrown away. Dedup before queueing prevents the wasted run.

describe('selectQueueableJobs', () => {
  const m = (id: string, addr: string) => ({ persona: { id, testerAddr: addr } });

  it('queues every match when no overlap', () => {
    const out = selectQueueableJobs(
      [m('p1', 'wA'), m('p2', 'wB'), m('p3', 'wC')],
      ['stagehand_hybrid'],
      new Set(),
    );
    expect(out.queue).toHaveLength(3);
    expect(out.skipped).toBe(0);
  });

  it('dedupes same-testerAddr personas within the SAME batch', () => {
    // The actual jup.ag bug shape: 2 personas, same tester.
    const out = selectQueueableJobs(
      [m('p1', 'shared'), m('p2', 'shared'), m('p3', 'other')],
      ['stagehand_hybrid'],
      new Set(),
    );
    expect(out.queue).toHaveLength(2);
    expect(out.skipped).toBe(1);
    // First (p1) wins; p2 is the one that gets dropped.
    expect(out.queue.map((q) => q.personaId).sort()).toEqual(['p1', 'p3']);
  });

  it('skips matches whose (testerAddr,mode) is already covered in DB', () => {
    const out = selectQueueableJobs(
      [m('p1', 'wA'), m('p2', 'wB')],
      ['stagehand_hybrid'],
      new Set(['wA::stagehand_hybrid']),
    );
    expect(out.queue).toHaveLength(1);
    expect(out.queue[0].personaId).toBe('p2');
    expect(out.skipped).toBe(1);
  });

  it('treats different modes as separate slots (text vs stagehand_hybrid)', () => {
    const out = selectQueueableJobs(
      [m('p1', 'wA')],
      ['stagehand_hybrid', 'text'],
      new Set(['wA::stagehand_hybrid']),
    );
    // text mode for the same tester is still allowed — different sourceMode.
    expect(out.queue).toHaveLength(1);
    expect(out.queue[0].mode).toBe('text');
    expect(out.skipped).toBe(1);
  });

  it('combined: in-batch dedup + DB-covered skip', () => {
    const out = selectQueueableJobs(
      [m('p1', 'shared'), m('p2', 'shared'), m('p3', 'covered'), m('p4', 'fresh')],
      ['stagehand_hybrid'],
      new Set(['covered::stagehand_hybrid']),
    );
    expect(out.queue.map((q) => q.testerAddr).sort()).toEqual(['fresh', 'shared']);
    expect(out.skipped).toBe(2);
  });

  it('returns the queueable shape ({personaId, testerAddr, mode})', () => {
    const out = selectQueueableJobs([m('p1', 'wA')], ['text'], new Set());
    expect(out.queue[0]).toEqual({ personaId: 'p1', testerAddr: 'wA', mode: 'text' });
  });
});
