# simulation-lab-web 实验仿真平台网站源代码

船舶/工业自动化与电气**仿真实验 Web 端**源代码集合。本仓库收录尚未独立维护的各实验模块源码，已独立维护的项目请见下方独立仓库列表。

## 目录结构

| 目录 | 内容 |
|---|---|
| `lab_03` ~ `lab_07` | 各类仿真实验模块（传感器、控制回路、电路仿真等） |
| `blog/todo-app` | 待办事项 Demo 应用 |
| `claude` | 测试用素材 |
| `temp` | 临时草稿/原型（lab 副本等） |
| `lastproj` | 早期项目汇总（consys/digital 等） |
| `cloudflare d1和r2.js` | Cloudflare D1/R2 配置参考片段 |

> `lab_01`、`lab_02`、`lab-simulator-pay`、`blog/my-blog`、`blog/tech-blog` 已在独立仓库中维护，未收录进本仓库。

## 独立仓库

- <https://github.com/nthq2004/lab_01>
- <https://github.com/nthq2004/lab_02>
- <https://github.com/nthq2004/lab-simulator-pay>
- <https://github.com/nthq2004/my-blog>
- <https://github.com/nthq2004/blog>

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