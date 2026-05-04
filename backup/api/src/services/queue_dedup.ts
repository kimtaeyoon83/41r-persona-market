/**
 * Queue dedup for /api/dev/autotest/trigger.
 *
 * Two layers of "don't run this":
 *   1. Already covered in DB — a (testerAddr, mode) report exists for this
 *      test. The route's existing logic catches this via the `covered` set.
 *   2. Same-batch duplicate — matchPersonas can return 2 personas (different
 *      ids) sharing one testerAddr. The unique constraint
 *      (testerAddr, testId, isPersonaTest, sourceMode) on test_reports lets
 *      the first insert succeed and rejects the second — which means the
 *      second persona did a full stagehand+scoring pass for nothing.
 *      Pre-route filtering keeps that compute from being spent.
 */

export interface QueueableJob {
  personaId: string;
  testerAddr: string;
  mode: string;
}

export interface SelectQueueableJobsResult {
  queue: QueueableJob[];
  /** Count of (match, mode) pairs filtered out by either DB-cover or
   *  in-batch dedup. The route's response surfaces this as
   *  `skipped_existing` so callers can tell their request was partially
   *  noop'd. */
  skipped: number;
}

/**
 * Filter `matches × modes` into the queue that should actually run.
 * Pure: no I/O, no side-effects. The caller is responsible for the
 * `alreadyCovered` set (typically built from a `select … where testId
 * = ?` query against test_reports).
 */
export function selectQueueableJobs(
  matches: Array<{ persona: { id: string; testerAddr: string } }>,
  modes: string[],
  alreadyCovered: Set<string>,
): SelectQueueableJobsResult {
  const queue: QueueableJob[] = [];
  const queuedKeys = new Set<string>();
  let skipped = 0;
  for (const m of matches) {
    for (const mode of modes) {
      const key = `${m.persona.testerAddr}::${mode}`;
      if (alreadyCovered.has(key) || queuedKeys.has(key)) {
        skipped += 1;
        continue;
      }
      queuedKeys.add(key);
      queue.push({
        personaId: m.persona.id,
        testerAddr: m.persona.testerAddr,
        mode,
      });
    }
  }
  return { queue, skipped };
}
