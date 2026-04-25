import { describe, it, expect } from 'vitest';
import { raceWithTimeout, TimeoutError } from '../services/stagehand_hybrid.js';

// Locks in the contract for the helper now used by the autotest scoring
// chain (3 LLM calls × 90s each). Cheap to run (≤100ms total).

describe('raceWithTimeout', () => {
  it('resolves with the inner promise when it finishes in time', async () => {
    const fast = new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 10));
    const out = await raceWithTimeout(fast, 200, 'fast');
    expect(out).toBe('ok');
  });

  it('rejects with TimeoutError when the inner promise exceeds the deadline', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 200));
    await expect(raceWithTimeout(slow, 30, 'slow')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('TimeoutError carries the label so RCA can identify which step failed', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('x'), 200));
    try {
      await raceWithTimeout(slow, 20, 'scoreChecklist(abcd1234)');
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as Error).message).toContain('scoreChecklist(abcd1234)');
      expect((err as Error).message).toContain('20ms');
    }
  });

  it('propagates a thrown error from the inner promise unchanged', async () => {
    const failing = Promise.reject(new Error('inner blew up'));
    await expect(raceWithTimeout(failing, 200, 'inner')).rejects.toThrow('inner blew up');
  });
});
