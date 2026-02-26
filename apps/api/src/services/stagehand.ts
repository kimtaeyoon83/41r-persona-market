/**
 * Stagehand browser automation service
 * Used for: capturing screenshots of target URLs for LLM analysis
 */

import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.resolve('../../screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface ScreenshotResult {
  base64: string;
  path: string;
  url: string;
}

/**
 * Capture a screenshot of a URL using Stagehand
 */
export async function captureScreenshot(url: string): Promise<ScreenshotResult> {
  const { Stagehand } = await import('@browserbasehq/stagehand');

  const stagehand = new Stagehand({
    env: 'LOCAL',
    model: {
      modelName: 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
    localBrowserLaunchOptions: { headless: true },
  });

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0];
    await page.goto(url, { waitUntil: 'domcontentloaded', timeoutMs: 30000 });

    // Wait a bit for dynamic content
    await new Promise(r => setTimeout(r, 2000));

    const buffer = await page.screenshot({ fullPage: false });
    const base64 = buffer.toString('base64');

    // Save to disk
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    return { base64, path: filepath, url };
  } finally {
    await stagehand.close();
  }
}

/**
 * Capture multiple screenshots while performing actions
 */
export async function captureWithActions(
  url: string,
  actions: string[],
): Promise<{ screenshots: ScreenshotResult[]; actionLog: string[] }> {
  const { Stagehand } = await import('@browserbasehq/stagehand');

  const stagehand = new Stagehand({
    env: 'LOCAL',
    model: {
      modelName: 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
    localBrowserLaunchOptions: { headless: true },
  });

  const screenshots: ScreenshotResult[] = [];
  const actionLog: string[] = [];

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0];
    await page.goto(url, { waitUntil: 'domcontentloaded', timeoutMs: 30000 });
    actionLog.push(`Visited ${url}`);

    // Initial screenshot
    const ss0 = await page.screenshot({ fullPage: false });
    const filename0 = `action_${Date.now()}_0.png`;
    const filepath0 = path.join(SCREENSHOTS_DIR, filename0);
    fs.writeFileSync(filepath0, ss0);
    screenshots.push({ base64: ss0.toString('base64'), path: filepath0, url });

    // Perform actions
    for (let i = 0; i < actions.length; i++) {
      try {
        const result = await stagehand.act(actions[i]);
        actionLog.push(`[${i + 1}] ${actions[i]} -> ${result.success ? 'OK' : 'Failed'}`);
      } catch (err) {
        actionLog.push(`[${i + 1}] ${actions[i]} -> Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      }

      // Screenshot after each action
      const ss = await page.screenshot({ fullPage: false });
      const filename = `action_${Date.now()}_${i + 1}.png`;
      const filepath = path.join(SCREENSHOTS_DIR, filename);
      fs.writeFileSync(filepath, ss);
      screenshots.push({ base64: ss.toString('base64'), path: filepath, url });
    }

    return { screenshots, actionLog };
  } finally {
    await stagehand.close();
  }
}
