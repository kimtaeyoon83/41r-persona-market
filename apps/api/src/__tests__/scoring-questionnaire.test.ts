import { describe, it, expect } from 'vitest';
import {
  answerQuestionnaire,
  _internal,
} from '../services/scoring/questionnaire.js';

// Port of apps/persona-engine/tests/test_questionnaire_generator.py
// for offline paths (useLlm=false) and coerce invariants.

describe('answerQuestionnaire (offline)', () => {
  it('empty questionnaire returns empty', async () => {
    const out = await answerQuestionnaire({
      questionnaire: [],
      sessionLog: { outcome: 'task_complete' },
      soulText: '',
      useLlm: false,
    });
    expect(out).toEqual([]);
  });

  it('fallback gives neutral ratings + empty free_text', async () => {
    const out = await answerQuestionnaire({
      questionnaire: [
        { id: 'q1', question: '?', type: 'rating_1_5' },
        { id: 'q2', question: '?', type: 'rating_1_10' },
        { id: 'q3', question: '?', type: 'free_text' },
      ],
      sessionLog: { outcome: 'task_complete' },
      soulText: 'dummy',
      useLlm: false,
    });
    expect(out[0].answer).toBe(3);
    expect(out[1].answer).toBe(5);
    expect(out[2].answer).toBe('');
  });

  it('unknown type coerces to free_text', async () => {
    const out = await answerQuestionnaire({
      questionnaire: [{ id: 'q1', question: '?', type: 'bogus' as unknown as 'free_text' }],
      sessionLog: {},
      soulText: '',
      useLlm: false,
    });
    expect(out[0].answer).toBe('');
  });

  it('dict input accepted', async () => {
    const out = await answerQuestionnaire({
      questionnaire: [
        { id: 'q1', question: 'how?', type: 'rating_1_5' } as Record<string, unknown>,
      ],
      sessionLog: {},
      soulText: '',
      useLlm: false,
    });
    expect(out[0].id).toBe('q1');
    expect(out[0].answer).toBe(3);
  });
});

describe('coerce helper', () => {
  const { coerce } = _internal;

  it('clamps rating_1_5', () => {
    expect(coerce('rating_1_5', 0)).toBe(1);
    expect(coerce('rating_1_5', 6)).toBe(5);
    expect(coerce('rating_1_5', 3)).toBe(3);
    expect(coerce('rating_1_5', 'not a number')).toBe(3); // default
  });

  it('clamps rating_1_10', () => {
    expect(coerce('rating_1_10', -5)).toBe(1);
    expect(coerce('rating_1_10', 99)).toBe(10);
    expect(coerce('rating_1_10', 7)).toBe(7);
  });

  it('free_text returns string', () => {
    expect(coerce('free_text', 'hello')).toBe('hello');
    expect(coerce('free_text', 42)).toBe('42');
    expect(coerce('free_text', null)).toBe('');
  });

  it('string numeric accepted for ratings', () => {
    expect(coerce('rating_1_5', '4')).toBe(4);
    expect(coerce('rating_1_10', '8')).toBe(8);
  });

  it('truncates decimal to int', () => {
    expect(coerce('rating_1_5', 3.7)).toBe(3);
  });
});
