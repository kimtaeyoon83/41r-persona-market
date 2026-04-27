/**
 * services/video.ts — JPEG sequence → webm transcode helper.
 *
 * Mocks node:child_process.spawn so tests stay hermetic (no real ffmpeg).
 * Tests cover:
 *   - ffmpeg missing → returns null gracefully
 *   - empty/missing frames dir → returns null
 *   - happy path → spawns ffmpeg with correct args, returns outPath
 *   - ffmpeg non-zero exit → throws with stderr tail
 *   - cleanup of source frames on success
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import {
  transcodeFramesToWebm,
  isFfmpegAvailable,
  _resetFfmpegCacheForTests,
} from '../services/video.js';

// ─── Mock spawn factory ──────────────────────────────────────────────

interface MockProc extends EventEmitter {
  stderr: EventEmitter;
}

/** Returns a factory that, when invoked (i.e. when production code calls
 *  spawn()), creates a fresh MockProc and schedules its events on the next
 *  tick. Pre-creating the proc would race with handler attachment. */
function procFactory(
  exitCode: number,
  stderr: string[] = [],
  spawnError?: Error,
): () => MockProc {
  return () => {
    const proc = new EventEmitter() as MockProc;
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      if (spawnError) {
        proc.emit('error', spawnError);
        return;
      }
      for (const line of stderr) {
        proc.stderr.emit('data', Buffer.from(line));
      }
      proc.emit('exit', exitCode);
    });
    return proc;
  };
}

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

// ─── Fixture helpers ─────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  spawnMock.mockReset();
  _resetFfmpegCacheForTests();
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

function makeFramesDir(count: number): string {
  const dir = path.join(testDir, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= count; i++) {
    const name = String(i).padStart(7, '0') + '.jpg';
    fs.writeFileSync(path.join(dir, name), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }
  return dir;
}

// ─── isFfmpegAvailable ───────────────────────────────────────────────

describe('isFfmpegAvailable', () => {
  it('returns true when ffmpeg -version exits 0', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));
    expect(await isFfmpegAvailable()).toBe(true);
  });

  it('returns false when ffmpeg binary spawn errors', async () => {
    const err = new Error('spawn ffmpeg ENOENT');
    spawnMock.mockImplementationOnce(procFactory(0, [], err));
    expect(await isFfmpegAvailable()).toBe(false);
  });

  it('returns false when ffmpeg exits non-zero', async () => {
    spawnMock.mockImplementationOnce(procFactory(127));
    expect(await isFfmpegAvailable()).toBe(false);
  });

  it('caches the result across calls', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));
    await isFfmpegAvailable();
    await isFfmpegAvailable();
    await isFfmpegAvailable();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

// ─── transcodeFramesToWebm ───────────────────────────────────────────

describe('transcodeFramesToWebm', () => {
  it('returns null when ffmpeg is not on PATH', async () => {
    spawnMock.mockImplementationOnce(procFactory(0, [], new Error('ENOENT')));
    const dir = makeFramesDir(5);
    const out = path.join(testDir, 'out.webm');

    const result = await transcodeFramesToWebm(dir, out);
    expect(result).toBeNull();
    expect(spawnMock).toHaveBeenCalledTimes(1); // only the probe
  });

  it('returns null when framesDir does not exist', async () => {
    spawnMock.mockImplementationOnce(procFactory(0)); // probe succeeds
    const result = await transcodeFramesToWebm(
      path.join(testDir, 'does-not-exist'),
      path.join(testDir, 'out.webm'),
    );
    expect(result).toBeNull();
  });

  it('returns null when framesDir is empty (no jpgs)', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));
    const dir = path.join(testDir, 'empty');
    fs.mkdirSync(dir, { recursive: true });

    const result = await transcodeFramesToWebm(dir, path.join(testDir, 'out.webm'));
    expect(result).toBeNull();
  });

  it('happy path: spawns ffmpeg with correct args, returns outPath', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));        // probe
    spawnMock.mockImplementationOnce(procFactory(0));        // encode

    const dir = makeFramesDir(10);
    const out = path.join(testDir, 'out.webm');

    const result = await transcodeFramesToWebm(dir, out);
    expect(result).toBe(out);

    // Validate ffmpeg invocation args
    const encodeCall = spawnMock.mock.calls[1];
    expect(encodeCall[0]).toBe('ffmpeg');
    const args = encodeCall[1] as string[];
    expect(args).toContain('-framerate');
    expect(args).toContain('8');                       // default inputRate
    expect(args).toContain('-vf');
    expect(args.find((a) => a.startsWith('scale=854:480'))).toBeTruthy();
    expect(args).toContain('-c:v');
    expect(args).toContain('libvpx');
    expect(args).toContain('-b:v');
    expect(args).toContain('200k');
    expect(args[args.length - 1]).toBe(out);
  });

  it('cleans up frames dir on success by default', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));        // probe
    spawnMock.mockImplementationOnce(procFactory(0));        // encode
    const dir = makeFramesDir(3);
    expect(fs.existsSync(dir)).toBe(true);

    await transcodeFramesToWebm(dir, path.join(testDir, 'out.webm'));
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('preserves frames dir when cleanupFrames=false', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));        // probe
    spawnMock.mockImplementationOnce(procFactory(0));        // encode
    const dir = makeFramesDir(3);

    await transcodeFramesToWebm(dir, path.join(testDir, 'out.webm'), {
      cleanupFrames: false,
    });
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('throws with stderr tail when ffmpeg exits non-zero', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));         // probe ok
    spawnMock.mockImplementationOnce(procFactory(1, ['Invalid pixel format\n']));
    const dir = makeFramesDir(2);

    await expect(
      transcodeFramesToWebm(dir, path.join(testDir, 'out.webm')),
    ).rejects.toThrow(/ffmpeg exited 1.*Invalid pixel format/s);
  });

  it('respects custom resolution + fps options', async () => {
    spawnMock.mockImplementationOnce(procFactory(0));
    spawnMock.mockImplementationOnce(procFactory(0));

    await transcodeFramesToWebm(
      makeFramesDir(2),
      path.join(testDir, 'out.webm'),
      { width: 640, height: 360, fps: 10, bitrate: '500k' },
    );

    const args = spawnMock.mock.calls[1][1] as string[];
    expect(args.find((a) => a.startsWith('scale=640:360'))).toBeTruthy();
    expect(args.find((a) => a.includes('fps=10'))).toBeTruthy();
    expect(args).toContain('500k');
  });
});
