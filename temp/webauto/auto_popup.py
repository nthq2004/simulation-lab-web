# -*- coding: utf-8 -*-
"""
在线学习平台 - 弹窗自动确认脚本
适用于：study.enaea.edu.cn 等教师培训平台
"""

import sys
import io
import asyncio
import time
from playwright.async_api import async_playwright, TimeoutError as PwTimeout

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


async def main():
    TARGET_MINUTES = 225
    CHECK_INTERVAL = 15

    print("=" * 55)
    print("  Online Study - Auto Popup Handler")
    print("=" * 55)

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(
        headless=False,
        slow_mo=300,
        args=["--disable-blink-features=AutomationControlled"],
    )
    context = await browser.new_context(
        viewport={"width": 1400, "height": 900},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    page = await context.new_page()

    # 注册 dialog 事件处理
    page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

    # -- 1. 先打开登录页面 --
    print("[1] Opening login page...")
    login_url = "https://study.enaea.edu.cn/circleIndexRedirect.do?action=toNewMyClass&type=course&circleId=375713&syllabusId=2163655"
    await page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(3)

    # -- 2. 等待用户手动登录 --
    print("[2] Waiting for manual login (max 5 min)...")
    print("    Please login in the browser window.")

    logged_in = False
    for i in range(300):
        await asyncio.sleep(1)
        try:
            current_url = page.url
            # 检查是否在登录页面
            if "login" in current_url.lower():
                if i % 10 == 0:
                    print(f"    Waiting... ({i}s)")
                continue

            # 检查是否能看到课程列表
            content = await page.content()
            if (
                "所有课程" in content
                or "未学完的课程" in content
                or "我的学习" in content
            ):
                logged_in = True
                print("[OK] Login detected!")
                break

            # 检查是否有学习按钮
            learn_btn = page.locator('button:has-text("学习")')
            if await learn_btn.count() > 0:
                logged_in = True
                print("[OK] Login detected (learn button found)!")
                break

        except Exception:
            # 页面可能正在跳转
            continue

    if not logged_in:
        print("[X] Login timeout!")
        await browser.close()
        return

    # -- 3. 确保在课程列表页面 --
    print("[3] Navigating to course list...")
    course_url = "https://study.enaea.edu.cn/circleIndexRedirect.do?action=toNewMyClass&type=course&circleId=375713&syllabusId=2163655"
    await page.goto(course_url, wait_until="networkidle", timeout=30000)
    await asyncio.sleep(3)

    # -- 4. 点击第一个学习按钮 --
    async def click_first_learn():
        try:
            # 先点击"未学完的课程"标签
            tab = page.locator('text="未学完的课程"')
            if await tab.count() > 0:
                await tab.click()
                await asyncio.sleep(2)
                print("  Switched to 'unfinished courses' tab")

            # 查找学习按钮
            btns = page.locator('button:has-text("学习")')
            count = await btns.count()
            if count == 0:
                # 尝试其他选择器
                btns = page.locator('a:has-text("学习")')
                count = await btns.count()
            if count == 0:
                btns = page.locator('.btn-primary:has-text("学习")')
                count = await btns.count()

            if count > 0:
                print(f"[4] Found {count} unfinished courses, starting first one...")
                await btns.first.click()
                await asyncio.sleep(5)

                # 检查是否有新窗口
                pages = context.pages
                if len(pages) > 1:
                    return pages[-1]
                return page
            else:
                print("  No learn button found. Taking screenshot for debug...")
                await page.screenshot(path="debug_screenshot.png")
                print("  Screenshot saved to debug_screenshot.png")
                return None

        except Exception as e:
            print(f"[!] Error clicking learn button: {e}")
            return None

    study_page = await click_first_learn()
    if study_page is None:
        print("[!] Could not open course")
        await browser.close()
        return

    print("[OK] Course opened!")
    print(f"[5] Monitoring progress, target: {TARGET_MINUTES} min")
    print("-" * 55)

    # -- 5. 核心循环 --
    start = time.time()
    last_popup_time = start

    async def try_close_popup(pg):
        nonlocal last_popup_time

        selectors = [
            'button:has-text("确定")',
            'button:has-text("确认")',
            'button:has-text("继续学习")',
            'button:has-text("继续观看")',
            'button:has-text("继续")',
            'button:has-text("OK")',
            'button:has-text("我知道了")',
            'button:has-text("明白了")',
            'button:has-text("关闭")',
            'a:has-text("确定")',
            'a:has-text("继续学习")',
            'span:has-text("确定")',
            ".btn-confirm",
            ".btn-ok",
            'input[type="button"][value="确定"]',
            'input[type="button"][value="确认"]',
        ]

        for sel in selectors:
            try:
                btn = pg.locator(sel).first
                if await btn.is_visible(timeout=500):
                    await btn.click()
                    last_popup_time = time.time()
                    ts = time.strftime("%H:%M:%S")
                    print(f"  [POPUP] Auto-confirmed ({ts})")
                    await asyncio.sleep(1)
                    return True
            except Exception:
                continue

        # iframe 内的弹窗
        for frame in pg.frames:
            if frame == pg.main_frame:
                continue
            for sel in selectors:
                try:
                    btn = frame.locator(sel).first
                    if await btn.is_visible(timeout=500):
                        await btn.click()
                        last_popup_time = time.time()
                        ts = time.strftime("%H:%M:%S")
                        print(f"  [POPUP-IFRAME] Auto-confirmed ({ts})")
                        await asyncio.sleep(1)
                        return True
                except Exception:
                    continue
        return False

    while True:
        await asyncio.sleep(CHECK_INTERVAL)

        elapsed_sec = time.time() - start
        elapsed_min = elapsed_sec / 60

        if int(elapsed_sec) % 60 < CHECK_INTERVAL:
            pct = elapsed_min / TARGET_MINUTES * 100
            bar_len = int(pct / 5)
            bar = "#" * bar_len + "-" * (20 - bar_len)
            print(f"  [TIME] {elapsed_min:.1f}/{TARGET_MINUTES} min [{bar}] {pct:.1f}%")

        await try_close_popup(study_page)

        if elapsed_min >= TARGET_MINUTES:
            print(f"\n[DONE] Completed {TARGET_MINUTES} minutes!")
            break

        try:
            _ = study_page.url
        except Exception:
            print("[!] Page closed, trying to recover...")
            study_page = await click_first_learn()
            if study_page is None:
                print("[X] Cannot recover page")
                break

    total = (time.time() - start) / 60
    print("-" * 55)
    print(f"Total study time: {total:.1f} minutes")
    print("Press Enter to close browser...")
    input()
    await browser.close()
    await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
