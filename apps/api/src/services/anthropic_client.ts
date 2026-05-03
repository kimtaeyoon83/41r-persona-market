/**
 * Wrapped Anthropic SDK client that logs every ``messages.create`` call
 * to the shared JSONL usage log (same file that persona-engine's
 * ``usage_logger.py`` writes to). Use ``withRoute`` / ``withRequestId``
 * to tag calls so ``scripts/usage-summary.ts`` can attribute tokens.
 *
 * Drop-in replacement for ``new Anthropic()``:
 *     import { client, withRoute } from './anthropic_client.js';
 *     await withRoute('quality_score', () => client.messages.create({ ... }));
 */
import Anthropic from '@anthropic-ai/sdk';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

interface LogContext {
  route: string;
  requestId: string | null;
}

const als = new AsyncLocalStorage<LogContext>();
const USAGE_LOG_PATH = env.USAGE_LOG_PATH;

// Ensure the directory exists once at startup.
try {
  fs.mkdirSync(path.dirname(USAGE_LOG_PATH), { recursive: true });
} catch {
  /* non-fatal */
}

function hashPrompt(messages: unknown, system: unknown): string {
  try {
    const payload = JSON.stringify({ messages, system });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  } catch {
    return 'unhashable';
  }
}

function previewPrompt(messages: unknown, system: unknown): string {
  try {
    const s = JSON.stringify({ messages, system });
    return s.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

function appendUsage(entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(USAGE_LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    /* non-fatal */
  }
}

export function withRoute<T>(route: string, fn: () => Promise<T> | T): Promise<T> | T {
  const parent = als.getStore();
  return als.run({ route, requestId: parent?.requestId ?? null }, fn);
}

export function withRequestId<T>(
  requestId: string | null,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const parent = als.getStore();
  return als.run({ route: parent?.route ?? 'unknown', requestId }, fn);
}

// Concatenate all text blocks from an Anthropic message. Non-text
// blocks (images, tool use, etc.) are skipped. Use this everywhere
// instead of inlining the filter+map+join pattern — it keeps the SDK
// type dependency (`Anthropic.TextBlock`) in one place.
export function extractTextContent(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// The wrapped client. Everything outside `services/llm.ts` that wants to
// call Anthropic should import from here.
export const client = new Anthropic();

// Patch `messages.create`. Anthropic SDK returns objects that carry a
// `usage` field in the non-streaming case — that's all we log for now.
// Streaming responses would need a different hook (we don't use them).
const originalCreate = client.messages.create.bind(client.messages);

(client.messages as unknown as { create: typeof originalCreate }).create = (async (
  params: Parameters<typeof originalCreate>[0],
  options?: Parameters<typeof originalCreate>[1],
) => {
  const start = Date.now();
  const resp = await originalCreate(params, options);

  try {
    const ctx = als.getStore();
    const usage = (resp as unknown as { usage?: {
      input_tokens?: number; output_tokens?: number;
      cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
    } }).usage ?? {};
    appendUsage({
      ts: Date.now() / 1000,
      service: 'api',
      route: ctx?.route ?? 'unknown',
      request_id: ctx?.requestId ?? null,
      model: (params as { model?: string }).model ?? null,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
      duration_ms: Date.now() - start,
      prompt_hash: hashPrompt(
        (params as { messages?: unknown }).messages,
        (params as { system?: unknown }).system,
      ),
      prompt_preview: previewPrompt(
        (params as { messages?: unknown }).messages,
        (params as { system?: unknown }).system,
      ),
    });
  } catch {
    /* never break the caller */
  }

  return resp;
}) as typeof originalCreate;
