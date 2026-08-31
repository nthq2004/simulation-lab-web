import sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import asyncio
from playwright.async_api import async_playwright


async def test():
    print("Starting playwright...")
    pw = await async_playwright().start()
    print("Launching browser...")
    browser = await pw.chromium.launch(headless=False)
    print("Browser launched! Opening page...")
    page = await browser.new_page()
    await page.goto(
        "https://study.enaea.edu.cn/circleIndexRedirect.do?action=toNewMyClass&type=course&circleId=375713&syllabusId=2163655"
    )
    print("Page opened. Waiting 10 seconds...")
    await asyncio.sleep(10)
    print("Done! Closing browser.")
    await browser.close()
    await pw.stop()


asyncio.run(test())
