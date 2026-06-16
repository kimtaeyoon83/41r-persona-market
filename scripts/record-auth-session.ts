/**
 * Record a partner auth session for authenticated capture (Phase 1).
 *
 * Saves a Playwright storageState (cookies + localStorage) after a HUMAN
 * logs in. Google OAuth blocks automation-controlled browsers ("이 브라우저
 * 또는 앱이 안전하지 않을 수 있습니다"), so there are two modes:
 *
 *  MODE A — launch real Chrome with the automation fingerprint stripped
 *  (default). Often enough for Google. Requires Chrome installed.
 *    pnpm tsx scripts/record-auth-session.ts <url> [out.json]
 *
 *  MODE B — attach to a Chrome YOU started yourself over CDP (most
 *  reliable: a normal Chrome has zero automation flags, so Google never
 *  blocks it). Steps:
 *    1) Launch a dedicated Chrome with remote debugging:
 *       "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *         --remote-debugging-port=9222 --user-data-dir=/tmp/rpm-chrome
 *    2) In THAT Chrome, open the URL and log in fully (real product visible).
 *    3) Run, attaching over CDP:
 *       RPM_CDP=http://localhost:9222 pnpm tsx scripts/record-auth-session.ts <url> [out.json]
 *
 * Upload the saved JSON to the workspace (console Settings → Auth session,
 * or hand it to the operator). It's encrypted at rest and reused across
 * scans — treat it like a password and delete the local file after upload.
 */
import { chromium, type BrowserContext } from 'playwright-core';
import fs from 'node:fs';
import readline from 'node:readline';

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const url = process.argv[2];
  const out = process.argv[3] ?? '/tmp/rpm-auth-session.json';
  const cdp = process.env.RPM_CDP;
  if (!url) {
    console.error('Usage: pnpm tsx scripts/record-auth-session.ts <url> [out.json]');
    process.exit(1);
  }

  let ctx: BrowserContext;
  let close: () => Promise<void>;

  if (cdp) {
    // MODE B — attach to the user's own Chrome (no automation flags).
    console.log(`\nAttaching to your Chrome at ${cdp} …`);
    const browser = await chromium.connectOverCDP(cdp);
    const existing = browser.contexts();
    ctx = existing[0] ?? (await browser.newContext());
    close = async () => {
      await browser.close();
    };
    console.log('Attached. Make sure you are LOGGED IN and seeing the real product in that Chrome.');
  } else {
    // MODE A — launch real Chrome, strip the automation fingerprint.
    console.log('\nLaunching real Chrome (automation fingerprint stripped)…');
    console.log('If Google still says "browser may not be secure", use MODE B (see file header — RPM_CDP).');
    const browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    close = async () => {
      await browser.close();
    };
    console.log('\n1. Log in IN THE OPENED CHROME.');
    console.log('2. Navigate until you SEE the real product (past the gate).');
  }

  await waitForEnter('\n3. Press Enter HERE to capture the session… ');

  const state = await ctx.storageState();
  fs.writeFileSync(out, JSON.stringify(state));
  const cookies = state.cookies?.length ?? 0;
  const origins = state.origins?.length ?? 0;
  console.log(`\nSaved storageState → ${out}  (${cookies} cookies, ${origins} origins)`);
  if (cookies === 0) {
    console.log('⚠️  0 cookies — you may not be logged in, or (MODE B) the wrong Chrome context.');
  }
  console.log('Hand this file to the operator / upload in console Settings, then DELETE it.\n');

  await close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
