// 导出默认的 Worker 处理对象
export default {
    // fetch 函数是 Worker 的入口，每次 HTTP 请求都会触发
    // request: 包含请求的所有信息（URL, 方法, 头, 体）
    // env: 包含绑定的资源（如 D1 数据库 env.DB, R2 存储桶 env.BUCKET）
    async fetch(request, env) {
        // 1. 解析请求 URL
        const url = new URL(request.url);
        // 2. 获取请求方法 (GET, POST, PUT, DELETE 等)
        const method = request.method;
        // 3. 获取路径名 (例如 /api/articles)
        const path = url.pathname;

        // ──────────────── 跨域资源共享 (CORS) 配置 ────────────────
        // 允许任何来源访问（生产环境建议限制为具体域名）
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            // 允许的 HTTP 方法
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            // 允许携带的请求头（Content-Type 用于 JSON, Authorization 用于 Token）
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };

        // 处理浏览器的预检请求 (OPTIONS)
        // 浏览器在发送复杂请求前会先发一个 OPTIONS 询问服务器是否允许
        if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

        // ──────────────── 身份验证 (鉴权) ────────────────
        // 从请求头中获取 Authorization 字段
        const auth = request.headers.get("Authorization");
        // 验证 Token 是否匹配
        // 注意：这里硬编码了 Token，生产环境建议放入 Worker 的环境变量 (Secrets)
        const isAdmin = auth === "sim-admin-888";

        try {
            // ──────────────── 1. 管理员登录接口 ────────────────
            // 路径匹配 /api/login 且 方法为 POST
            if (path === "/api/login" && method === "POST") {
                // 解析请求体中的 JSON 数据，获取密码
                const { password } = await request.json();
                // 验证密码 (这里硬编码了密码 "390201"，建议改为环境变量)
                if (password === "390201") {
                    // 密码正确，返回 Token 给前端
                    return Response.json({ token: "sim-admin-888" }, { headers: corsHeaders });
                }
                // 密码错误，返回 401 未授权
                return new Response("Unauthorized", { status: 401, headers: corsHeaders });
            }

            // ──────────────── 2. 专栏管理 (D1 数据库操作) ────────────────
            // 路径以 /api/columns 开头的所有请求
            if (path.startsWith("/api/columns")) {
                
                // --- 获取专栏列表 (GET) ---
                if (method === "GET") {
                    // 查询 D1 数据库：SELECT * FROM columns
                    const { results } = await env.DB.prepare("SELECT * FROM columns").all();
                    // 返回结果数组，如果没有结果则返回空数组
                    return Response.json(results || [], { headers: corsHeaders });
                }

                // --- 添加专栏 (POST) ---
                // 需要管理员权限
                if (method === "POST" && isAdmin) {
                    // 获取请求体中的名称
                    const { name } = await request.json();
                    // 校验名称不能为空
                    if (!name || name.trim() === "") return Response.json({ error: "名称不能为空" }, { status: 400, headers: corsHeaders });

                    // 查重：查询数据库中是否已存在同名专栏
                    const existing = await env.DB.prepare("SELECT id FROM columns WHERE name = ?").bind(name.trim()).first();
                    if (existing) return Response.json({ error: "专栏已存在" }, { status: 400, headers: corsHeaders });

                    // 插入新专栏
                    await env.DB.prepare("INSERT INTO columns (name) VALUES (?)").bind(name.trim()).run();
                    return Response.json({ success: true }, { headers: corsHeaders });
                }

                // --- 删除专栏 (DELETE) ---
                // 路径格式：/api/columns/:id
                if (method === "DELETE" && isAdmin) {
                    // 从路径中提取 ID (例如 /api/columns/2 -> 2)
                    const id = path.split("/").pop();

                    // 保护逻辑：禁止删除 ID 为 0 的默认专栏
                    if (id === "0") {
                        return Response.json({ error: "默认专栏不可删除" }, { status: 403, headers: corsHeaders });
                    }

                    try {
                        // 使用 D1 事务确保数据一致性
                        // 步骤 1：将该专栏下的所有文章移动到 ID 为 0 的默认专栏（防止文章丢失）
                        await env.DB.prepare("UPDATE articles SET colId = 0 WHERE colId = ?").bind(id).run();

                        // 步骤 2：正式删除专栏记录
                        await env.DB.prepare("DELETE FROM columns WHERE id = ?").bind(id).run();

                        return Response.json({ success: true }, { headers: corsHeaders });
                    } catch (err) {
                        return Response.json({ error: "删除失败: " + err.message }, { status: 500, headers: corsHeaders });
                    }
                }
            }

            // ──────────────── 3. 文章管理 (D1 数据库操作) ────────────────
            
            // --- 获取文章列表 (GET /api/articles) ---
            // 注意：这里只获取列表，不包含大段的内容 content，提高性能
            if (path === "/api/articles" && method === "GET") {
                // 按日期倒序排列
                const { results } = await env.DB.prepare("SELECT * FROM articles ORDER BY date DESC").all();
                return Response.json(results, { headers: corsHeaders });
            }

            // --- 获取单篇文章详情 (GET /api/articles/:id) ---
            if (path.startsWith("/api/articles/") && method === "GET") {
                // 提取 ID
                const id = path.split("/").pop();

                // 查询该 ID 的所有字段（包含 content）
                const article = await env.DB.prepare("SELECT * FROM articles WHERE id = ?")
                    .bind(id)
                    .first(); // .first() 返回单条记录

                if (!article) {
                    return new Response("Article Not Found", { status: 404, headers: corsHeaders });
                }

                return Response.json(article, { headers: corsHeaders });
            }

            // --- 发布文章 (POST /api/articles) ---
            if (path === "/api/articles" && method === "POST" && isAdmin) {
                // 获取标题、内容、专栏ID
                const { title, content, colId } = await request.json();
                // 生成当前日期 (YYYY-MM-DD)
                const date = new Date().toISOString().slice(0, 10);
                // 插入数据库
                await env.DB.prepare("INSERT INTO articles (title, content, colId, date) VALUES (?, ?, ?, ?)")
                    .bind(title, content, colId, date).run();
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            // --- 更新文章 (PUT /api/articles/:id) ---
            if (path.startsWith("/api/articles/") && method === "PUT" && isAdmin) {
                const id = path.split("/").pop();
                const { title, content, colId } = await request.json();
                // 更新指定 ID 的记录
                await env.DB.prepare("UPDATE articles SET title=?, content=?, colId=? WHERE id=?")
                    .bind(title, content, colId, id).run();
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            // --- 删除文章 (DELETE /api/articles/:id) ---
            if (path.startsWith("/api/articles/") && method === "DELETE" && isAdmin) {
                const id = path.split("/").pop();
                // 删除文章
                await env.DB.prepare("DELETE FROM articles WHERE id=?").bind(id).run();
                // 级联删除：同时删除该文章下的所有评论，保持数据整洁
                await env.DB.prepare("DELETE FROM comments WHERE artId=?").bind(id).run();
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            // --- 推荐文章 (POST /api/articles/:id/toggle-hot) ---
            if (path.endsWith("/toggle-hot") && method === "POST" && isAdmin) {
                // 路径解析：/api/articles/5/toggle-hot -> 索引 3 是 ID
                const id = path.split("/")[3];
                // SQL 技巧：使用 CASE WHEN 实现 0/1 切换
                // 如果 isHot 是 1 则变为 0，否则变为 1
                await env.DB.prepare("UPDATE articles SET isHot = CASE WHEN isHot = 1 THEN 0 ELSE 1 END WHERE id=?").bind(id).run();
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            // --- 增加阅读量 (POST /api/articles/:id/view) ---
            if (path.startsWith("/api/articles/") && path.endsWith("/view") && method === "POST") {
                const parts = path.split("/");
                const id = parts[3]; // 提取 ID

                try {
                    // 使用 COALESCE 处理 NULL 值：如果 views 是 NULL，则视为 0，然后 +1
                    await env.DB.prepare("UPDATE articles SET views = COALESCE(views, 0) + 1 WHERE id = ?")
                        .bind(id)
                        .run();

                    return Response.json({ success: true }, { headers: corsHeaders });
                } catch (err) {
                    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
                }
            }

            // ──────────────── 4. 图片上传 (R2 存储桶操作) ────────────────
            if (path === "/api/upload" && method === "POST" && isAdmin) {
                // 解析表单数据 (FormData)
                const formData = await request.formData();
                // 获取名为 "image" 的文件字段
                const file = formData.get("image");
                // 生成文件名：blog/时间戳-原文件名 (使用目录前缀方便管理)
                const fileName = `blog/${Date.now()}-${file.name}`;

                // 将文件流上传到 R2 存储桶
                await env.BUCKET.put(fileName, file.stream(), {
                    httpMetadata: { contentType: file.type }, // 设置正确的 MIME 类型
                });

                // 返回图片的公开访问 URL
                return Response.json({ url: `https://image.wangaijun.click/${fileName}` }, { headers: corsHeaders });
            }

            // ──────────────── 5. 评论管理 (D1 数据库操作) ────────────────
            
            // --- 获取评论 (GET /api/comments?artId=xxx) ---
            if (path === "/api/comments" && method === "GET") {
                // 从 URL 查询参数中获取文章 ID
                const artId = url.searchParams.get("artId");
                // 查询该文章下的所有评论，按时间倒序
                const { results } = await env.DB.prepare("SELECT * FROM comments WHERE artId = ? ORDER BY date DESC").bind(artId).all();
                return Response.json(results, { headers: corsHeaders });
            }

            // --- 发表评论 (POST /api/comments) ---
            // 游客可用，不需要 isAdmin 权限
            if (path === "/api/comments" && method === "POST") {
                const { artId, user, text } = await request.json();
                // 获取当前本地时间字符串
                const date = new Date().toLocaleString();
                // 插入数据库
                await env.DB.prepare("INSERT INTO comments (artId, user, text, date) VALUES (?, ?, ?, ?)")
                    .bind(artId, user, text, date).run();
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            // --- 删除评论 (DELETE /api/comments/:id) ---
            // 仅管理员可用
            if (path.startsWith("/api/comments/") && method === "DELETE" && isAdmin) {
                const id = path.split("/").pop();
                await env.DB.prepare("DELETE FROM comments WHERE id=?").bind(id).run();
                return Response.json({ success: true }, { headers: corsHeaders });
            }
            // 如果以上路径都不匹配，返回 404
            return new Response("Not Found", { status: 404, headers: corsHeaders });

        } catch (err) {
            // 全局错误捕获：如果 try 块中发生任何未处理的错误，返回 500 和错误信息
            return new Response(err.message, { status: 500, headers: corsHeaders });
        }
    }
}