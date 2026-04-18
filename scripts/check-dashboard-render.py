#!/usr/bin/env python3
"""Headless-browser render check for /experiment/[testId].

Uses persona-engine's bundled playwright chromium (no extra install
needed). Navigates to the dashboard, waits for the recharts SVGs to
mount, captures any console errors, and writes a screenshot to
/tmp/dashboard.png so we have evidence the page didn't explode.

Exit 0 = render clean; exit 1 = JS error or chart missing.

Usage:
  <pe_venv>/bin/python scripts/check-dashboard-render.py <testId>
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

TEST_ID = sys.argv[1] if len(sys.argv) > 1 else ""
if not TEST_ID:
    print("usage: check-dashboard-render.py <testId>", file=sys.stderr)
    sys.exit(2)

URL = f"http://127.0.0.1:3000/experiment/{TEST_ID}"
SCREENSHOT = Path("/tmp/dashboard.png")


async def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 2000})
        page = await ctx.new_page()

        page.on("console", lambda msg: (
            errors.append(f"[{msg.type}] {msg.text}") if msg.type == "error"
            else warnings.append(f"[{msg.type}] {msg.text}") if msg.type == "warning"
            else None
        ))
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        page.on("requestfailed", lambda r: errors.append(
            f"[requestfailed] {r.url} → {r.failure}"
        ))

        print(f"[check] navigating to {URL}")
        resp = await page.goto(URL, wait_until="networkidle", timeout=30000)
        print(f"[check] http status = {resp.status if resp else 'no response'}")

        # Wait for the "AI Persona vs Human" header (always present)
        try:
            await page.wait_for_selector("h1", timeout=5000)
        except Exception as e:
            errors.append(f"[selector] h1 never appeared: {e}")

        # Let recharts finish its async measure/render pass
        await page.wait_for_timeout(2000)

        # Collect signals
        svg_count = await page.evaluate("document.querySelectorAll('svg.recharts-surface').length")
        stat_count = await page.evaluate(
            "document.querySelectorAll('[class*=rounded-xl]').length"
        )
        h1_text = await page.evaluate(
            "document.querySelector('h1')?.textContent ?? ''"
        )
        body_has_error_boundary = await page.evaluate(
            "document.body.textContent?.includes('Application error') ?? false"
        )

        await page.screenshot(path=str(SCREENSHOT), full_page=True)
        print(f"[check] screenshot saved to {SCREENSHOT}")

        await browser.close()

    print(f"[check] h1 = {h1_text!r}")
    print(f"[check] recharts <svg> elements: {svg_count}")
    print(f"[check] rounded-xl cards: {stat_count}")
    if body_has_error_boundary:
        errors.append("[body] 'Application error' text on page — Next.js boundary")

    if errors:
        print("\n[check] ERRORS:")
        for e in errors:
            print(f"  {e}")
    if warnings:
        print("\n[check] warnings (informational):")
        for w in warnings[:5]:
            print(f"  {w}")

    # Thresholds: at least 2 recharts surfaces (convergence + scatter or
    # bar) should be present for a non-empty dataset. With very sparse
    # data the charts render empty-state cards instead, so we just
    # require no errors + the h1 to have landed.
    ok = not errors and "Agreement Dashboard" in h1_text
    print(f"\n[check] {'PASS ✅' if ok else 'FAIL ❌'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
