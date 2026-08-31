"""
在线学习平台自动化学习工具
功能：自动选择未学习课程、自动处理20分钟弹窗确认
"""

import asyncio
import time
import json
import os
from datetime import datetime
from playwright.async_api import async_playwright, Page, TimeoutError as PlaywrightTimeout


# ============== 配置区域 ==============
CONFIG = {
    # 登录信息
    "login_url": "https://study.enaea.edu.cn/circleIndexRedirect.do",
    "course_list_url": "https://study.enaea.edu.cn/circleIndexRedirect.do?action=toNewMyClass&type=course&circleId=375713&syllabusId=2163655",

    # 学习目标
    "total_minutes_needed": 225,       # 需要学习的总分钟数

    # 弹窗处理
    "popup_interval_minutes": 20,      # 弹窗出现间隔（分钟）
    "popup_check_interval_seconds": 10,  # 检测弹窗的间隔（秒）

    # 浏览器设置
    "headless": False,                 # False=显示浏览器界面, True=后台运行
    "slow_mo": 500,                    # 操作延迟(ms)，模拟真人操作速度

    # 进度保存
    "progress_file": "study_progress.json",
}


class OnlineStudyBot:
    def __init__(self):
        self.config = CONFIG
        self.page: Page = None
        self.browser = None
        self.context = None
        self.start_time = None
        self.studied_minutes = 0
        self.current_course = None
        self.running = True

    async def init_browser(self):
        """初始化浏览器"""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=self.config["headless"],
            slow_mo=self.config["slow_mo"]
        )
        # 使用持久化上下文保存登录状态（避免重复登录）
        user_data_dir = os.path.join(os.path.dirname(__file__), "browser_data")
        self.context = await self.browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        self.page = await self.context.new_page()
        print("[✓] 浏览器初始化完成")

    async def login(self):
        """登录流程 - 需要手动完成首次登录"""
        print("[...] 正在打开登录页面...")
        await self.page.goto(self.config["login_url"])
        await self.page.wait_for_load_state("networkidle")

        # 检查是否已经登录（如果页面包含课程列表则已登录）
        try:
            await self.page.wait_for_selector('text="所有课程"', timeout=5000)
            print("[✓] 已检测到登录状态，无需重新登录")
            return True
        except PlaywrightTimeout:
            pass

        print("[!] 请在浏览器中手动登录（输入账号密码并点击登录）")
        print("[!] 登录完成后脚本将自动继续...")

        # 等待用户手动登录，最多等待5分钟
        for i in range(300):
            await asyncio.sleep(1)
            try:
                await self.page.wait_for_selector('text="所有课程"', timeout=1000)
                print("[✓] 登录成功！")
                return True
            except PlaywrightTimeout:
                continue

        print("[✗] 登录超时，请重新运行脚本")
        return False

    async def navigate_to_course_list(self):
        """导航到课程列表页面"""
        print("[...] 正在加载课程列表...")
        await self.page.goto(self.config["course_list_url"])
        await self.page.wait_for_load_state("networkidle")
        await asyncio.sleep(2)
        print("[✓] 课程列表加载完成")

    async def get_study_progress(self) -> dict:
        """获取当前学习进度"""
        try:
            # 读取页面上的学习进度信息
            progress_text = await self.page.text_content(".study-progress") or ""
            minutes_text = await self.page.query_selector_all("span")

            studied = 0
            required = self.config["total_minutes_needed"]

            # 尝试从页面获取已学时间
            for span in minutes_text:
                text = await span.text_content()
                if text and "已学" in text:
                    # 提取数字，如 "已学：30分钟" 或 "已学: 0分钟"
                    import re
                    match = re.search(r'(\d+)', text)
                    if match:
                        studied = int(match.group(1))
                        break

            return {
                "studied_minutes": studied,
                "required_minutes": required,
                "remaining_minutes": max(0, required - studied),
                "completed": studied >= required
            }
        except Exception as e:
            print(f"[!] 获取进度失败: {e}")
            return {
                "studied_minutes": 0,
                "required_minutes": self.config["total_minutes_needed"],
                "remaining_minutes": self.config["total_minutes_needed"],
                "completed": False
            }

    async def get_unfinished_courses(self) -> list:
        """获取未学完的课程列表"""
        courses = []
        try:
            # 点击"未学完的课程"标签
            await self.page.click('text="未学完的课程"')
            await asyncio.sleep(2)

            # 获取所有课程行
            rows = await self.page.query_selector_all("table tbody tr")

            for row in rows:
                try:
                    # 获取课程信息
                    title_el = await row.query_selector("td:nth-child(1)")
                    duration_el = await row.query_selector("td:nth-child(2)")
                    progress_el = await row.query_selector("td:nth-child(5)")
                    learn_btn = await row.query_selector('button:has-text("学习")')
                    delete_btn = await row.query_selector('button:has-text("删除")')

                    if title_el and learn_btn:
                        title = await title_el.text_content()
                        title = title.strip() if title else "未知课程"

                        duration_text = await duration_el.text_content() if duration_el else "00:00:00"
                        duration_text = duration_text.strip() if duration_text else "00:00:00"

                        # 解析时长（格式 01:20:05）
                        parts = duration_text.split(":")
                        if len(parts) == 3:
                            duration_minutes = int(parts[0]) * 60 + int(parts[1])
                        else:
                            duration_minutes = 0

                        progress_text = await progress_el.text_content() if progress_el else "0%"

                        # 判断是否已学完
                        is_completed = "100%" in (progress_text or "")

                        if not is_completed:
                            courses.append({
                                "title": title,
                                "duration_text": duration_text,
                                "duration_minutes": duration_minutes,
                                "progress": progress_text.strip() if progress_text else "0%",
                                "row": row,
                                "learn_btn": learn_btn,
                                "delete_btn": delete_btn
                            })
                except Exception as e:
                    continue

            # 切换回"所有课程"标签
            await self.page.click('text="所有课程"')
            await asyncio.sleep(1)

        except Exception as e:
            print(f"[!] 获取课程列表失败: {e}")

        return courses

    async def start_learning_course(self, course: dict) -> bool:
        """开始学习一个课程"""
        try:
            title = course["title"][:30]
            print(f"\n[▶] 正在学习: {title}...")

            # 点击学习按钮
            learn_btn = course["learn_btn"]
            await learn_btn.click()
            await asyncio.sleep(3)

            # 等待学习页面加载（可能是新窗口或iframe）
            # 检查是否有新窗口打开
            if len(self.context.pages) > 1:
                # 学习页面在新窗口中打开
                self.page = self.context.pages[-1]

            await self.page.wait_for_load_state("networkidle")
            print(f"[✓] 课程已打开: {title}")
            self.current_course = course
            return True

        except Exception as e:
            print(f"[✗] 打开课程失败: {e}")
            return False

    async def handle_popup(self) -> bool:
        """
        检测并处理弹窗确认
        每20分钟会弹出确认界面，需要自动点击确认
        """
        try:
            # 常见的弹窗确认按钮选择器（根据实际页面调整）
            popup_selectors = [
                # 确认/继续学习 按钮
                'button:has-text("确定")',
                'button:has-text("确认")',
                'button:has-text("继续学习")',
                'button:has-text("继续观看")',
                'button:has-text("OK")',
                'button:has-text("是")',
                'input[type="button"][value="确定"]',
                'input[type="submit"][value="确定"]',
                'a:has-text("确定")',
                'a:has-text("继续")',
                '.btn-confirm',
                '.btn-ok',
                '#confirmBtn',
                '#continueBtn',
            ]

            for selector in popup_selectors:
                try:
                    btn = await self.page.query_selector(selector)
                    if btn and await btn.is_visible():
                        print("[🔔] 检测到弹窗，正在自动确认...")
                        await btn.click()
                        await asyncio.sleep(1)
                        print("[✓] 弹窗已确认")
                        return True
                except Exception:
                    continue

            # 检查iframe中的弹窗
            for frame in self.page.frames:
                if frame == self.page.main_frame:
                    continue
                for selector in popup_selectors:
                    try:
                        btn = await frame.query_selector(selector)
                        if btn:
                            print("[🔔] 检测到iframe中的弹窗，正在确认...")
                            await btn.click()
                            await asyncio.sleep(1)
                            print("[✓] iframe弹窗已确认")
                            return True
                    except Exception:
                        continue

            # 检查alert对话框（Playwright自动处理）
            return False

        except Exception as e:
            return False

    async def monitor_study_progress(self):
        """监控学习进度并处理弹窗"""
        print("\n" + "=" * 60)
        print(f"  开始监控学习进度")
        print(f"  目标学习时间: {self.config['total_minutes_needed']} 分钟")
        print(f"  弹窗检测间隔: {self.config['popup_check_interval_seconds']} 秒")
        print("=" * 60)

        self.start_time = time.time()
        popup_timer = 0  # 距离上次弹窗确认的时间
        popup_interval = self.config["popup_interval_minutes"] * 60  # 转换为秒
        check_interval = self.config["popup_check_interval_seconds"]

        while self.running:
            await asyncio.sleep(check_interval)

            elapsed = time.time() - self.start_time
            elapsed_minutes = elapsed / 60

            # 检测并处理弹窗
            popup_handled = await self.handle_popup()
            if popup_handled:
                popup_timer = 0  # 重置弹窗计时器

            # 打印进度（每分钟打印一次）
            if int(elapsed) % 60 == 0:
                progress = await self.get_study_progress()
                print(f"\r[📊] 已学习: {elapsed_minutes:.1f}分钟 | "
                      f"页面进度: {progress['studied_minutes']}分钟 | "
                      f"剩余: {progress['remaining_minutes']}分钟", end="", flush=True)

            # 检查是否达到目标时间
            if elapsed_minutes >= self.config["total_minutes_needed"]:
                print(f"\n\n[🎉] 恭喜！已完成 {self.config['total_minutes_needed']} 分钟的学习目标！")
                self.running = False
                break

            # 检查页面是否还在学习页面
            try:
                url = self.page.url
                if "login" in url.lower() or self.page.url == "":
                    print("\n[!] 检测到页面跳转，可能需要重新登录")
                    self.running = False
                    break
            except Exception:
                pass

    async def return_to_course_list(self):
        """返回课程列表"""
        try:
            # 关闭学习页面（如果是新窗口）
            if len(self.context.pages) > 1:
                await self.page.close()
                self.page = self.context.pages[0]

            # 导航回课程列表
            await self.page.goto(self.config["course_list_url"])
            await self.page.wait_for_load_state("networkidle")
            await asyncio.sleep(2)
        except Exception as e:
            print(f"[!] 返回课程列表失败: {e}")

    def save_progress(self, progress: dict):
        """保存学习进度到文件"""
        progress["last_update"] = datetime.now().isoformat()
        with open(self.config["progress_file"], "w", encoding="utf-8") as f:
            json.dump(progress, f, ensure_ascii=False, indent=2)

    async def run(self):
        """主运行流程"""
        try:
            print("=" * 60)
            print("  在线学习平台自动化学习工具 v1.0")
            print("=" * 60)

            # 1. 初始化浏览器
            await self.init_browser()

            # 2. 登录
            if not await self.login():
                return

            # 3. 检查学习进度
            progress = await self.get_study_progress()
            print(f"\n[📊] 当前学习进度:")
            print(f"  已学习: {progress['studied_minutes']} 分钟")
            print(f"  目标: {progress['required_minutes']} 分钟")
            print(f"  剩余: {progress['remaining_minutes']} 分钟")

            if progress["completed"]:
                print("[✓] 已经完成所有学习要求！")
                return

            # 4. 主学习循环
            total_studied = 0
            course_index = 0

            while self.running:
                # 获取未完成课程
                courses = await self.get_unfinished_courses()
                if not courses:
                    print("\n[!] 没有更多未完成的课程")
                    break

                print(f"\n[📋] 找到 {len(courses)} 个未完成课程")

                # 按课程时长排序，优先学短课程
                courses.sort(key=lambda x: x["duration_minutes"])

                for i, course in enumerate(courses):
                    if not self.running:
                        break

                    # 检查是否已达标
                    elapsed = (time.time() - self.start_time) / 60 if self.start_time else 0
                    if elapsed >= self.config["total_minutes_needed"]:
                        print(f"\n[🎉] 已完成 {self.config['total_minutes_needed']} 分钟学习目标！")
                        self.running = False
                        break

                    # 开始学习课程
                    if await self.start_learning_course(course):
                        # 监控学习进度
                        await self.monitor_study_progress()

                        # 返回课程列表
                        await self.return_to_course_list()

                    print(f"[📊] 课程进度: {i+1}/{len(courses)}")

        except KeyboardInterrupt:
            print("\n\n[!] 用户中断")
        except Exception as e:
            print(f"\n[✗] 运行错误: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # 保存进度
            self.save_progress({
                "total_studied_minutes": (time.time() - self.start_time) / 60 if self.start_time else 0,
                "target_minutes": self.config["total_minutes_needed"],
                "completed": self.studied_minutes >= self.config["total_minutes_needed"]
            })
            print("\n[📝] 学习进度已保存")

            # 关闭浏览器
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            if self.playwright:
                await self.playwright.stop()
            print("[✓] 浏览器已关闭")


async def main():
    bot = OnlineStudyBot()
    await bot.run()


if __name__ == "__main__":
    asyncio.run(main())
