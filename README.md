# simulation-lab-web 实验仿真平台网站源代码

船舶/工业自动化与电气**仿真实验 Web 端**源代码集合。各实验模块源码均收录于本仓库，仅部分 blog / 支付项目在独立仓库中维护。

## 目录结构

| 目录 | 内容 |
|---|---|
| `lab_01` ~ `lab_07` | 各类仿真实验模块（传感器、控制回路、CAN、电路仿真等） |
| `blog/` | 博客类应用（`my-blog` 前端、`tech-blog` API Worker、`todo-app` Demo） |
| `claude` | 测试用素材 |
| `temp` | 临时草稿/原型（lab 副本等） |
| `lastproj` | 早期项目汇总（consys/digital 等） |
| `cloudflare d1和r2.js` | Cloudflare D1/R2 配置参考片段 |

> `lab-simulator-pay` 仍在独立仓库中维护，未收录进本仓库。

## 独立仓库

- <https://github.com/nthq2004/lab-simulator-pay>

## 本地开发

各实验模块为独立的 Vue/Vite 前端应用：

```bash
cd lab_05/mmuse01     # 示例：进入某个模块
npm install
npm run dev
```

构建产物、依赖与本地环境变量均由 `.gitignore` 排除，请勿提交。（`tools/api.mk` 中的 API 密钥已在仓库内替换为占位符，使用前请填入自己的密钥。）

## 注意事项

- 本仓库不含任何密钥、Token 或 `.env` 文件；请保持这一惯例。
- 仓库内文件名含中文与较长路径，Windows 下 clone 前建议开启 `git config core.longpaths true`。