"""
在线学习平台 - 弹窗自动确认脚本（简化版）
适用于：study.enaea.edu.cn 等教师培训平台

使用方法：
  1. pip install playwright
  2. playwright install chromium
  3. python auto_popup.py
  4. 在浏览器中手动登录一次，之后脚本自动处理
"""

import asyncio
import time
from playwright.async_api import async_playwright, TimeoutError as PwTimeout


async def main():
    TARGET_MINUTES = 225        # 需要学习的总分钟数
    POPUP_INTERVAL = 20 * 60    # 弹窗间隔 20分钟（秒）
    CHECK_INTERVAL = 15         # 检测弹窗间隔 15秒

    print("=" * 55)
    print("  在线学习平台 - 自动学习 & 弹窗确认工具")
    print("=" * 55)

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False, slow_mo=300)
    context = await browser.new_context(
        viewport={"width": 1400, "height": 900}
    )
    page = await context.new_page()

    # ── 1. 打开网站 ──
    url = ("https://study.enaea.edu.cn/circleIndexRedirect.do"
           "?action=toNewMyClass&type=course"
           "&circleId=375713&syllabusId=2163655")
    await page.goto(url)
    await page.wait_for_load_state("domcontentloaded")

    # ── 2. 等待登录 ──
    logged_in = False
    for _ in range(300):                     # 最多等 5 分钟
        try:
            await page.wait_for_selector('text="所有课程"', timeout=2000)
            logged_in = True
            break
        except PwTimeout:
            await asyncio.sleep(1)

    if not logged_in:
        print("[!] 登录超时")
        await browser.close()
        return

    print("[✓] 登录成功\n")

    # ── 3. 进入"未学完的课程"，点击第一个"学习"按钮 ──
    async def click_first_learn():
        """在课程列表中找到第一个未完成课程并点击学习"""
        try:
            tab = page.locator('text="未学完的课程"')
            if await tab.count() > 0:
                await tab.click()
                await asyncio.sleep(2)

            btns = page.locator('button:has-text("学习")')
            count = await btns.count()
            if count > 0:
                await btns.first.click()
                await asyncio.sleep(3)

                # 如果新窗口打开
                if len(context.pages) > 1:
                    return context.pages[-1]
                return page
        except Exception as e:
            print(f"[!] 点击学习按钮失败: {e}")
        return None

    study_page = await click_first_learn()
    if study_page is None:
        print("[!] 无法打开课程")
        await browser.close()
        return

    print("[▶] 课程已打开，开始计时...\n")

    # ── 4. 核心循环：计时 + 自动处理弹窗 ──
    start = time.time()
    last_popup_time = start       # 上次处理弹窗的时间

    popup_keywords = [
        "确定", "确认", "继续学习", "继续观看", "继续",
        "OK", "Confirm", "我知道了", "明白了",
    ]

    async def try_close_popup(pg):
        """尝试检测并关闭弹窗"""
        nonlocal last_popup_time

        # ---- 常见弹窗按钮 ----
        selectors = [
            'button:has-text("确定")',
            'button:has-text("确认")',
            'button:has-text("继续学习")',
            'button:has-text("继续观看")',
            'button:has-text("继续")',
            'button:has-text("OK")',
            'button:has-text("我知道了")',
            'button:has-text("明白了")',
            'a:has-text("确定")',
            'a:has-text("继续学习")',
            'span:has-text("确定")',
            '.btn-confirm',
            '.btn-ok',
            'input[type="button"][value="确定"]',
        ]

        for sel in selectors:
            try:
                btn = pg.locator(sel).first
                if await btn.is_visible(timeout=500):
                    await btn.click()
                    last_popup_time = time.time()
                    print(f"  [🔔] 弹窗已自动确认 ({time.strftime('%H:%M:%S')})")
                    await asyncio.sleep(1)
                    return True
            except Exception:
                continue

        # ---- 检查 iframe 内的弹窗 ----
        for frame in pg.frames:
            if frame == pg.main_frame:
                continue
            for sel in selectors:
                try:
                    btn = frame.locator(sel).first
                    if await btn.is_visible(timeout=500):
                        await btn.click()
                        last_popup_time = time.time()
                        print(f"  [🔔] iframe弹窗已确认 ({time.strftime('%H:%M:%S')})")
                        await asyncio.sleep(1)
                        return True
                except Exception:
                    continue

        # ---- 检测 alert 弹窗 ----
        try:
            pg.on("dialog", lambda d: d.accept())
        except Exception:
            pass

        return False

    while True:
        await asyncio.sleep(CHECK_INTERVAL)

        elapsed_sec = time.time() - start
        elapsed_min = elapsed_sec / 60

        # 每分钟打印进度
        if int(elapsed_sec) % 60 < CHECK_INTERVAL:
            print(f"  [⏱] 已学习: {elapsed_min:.1f} / {TARGET_MINUTES} 分钟"
                  f"  (进度 {elapsed_min / TARGET_MINUTES * 100:.1f}%)")

        # 尝试关闭弹窗
        await try_close_popup(study_page)

        # 达标退出
        if elapsed_min >= TARGET_MINUTES:
            print(f"\n[🎉] 已完成 {TARGET_MINUTES} 分钟学习！")
            break

        # 检查页面是否还在
        try:
            _ = study_page.url
        except Exception:
            print("[!] 学习页面已关闭，尝试重新打开...")
            study_page = await click_first_learn()
            if study_page is None:
                print("[✗] 无法恢复学习页面")
                break

    # ── 5. 结束 ──
    total = (time.time() - start) / 60
    print(f"\n总计学习时长: {total:.1f} 分钟")
    print("按回车关闭浏览器...")
    input()
    await browser.close()
    await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
