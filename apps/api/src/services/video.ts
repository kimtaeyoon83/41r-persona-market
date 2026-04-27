/**
 * JPEG-sequence → WebM transcode helper.
 *
 * Stagehand v3 doesn't expose Playwright's recordVideo (uses chrome-launcher
 * CDP, not playwright.launchPersistentContext), so services/stagehand_hybrid.ts
 * captures Page.screencastFrame events to /tmp/stagehand-frames/<sessionId>/
 * as zero-padded JPEGs (0000001.jpg, 0000002.jpg, …).
 *
 * This module ffmpeg-encodes that sequence into a single 854×480 @ 5fps
 * .webm for upload to R2, then deletes the JPEG source dir.
 *
 * Behavior contract:
 *   - Returns the output path on success.
 *   - Returns null (no throw) when ffmpeg is missing on $PATH or the input
 *     dir is empty/absent. The caller is expected to gate on null and ship
 *     the report without a replay (graceful degradation).
 *   - Throws only on unexpected ffmpeg crash or permission errors.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface TranscodeOptions {
  /** Output resolution. Default 854×480 (480p). */
  width?: number;
  height?: number;
  /** Output framerate (chrome screencast yields ~8fps source — we resample). */
  fps?: number;
  /** Target bitrate. Default 200k for 480p @ 5fps. */
  bitrate?: string;
  /** Source JPEG glob input rate — should match how often Page.screencastFrame
   *  fires. Default 8 = chrome's typical paint rate with everyNthFrame=3. */
  inputRate?: number;
  /** Delete the source JPEG dir after successful encode. Default true. */
  cleanupFrames?: boolean;
}

const DEFAULTS: Required<TranscodeOptions> = {
  width: 854,
  height: 480,
  fps: 5,
  bitrate: '200k',
  inputRate: 8,
  cleanupFrames: true,
};

/** Probe whether ffmpeg is reachable on $PATH. Cached for the process. */
let _ffmpegAvailable: boolean | undefined;
export async function isFfmpegAvailable(): Promise<boolean> {
  if (_ffmpegAvailable !== undefined) return _ffmpegAvailable;
  return new Promise<boolean>((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.once('error', () => { _ffmpegAvailable = false; resolve(false); });
    proc.once('exit', (code) => {
      _ffmpegAvailable = code === 0;
      resolve(_ffmpegAvailable);
    });
  });
}

/**
 * Encode a JPEG sequence into a single .webm.
 *
 * @returns Absolute path to the .webm on success, or null when:
 *   - ffmpeg missing
 *   - framesDir doesn't exist or has zero JPEGs
 */
export async function transcodeFramesToWebm(
  framesDir: string,
  outPath: string,
  opts: TranscodeOptions = {},
): Promise<string | null> {
  const cfg = { ...DEFAULTS, ...opts };

  // Guard 1: ffmpeg present?
  if (!(await isFfmpegAvailable())) {
    console.warn('[video] ffmpeg not on $PATH — skipping transcode');
    return null;
  }

  // Guard 2: any frames to encode?
  let frameCount = 0;
  try {
    frameCount = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).length;
  } catch {
    console.warn(`[video] framesDir missing or unreadable: ${framesDir}`);
    return null;
  }
  if (frameCount === 0) {
    console.warn(`[video] no JPEG frames in ${framesDir} — skipping transcode`);
    return null;
  }

  // ffmpeg invocation:
  //   -framerate <inputRate>  : tells ffmpeg how to interpret the source seq
  //   -i %07d.jpg             : zero-padded 7-digit pattern (matches stagehand_hybrid.ts)
  //   -vf scale=W:H,fps=<out> : downscale + resample to target fps
  //   -c:v libvpx -b:v <br>   : VP8 webm output, bitrate-targeted
  //   -cpu-used 4             : speed/quality tradeoff (4 = fast, deterministic)
  //   -y                      : overwrite output if exists
  const args = [
    '-framerate', String(cfg.inputRate),
    '-i', path.join(framesDir, '%07d.jpg'),
    '-vf', `scale=${cfg.width}:${cfg.height},fps=${cfg.fps}`,
    '-c:v', 'libvpx',
    '-b:v', cfg.bitrate,
    '-cpu-used', '4',
    '-y', outPath,
  ];

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  const started = Date.now();

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrTail = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      // Keep last 2KB of stderr for error diagnosis without ballooning logs.
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    proc.once('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    proc.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderrTail}`));
    });
  });

  const elapsed = Date.now() - started;
  console.log(`[video] transcoded ${frameCount} frames → ${outPath} in ${elapsed}ms`);

  // Cleanup source frames — they're large and only needed for the encode pass.
  if (cfg.cleanupFrames) {
    try {
      await fs.promises.rm(framesDir, { recursive: true, force: true });
    } catch {
      /* leave behind on failure — disk space cleanup is non-critical */
    }
  }

  return outPath;
}

/** Reset the ffmpeg-availability cache. Tests need this between runs. */
export function _resetFfmpegCacheForTests(): void {
  _ffmpegAvailable = undefined;
}
