/**
 * Record a partner auth session for authenticated capture (Phase 1).
 *
 * Opens a REAL (headed) browser at the target URL. A human logs in
 * normally — Google OAuth, 2FA, captcha, anything — because a person is
 * driving, not a bot (Google blocks automated OAuth, so we never try).
 * When you're past the login and seeing the real product, come back to
 * the terminal and press Enter: the browser's session (cookies +
 * localStorage = Playwright storageState) is saved to a JSON file.
 *
 * Upload that file's contents to the workspace:
 *   PUT /api/console/sites/:id/auth-session  { storage_state: <file text>, capture_paths?: [...] }
 * (the console Settings tab does this for you). The server encrypts it
 * at rest — the JSON itself is bearer-equivalent, treat it like a
 * password and delete the local file once uploaded.
 *
 * Usage:
 *   pnpm tsx scripts/record-auth-session.ts <url> [out.json]
 *   pnpm tsx scripts/record-auth-session.ts https://geulbat-app-production.up.railway.app /tmp/geulbat-session.json
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import readline from 'node:readline';

async function main() {
  const url = process.argv[2];
  const out = process.argv[3] ?? '/tmp/rpm-auth-session.json';
  if (!url) {
    console.error('Usage: pnpm tsx scripts/record-auth-session.ts <url> [out.json]');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n────────────────────────────────────────────────────────');
  console.log('1. Log in IN THE OPENED BROWSER (Google OAuth etc.).');
  console.log('2. Navigate until you SEE the real product (past the gate).');
  console.log('3. Then press Enter HERE to save the session.');
  console.log('────────────────────────────────────────────────────────\n');

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Press Enter to capture the session… ', () => {
      rl.close();
      resolve();
    });
  });

  const state = await ctx.storageState();
  fs.writeFileSync(out, JSON.stringify(state));
  const cookies = state.cookies?.length ?? 0;
  const origins = state.origins?.length ?? 0;
  console.log(`\nSaved storageState → ${out}  (${cookies} cookies, ${origins} origins)`);
  console.log('Upload its contents to the workspace Settings → "Auth session", then DELETE this file.\n');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
