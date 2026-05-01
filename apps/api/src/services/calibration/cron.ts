// Calibration cron — Phase 2-C-2.
//
// Spec §5.2: weekly Track A run (Tuesday 02:00 KST). For Phase 2-C-2
// MVP this is a setInterval inside the API process (mirroring
// services/settlement-worker.ts). Production will eventually want a
// dedicated worker process or external cron — but the in-process
// loop is good enough for now and the manual trigger route lets
// operators/CI run it on demand.
//
// Gated by CALIBRATION_CRON_ENABLED env (off by default). Production
// deployments set it; dev usually doesn't, since manual triggers
// against the same code path are easier for iteration.

import { logger } from '../../logger.js';
import { runTrackA } from './track_a.js';

const log = logger.child({ service: 'calibration_cron' });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000; // 1 min after boot — let DB warm

let timer: ReturnType<typeof setInterval> | null = null;

function isEnabled(): boolean {
  const v = process.env.CALIBRATION_CRON_ENABLED;
  return v !== undefined && v !== '' && v !== '0' && v !== 'false';
}

async function tick(): Promise<void> {
  log.info('Track A weekly tick starting');
  try {
    const result = await runTrackA({});
    log.info(result, 'Track A weekly tick complete');
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : 'unknown' },
      'Track A weekly tick threw',
    );
  }
}

export function startCalibrationCron(): void {
  if (!isEnabled()) {
    log.info('calibration cron disabled (set CALIBRATION_CRON_ENABLED=1 to enable)');
    return;
  }
  if (timer) {
    log.warn('calibration cron already started');
    return;
  }
  log.info(
    { firstRunInMs: FIRST_RUN_DELAY_MS, intervalMs: SEVEN_DAYS_MS },
    'calibration cron starting',
  );
  // Fire-and-forget first run; subsequent ticks via setInterval.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, SEVEN_DAYS_MS);
  }, FIRST_RUN_DELAY_MS);
}

export function stopCalibrationCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info('calibration cron stopped');
  }
}
