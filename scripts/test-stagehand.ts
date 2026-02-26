/**
 * Phase 1.2 — Stagehand Browser Automation PoC
 *
 * Demonstrates Stagehand controlling a headless Chromium browser in LOCAL mode,
 * navigating to a public site, taking screenshots, and performing a simple action.
 *
 * Usage:
 *   npx tsx scripts/test-stagehand.ts
 *
 * Requires:
 *   - ANTHROPIC_API_KEY in .env at project root
 *   - Playwright Chromium installed (npx playwright install chromium)
 */

import "dotenv/config";
import {
  Stagehand,
  __internalMaybeRunShutdownSupervisorFromArgv,
} from "@browserbasehq/stagehand";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Stagehand v3 may re-execute this script as a shutdown-supervisor subprocess.
// If that is the case, the supervisor blocks on stdin and we skip main().
if (!__internalMaybeRunShutdownSupervisorFromArgv()) {
  main();
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SCREENSHOTS_DIR = join(PROJECT_ROOT, "screenshots");
const TARGET_URL = "https://news.ycombinator.com";

// FALLBACK NOTE:
// If the external site is unreachable (e.g., network issues, CI environment),
// you can swap TARGET_URL to "http://localhost:3000" to test against the local
// Next.js dev server instead. Start it first with `pnpm dev` from apps/web/.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function saveScreenshot(
  page: Awaited<ReturnType<Stagehand["context"]["pages"]>>[number],
  label: string,
): Promise<string> {
  const filename = `${timestamp()}_${label}.png`;
  const filepath = join(SCREENSHOTS_DIR, filename);
  const buffer = await page.screenshot({ fullPage: false });
  await writeFile(filepath, buffer);
  return filepath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[stagehand-poc] Starting Stagehand browser automation PoC...\n");

  // Validate env
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ERROR: ANTHROPIC_API_KEY not found in environment.\n" +
        "Make sure it is set in your .env file at the project root.",
    );
    process.exit(1);
  }

  await ensureDir(SCREENSHOTS_DIR);

  // ----- Initialize Stagehand in LOCAL mode -----
  console.log("[stagehand-poc] Initializing Stagehand (LOCAL mode, headless)...");

  const stagehand = new Stagehand({
    env: "LOCAL",
    model: {
      modelName: "claude-sonnet-4-6",
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    localBrowserLaunchOptions: {
      headless: true,
    },
    verbose: 1,
    disablePino: true,
  });

  await stagehand.init();
  console.log("[stagehand-poc] Stagehand initialized.\n");

  try {
    // ----- Navigate to the target site -----
    const page = stagehand.context.pages()[0];
    console.log(`[stagehand-poc] Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
    console.log(`[stagehand-poc] Page loaded: ${page.url()}\n`);

    // ----- Screenshot #1: Initial page -----
    const shot1 = await saveScreenshot(page, "01-initial");
    console.log(`[stagehand-poc] Screenshot #1 saved: ${shot1}`);

    // ----- Perform an action via Stagehand AI -----
    console.log("[stagehand-poc] Asking Stagehand to click the first story link...");
    const actResult = await stagehand.act(
      "Click on the first story link on the page (the title text, not the comments link)",
    );
    console.log(
      `[stagehand-poc] Act result: success=${actResult.success}, message="${actResult.message}"\n`,
    );

    // Give the new page a moment to load
    await page.waitForLoadState("domcontentloaded", 10_000).catch(() => {
      // Some external sites may not fully settle — that is fine for a PoC.
      console.log("[stagehand-poc] (page load state wait timed out, continuing anyway)");
    });

    // ----- Screenshot #2: After the action -----
    // Stagehand may have opened a new tab or navigated the current one.
    // Grab whichever page is now active.
    const activePage = stagehand.context.activePage() ?? page;
    const shot2 = await saveScreenshot(activePage, "02-after-click");
    console.log(`[stagehand-poc] Screenshot #2 saved: ${shot2}`);
    console.log(`[stagehand-poc] Current URL: ${activePage.url()}\n`);

    // ----- Summary -----
    console.log("=".repeat(60));
    console.log(" Stagehand PoC -- SUCCESS");
    console.log("=".repeat(60));
    console.log(`  Screenshot 1 (before): ${shot1}`);
    console.log(`  Screenshot 2 (after):  ${shot2}`);
    console.log("=".repeat(60));
  } catch (err) {
    console.error("[stagehand-poc] Error during automation:", err);
    process.exitCode = 1;
  } finally {
    // ----- Cleanup -----
    console.log("\n[stagehand-poc] Closing browser...");
    await stagehand.close();
    console.log("[stagehand-poc] Done.");
  }
}
