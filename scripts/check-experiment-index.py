#!/usr/bin/env python3
"""Headless render check for /experiment (the index)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

URL = "http://127.0.0.1:3000/experiment"
SCREENSHOT = Path("/tmp/experiment-index.png")


async def main() -> int:
    errors: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1200})
        page = await ctx.new_page()

        page.on("console", lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        resp = await page.goto(URL, wait_until="networkidle", timeout=30000)
        print(f"[check] status = {resp.status if resp else 'no response'}")
        await page.wait_for_selector("h1", timeout=5000)
        await page.wait_for_timeout(1500)

        h1 = await page.evaluate("document.querySelector('h1')?.textContent ?? ''")
        link_count = await page.evaluate(
            "document.querySelectorAll('a[href^=\"/experiment/\"]').length"
        )
        print(f"[check] h1 = {h1!r}")
        print(f"[check] test cards: {link_count}")

        await page.screenshot(path=str(SCREENSHOT), full_page=True)
        print(f"[check] screenshot → {SCREENSHOT}")
        await browser.close()

    if errors:
        print("\n[check] ERRORS:")
        for e in errors: print(f"  {e}")

    ok = not errors and "Experiments" in h1 and link_count >= 1
    print(f"\n[check] {'PASS ✅' if ok else 'FAIL ❌'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
