import { describe, it, expect } from 'vitest';
import { extractJson } from '../services/llm.js';

describe('extractJson', () => {
  it('extracts JSON from markdown code block', () => {
    const input = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
    expect(extractJson(input)).toBe('{"key": "value"}');
  });

  it('extracts JSON from code block without language tag', () => {
    const input = '```\n{"a": 1}\n```';
    expect(extractJson(input)).toBe('{"a": 1}');
  });

  it('extracts JSON object directly from text', () => {
    const input = 'Result: {"name": "test", "count": 42} end';
    expect(extractJson(input)).toBe('{"name": "test", "count": 42}');
  });

  it('handles nested JSON objects', () => {
    const input = '```json\n{"outer": {"inner": [1, 2, 3]}}\n```';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ outer: { inner: [1, 2, 3] } });
  });

  it('returns original text when no JSON found', () => {
    const input = 'no json here';
    expect(extractJson(input)).toBe('no json here');
  });

  it('handles multiline JSON in code block', () => {
    const input = '```json\n{\n  "checklist": [\n    {"id": "CL01", "task": "test"}\n  ]\n}\n```';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.checklist).toHaveLength(1);
    expect(parsed.checklist[0].id).toBe('CL01');
  });

  it('prefers code block over bare JSON', () => {
    const input = '{"before": true}\n```json\n{"correct": true}\n```\n{"after": true}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ correct: true });
  });

  it('handles JSON array in code block', () => {
    const input = '```json\n[{"id": "PA01"}, {"id": "PA02"}]\n```';
    const result = extractJson(input);
    // extractJson looks for { }, so array might not match - this tests the behavior
    // The function matches ```json ... ``` first, so it should work
    expect(result).toBe('[{"id": "PA01"}, {"id": "PA02"}]');
  });
});
