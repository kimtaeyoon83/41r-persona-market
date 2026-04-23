/**
 * Browser-quirk registry. Ordered: fast/common quirks first so the
 * detectors that regex-out most hits run before the LLM fallback for
 * others. stagehand_hybrid iterates this list after each act() and
 * after Phase A goto's.
 */
import { authWallQuirk } from './auth_wall.js';
import { cookieConsentQuirk } from './cookie_consent.js';
import type { BrowserQuirk } from './types.js';

export const BROWSER_QUIRKS: BrowserQuirk[] = [
  authWallQuirk,
  cookieConsentQuirk,
];

export { runDetectors } from './types.js';
export type { BrowserQuirk, QuirkContext, QuirkDetectionResult, QuirkRecoveryResult } from './types.js';
export { isAuthWallUrl } from './auth_wall.js';
