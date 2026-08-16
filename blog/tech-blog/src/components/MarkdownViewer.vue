<script setup>
// 1. 从 Vue 导入核心 API：ref (响应式数据), computed (计算属性), watch (监听器)
import { ref, computed, watch, onMounted } from "vue";
// 2. 导入全局状态管理 (Pinia 或简易 Store)
import { store } from "../store/blogData.js";
// 3. 导入 Markdown 解析库
import MarkdownIt from "markdown-it";
// 4. 导入子组件：评论系统和图片粘贴编辑器
import CommentSystem from "./CommentSystem.vue";
import ImagePasteEditor from "./ImagePasteEditor.vue";
import { useRoute, useRouter } from "vue-router";
const router = useRouter();
const route = useRoute();
const selectColumn = (colId) => {
  store.currentColId = colId;
  store.selectedArticle = null;
  router.push("/"); // 切换栏目时回到列表页
};

// 核心逻辑：根据 URL 中的 ID 加载文章
// 在 MarkdownViewer.vue 中修改
const loadArticle = async () => {
  // 检查是否是“新建”路径
  if (route.path.endsWith("/new")) {
    store.selectedArticle = {
      isNew: true,
      title: "",
      content: "",
      colId: store.columns[1]?.id ?? 0,
    };
    isEditing.value = true;
    return;
  }
  const id = parseInt(route.params.id);
  if (isNaN(id)) return;

  // 1. 如果 store 里还没数据，先等待获取列表
  if (store.articles.length === 0) {
    await store.fetchArticles(); // 确保你的 store 有这个获取列表的方法
  }

  // 2. 查找文章
  const article = store.articles.find((a) => a.id === id);

  if (article) {
    store.selectedArticle = article;
    // 3. 额外保险：如果是直接打开，可能需要获取具体内容（如果列表里只有摘要）
    await store.fetchArticleDetail(id);
  } else {
    console.error("文章不存在");
    // 如果找不到，跳转回主页
    // router.push('/')
  }
};

onMounted(async () => {
  loadArticle();
});
// 初始化 MarkdownIt 实例
// 配置说明：
// - html: true —— 允许渲染原始 HTML 标签
// - breaks: false —— 不自动将换行符转为 <br> (防止破坏列表和代码块)
// - linkify: true —— 自动将纯文本链接转为可点击的 <a> 标签
const md = new MarkdownIt({ html: true, breaks: false, linkify: true });

// 安全配置：覆盖默认的链接验证函数
// 默认情况下 markdown-it 会过滤掉 data: URI (Base64 图片)
// 这里设置为 () => true，允许所有链接，确保 Base64 图片能正常显示
md.validateLink = () => true;
const imageMap = store.imageMap; // 从全局 store 中获取 imageMap

// ───────────────────────────── 状态定义 ─────────────────────────────

// 响应式变量：控制当前是否处于编辑模式
// 初始值逻辑：如果文章是新创建的(isNew)或者带有_editing标记，则进入编辑模式
const isEditing = ref(
  store.selectedArticle?.isNew || store.selectedArticle?._editing || false
);

// 响应式变量：草稿数据 (标题、内容、分类ID)
// 使用 ?? 运算符提供默认空值，防止 undefined 错误
const draft = ref({
  title: store.selectedArticle?.title ?? "",
  content: store.selectedArticle?.content ?? "",
  // 默认分类ID：优先使用文章自带的，否则取 store.columns 的第二个 (通常不是“未分类”)
  colId: store.selectedArticle?.colId ?? store.columns[1]?.id ?? 0,
});

// MarkdownViewer.vue 专用变量：记录上一次浏览的文章 ID，用于防抖
let lastViewedId = null;

// 监听路由参数变化（处理从 /article/1 跳到 /article/2）
watch(
  () => route.path, // 监听路径全称
  (path) => {
    if (path === "/article/new") {
      // 初始化一个全新的空文章对象
      store.selectedArticle = {
        isNew: true,
        title: "",
        content: "",
        colId: store.columns[1]?.id || 0,
      };
      isEditing.value = true;
    } else if (route.params.id) {
      loadArticle(); // 加载已有文章
    }
  },
  { immediate: true }
);

// 监听器：监听 store.selectedArticle 的变化
watch(
  () => store.selectedArticle, // 监听目标
  (art) => {
    // 回调函数
    if (!art) return; // 如果没有选中文章，直接返回

    // 1. 更新编辑状态
    // 如果文章存在 isNew 或 _editing 标记，则进入编辑模式
    isEditing.value = !!(art.isNew || art._editing);

    // 2. 处理文章内容 (Content Processing)
    // 获取文章原始内容，如果为空则为空字符串
    let displayContent = art.content || "";

    // 特殊处理：如果进入编辑模式 且 内容包含 Base64 图片 (data:image/)
    if (isEditing.value && displayContent.includes("data:image/")) {
      // 正则表达式：匹配 Markdown 图片语法中的 Base64 数据
      // 捕获组1: [alt text], 捕获组2: data:image/...base64,...
      const base64Regex = /!\[(.*?)\]\((data:image\/.*?;base64,.*?)\)/g;

      // 替换逻辑：将 Base64 数据转换为浏览器临时 URL (Blob URL)
      displayContent = displayContent.replace(base64Regex, (match, alt, data) => {
        // 辅助函数：将 Base64 字符串转换为 Blob 对象
        const blob = dataURItoBlob(data);
        // 创建临时 URL，例如 blob:http://localhost:5173/xxxx-xxxx
        const blobUrl = URL.createObjectURL(blob);

        // imageMap 是一个全局 Map (代码中未显示声明，但逻辑中存在)
        // 建立 映射关系：临时URL -> 真实Base64数据
        // 这样在保存时可以通过 URL 找回原始 Base64
        imageMap.set(blobUrl, data);

        // 返回新的 Markdown 语法，图片地址替换为临时 URL
        return `![${alt}](${blobUrl})`;
      });
    }

    // 3. 更新草稿数据
    // 此时 content 里的图片已经是临时 URL (blob:http...)，编辑器可以正常显示
    draft.value = {
      title: art.title || "",
      content: displayContent,
      colId: art.colId || (store.columns[1]?.id ?? 0),
    };

    // 4. 增加阅读量 (防重复)
    // 逻辑：如果不是编辑模式 (即阅读模式) 且有 ID 且 ID 发生了变化 且 不是新文章
    if (!isEditing.value && art.id && art.id !== lastViewedId && !art.isNew) {
      lastViewedId = art.id; // 更新记录的 ID
      store.addView(art.id); // 调用 Store 方法增加阅读数
    }
  },
  { immediate: true } // 立即执行一次，确保组件加载时初始化数据
);

// 辅助函数：将 Data URI (Base64) 转换为 Blob 对象
function dataURItoBlob(dataURI) {
  // 1. 分割 Base64 头部和数据部分，atob 解码
  const byteString = atob(dataURI.split(",")[1]);
  // 2. 提取 MIME 类型，例如 image/png
  const mimeString = dataURI.split(",")[0].split(":")[1].split(";")[0];
  // 3. 创建 ArrayBuffer 并填充二进制数据
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  // 4. 返回 Blob 对象
  return new Blob([ab], { type: mimeString });
}

// 处理切换“推荐”状态的函数 (Admin Only)
const handleToggleHot = async () => {
  if (!store.selectedArticle) return; // 安全检查
  const id = store.selectedArticle.id;

  try {
    // 1. 调用 Store 的 toggleHot 方法更新后端数据
    await store.toggleHot(id);

    // 2. 重新获取更新后的文章对象
    // 因为 toggleHot 只改了状态，本地 selectedArticle 对象可能未更新
    // 需要从 store.articles 中找到最新的对象并重新赋值给 selectedArticle
    // 这样 Vue 会检测到变化并重新渲染按钮状态
    const updatedArt = store.articles.find((a) => a.id === id);
    if (updatedArt) {
      store.selectedArticle = updatedArt;
    }
  } catch (err) {
    console.error("推荐状态切换失败:", err);
  }
};

// ───────────────────────────── TOC (Table of Contents) ─────────────────────────────

// 计算属性：渲染 HTML 并注入 ID
// 目的：为文章中的标题 (h1-h6) 自动添加 id 属性，以便锚点跳转
const renderedHtml = computed(() => {
  const src = store.selectedArticle?.content || ""; // 获取文章源码
  const lines = src.split("\n"); // 按行分割

  // 1. 探测实际出现的标题级别
  // 逻辑：找出文章中实际存在的标题级别 (例如文章里只有 H2 和 H3)
  const foundLevelsSet = new Set();
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s/); // 匹配 # 到 ######
    if (match) foundLevelsSet.add(match[1].length); // 存储级别数字 (1-6)
  }

  // 2. 确定激活级别
  // 取出实际出现的级别，排序后取前两个 (例如 [2, 3])
  // 这意味着目录只显示文章中出现频率最高的前两级标题
  const activeLevels = Array.from(foundLevelsSet)
    .sort((a, b) => a - b)
    .slice(0, 2);

  // 3. 计数器 (用于生成唯一的 ID，如 heading-h2-1)
  const counters = {};

  // 4. 渲染并替换
  // 先用 markdown-it 将源码转为 HTML
  return (
    md
      .render(src)
      // 正则匹配所有 HTML 标题标签 <h1> 到 <h6>
      .replace(/<(h[1-6])([^>]*)>([\s\S]*?)<\/h[1-6]>/g, (_, tag, attrs, inner) => {
        const level = parseInt(tag.substring(1)); // 提取数字，h2 -> 2

        // 如果当前标题级别在激活列表中 (activeLevels)
        if (activeLevels.includes(level)) {
          counters[tag] = (counters[tag] || 0) + 1; // 该级别计数 +1
          const id = `heading-${tag}-${counters[tag]}`; // 生成 ID
          // 返回带 ID 的 HTML 标签
          return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
        }
        // 否则返回原样 (不加 ID)
        return `<${tag}${attrs}>${inner}</${tag}>`;
      })
  );
});

// 计算属性：预览模式下的 HTML (编辑时使用)
const previewHtml = computed(() => md.render(draft.value.content || ""));

// 响应式变量：控制是否显示预览
const showPreview = ref(false);

// 计算属性：生成目录项 (tocItems)
const tocItems = computed(() => {
  const content = store.selectedArticle?.content || "";
  const lines = content.split("\n");
  const rawHeadings = []; // 存储原始标题数据
  const foundLevelsSet = new Set();

  // 1. 扫描所有行，提取标题文字和级别
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)/); // 匹配 # 标题文字
    if (m) {
      const lvl = m[1].length; // 标题级别 (1-6)
      foundLevelsSet.add(lvl);
      rawHeadings.push({ lvl, text: m[2].trim() }); // 存储级别和文字
    }
  }

  // 2. 处理级别逻辑 (同上，取前两级实际出现的级别)
  const sortedLevels = Array.from(foundLevelsSet).sort((a, b) => a - b);
  const activeLevels = sortedLevels.slice(0, 2);

  // 3. 构建最终的目录项
  const items = [];
  const counters = {};
  rawHeadings.forEach((h) => {
    // 找到当前级别在 activeLevels 中的位置 (0 或 1)
    const levelIndex = activeLevels.indexOf(h.lvl);
    if (levelIndex !== -1) {
      const tag = `h${h.lvl}`;
      counters[tag] = (counters[tag] || 0) + 1;
      items.push({
        level: levelIndex + 1, // 转换为目录层级 (1级或2级)
        text: h.text,
        id: `heading-${tag}-${counters[tag]}`,
      });
    }
  });
  return items;
});

// 响应式变量：记录当前滚动到的标题 ID (用于高亮)
const activeHeading = ref("");

// 滚动函数：点击目录项时，平滑滚动到对应标题
const scrollToHeading = (id) => {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    activeHeading.value = id; // 更新高亮状态
  }
};

// ───────────────────────────── .md 文件导入系统 ─────────────────────────────

// 模板引用：用于触发隐藏的文件输入框
const mdFileInput = ref(null);
const imgFolderInput = ref(null);

// 导入状态管理
const rawMdText = ref(""); // 暂存读取到的原始 Markdown 文本
const pendingImages = ref([]); // 存储 Markdown 中引用的图片路径列表
const missingImages = ref([]); // 存储未找到的图片列表
const importStatus = ref(""); // 状态：'' | 'waiting-images' | 'done'

// 第一步：处理 .md 文件选择
const onMdFileChange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    rawMdText.value = text; // 1. 存储原始文本

    // 2. 自动生成标题 (去掉 .md 后缀)
    if (!draft.value.title) draft.value.title = file.name.replace(/\.md$/i, "");

    // 3. 提取所有图片路径
    // 正则匹配：![...](path) 或 ![...](path with spaces)
    // 支持带空格的文件名：匹配括号内非右括号、非引号的所有字符（含空格），并去掉首尾空白
    const imgRegex = /!\[[^\]]*\]\(([^)"]+)/g;
    const paths = [];
    let m;
    while ((m = imgRegex.exec(text)) !== null) {
      const p = m[1].trim(); // trim 去掉路径首尾可能的空白
      // 过滤掉网络链接 (http) 和 Base64 数据，只处理本地路径
      if (!p.startsWith("http") && !p.startsWith("data:")) {
        paths.push(p);
      }
    }
    pendingImages.value = [...new Set(paths)]; // 去重

    // 4. 判断处理流程
    if (pendingImages.value.length === 0) {
      // 情况 A：没有本地图片，直接写入草稿
      draft.value.content = text;
      importStatus.value = "done";
      missingImages.value = [];
    } else {
      // 情况 B：有本地图片，等待用户选择图片文件夹
      importStatus.value = "waiting-images";
      draft.value.content = text; // 先写入文本，图片稍后替换
    }
  };
  reader.readAsText(file, "UTF-8");
  e.target.value = ""; // 清空 input，允许重复选择同一文件
};

// 第二步：处理图片文件夹选择
const onImgFolderChange = async (e) => {
  const files = Array.from(e.target.files); // 获取文件夹内所有文件
  if (!files.length) return;

  // 建立 文件名 -> File 对象 的映射表 (不区分大小写)
  const fileMap = new Map();
  for (const f of files) {
    if (f.type.startsWith("image/")) {
      fileMap.set(f.name.toLowerCase(), f);
    }
  }

  let content = rawMdText.value; // 从原始文本开始处理
  const missing = []; // 记录未找到的图片

  // 遍历 Markdown 中引用的每一个图片路径
  for (const imgPath of pendingImages.value) {
    // 提取文件名 (兼容 / 和 \ 路径分隔符)
    const fileName = imgPath.split(/[/\\]/).pop().toLowerCase();
    const imgFile = fileMap.get(fileName);

    if (imgFile) {
      // 找到图片：上传到服务器 (R2)
      const formData = new FormData();
      // 关键修改 2：在上传时重命名文件，去掉空格
      // 方案 A：把空格替换为下划线（推荐，更美观）
      const cleanName = imgFile.name.replace(/\s+/g, "_");

      // 注意：为了保证后端能正确识别文件，我们需要创建一个新的 File 对象
      const renamedFile = new File([imgFile], cleanName, { type: imgFile.type });
      formData.append("image", renamedFile);

      // 发送上传请求
      const res = await fetch("https://blogapi.wangaijun.click/api/upload", {
        method: "POST",
        headers: {
          Authorization: localStorage.getItem("blog_admin_token"),
        },
        body: formData,
      });
      const data = await res.json();

      // 4. 替换文本：将本地路径替换为服务器返回的远程 URL
      // 对路径进行转义，同时兼容路径中含空格的情况（空格在正则中用 \s* 宽容匹配）
      const escaped = imgPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // 使用字符串 split/join 替换，避免正则对空格的歧义问题
      content = content.split(imgPath).join(data.url);
    } else {
      // 未找到图片，加入缺失列表
      missing.push(imgPath);
    }
  }

  // 更新草稿内容和状态
  draft.value.content = content;
  missingImages.value = missing;
  importStatus.value = "done";
  e.target.value = "";
};

// 跳过图片导入 (直接使用原始文本，不管图片是否存在)
const skipImages = () => {
  draft.value.content = rawMdText.value;
  importStatus.value = "done";
  missingImages.value = pendingImages.value.slice(); // 标记所有为缺失
};

// ───────────────────────────── 保存逻辑 ─────────────────────────────

// 保存函数
const save = async () => {
  // 1. 前端校验
  if (!draft.value.title.trim()) return alert("请输入文章标题");
  if (!draft.value.content.trim()) return alert("请输入文章内容");

  // 2. 确定文章状态：优先看路径，其次看 store
  const isNewArticle = route.path.endsWith("/new") || !!store.selectedArticle?.isNew;

  // 3. 还原 Base64 数据 (保持原有逻辑)
  let finalContent = draft.value.content;
  imageMap.forEach((base64, blobUrl) => {
    finalContent = finalContent.split(blobUrl).join(base64);
  });

  try {
    if (isNewArticle) {
      // 新建文章逻辑
      await store.publishArticle({
        ...draft.value,
        content: finalContent,
      });
      // 发布成功后跳转回列表或具体页面
      router.push("/");
    } else {
      // 更新文章逻辑
      const articleId = store.selectedArticle?.id || parseInt(route.params.id);
      if (!articleId) throw new Error("无法确定文章 ID");

      await store.updateArticle({
        id: articleId,
        ...draft.value,
        content: finalContent,
      });

      const latestData = await store.fetchArticleDetail(articleId);
      store.selectedArticle = latestData;
      isEditing.value = false;
    }

    store.clearImageMap();
    importStatus.value = "";
    missingImages.value = [];
  } catch (err) {
    alert("保存失败: " + err.message);
  }
};

// 取消编辑
const cancelEdit = () => {
  importStatus.value = "";
  missingImages.value = [];
  if (store.selectedArticle?.isNew) {
    store.selectedArticle = null;
    selectColumn(store.currentColId);
  }
  // 新建时取消则删除草稿
  else isEditing.value = false; // 否则仅退出编辑模式
};

// MarkdownViewer.vue

const startEdit = () => {
  let content = store.selectedArticle?.content ?? "";

  // 核心修复：手动执行一次图片转换逻辑
  if (content.includes("data:image/")) {
    const base64Regex = /!\[(.*?)\]\((data:image\/.*?;base64,.*?)\)/g;
    content = content.replace(base64Regex, (match, alt, data) => {
      const blob = dataURItoBlob(data); // 确保这个函数在作用域内
      const blobUrl = URL.createObjectURL(blob);
      imageMap.set(blobUrl, data); // 存入映射表以便保存时还原
      return `![${alt}](${blobUrl})`;
    });
  }

  draft.value = {
    title: store.selectedArticle?.title ?? "",
    content: content, // 使用转换后的内容
    colId: store.selectedArticle?.colId ?? 0,
  };

  importStatus.value = "";
  missingImages.value = [];
  isEditing.value = true;
};

// ───────────────────────────── 复制链接 ─────────────────────────────
const copyLinkState = ref("idle"); // 'idle' | 'copied'

const copyLink = async () => {
  const id = store.selectedArticle?.id;
  if (!id) return;
  const url = `${window.location.origin}/article/${id}`;
  try {
    await navigator.clipboard.writeText(url);
    copyLinkState.value = "copied";
    setTimeout(() => {
      copyLinkState.value = "idle";
    }, 2000);
  } catch {
    prompt("复制以下链接：", url);
  }
};
</script>

<template>
  <div class="h-full flex flex-col bg-white">
    <!-- Top bar -->
    <div
      class="h-11 border-b border-gray-200 flex items-center px-5 justify-between bg-gray-50 flex-shrink-0"
    >
      <button
        @click="selectColumn(store.currentColId)"
        class="flex items-center gap-1.5 text-gray-500 text-[13px] hover:text-[#4caf50] transition"
      >
        ← 返回列表
      </button>

      <div class="flex items-center gap-2">
        <template v-if="store.isAdmin && isEditing">
          <!-- 第一步：选 .md 文件 -->
          <button
            @click="mdFileInput.click()"
            class="flex items-center gap-1 text-[12px] text-gray-500 hover:text-[#4caf50] border border-gray-300 hover:border-[#4caf50] px-3 py-1 rounded transition"
          >
            📄 导入 .md 文件
          </button>
          <input
            type="file"
            ref="mdFileInput"
            accept=".md,.markdown,text/markdown"
            @change="onMdFileChange"
            class="hidden"
          />
          <!-- 第二步隐藏 input（文件夹选择） -->
          <input
            type="file"
            ref="imgFolderInput"
            webkitdirectory
            multiple
            accept="image/*"
            @change="onImgFolderChange"
            class="hidden"
          />

          <button
            @click="showPreview = !showPreview"
            class="text-[12px] border px-3 py-1 rounded transition"
            :class="
              showPreview
                ? 'bg-green-50 border-[#4caf50] text-[#4caf50]'
                : 'border-gray-300 text-gray-500 hover:border-gray-400'
            "
          >
            {{ showPreview ? "编辑模式" : "预览" }}
          </button>
          <button
            @click="cancelEdit"
            class="text-[12px] border border-gray-300 text-gray-500 hover:border-gray-400 px-3 py-1 rounded transition"
          >
            取消
          </button>
          <button
            @click="save"
            class="text-[12px] bg-[#4caf50] text-white font-semibold px-4 py-1 rounded hover:bg-[#43a047] transition"
          >
            保存发布
          </button>
        </template>

        <!-- 复制链接按钮：阅读模式下始终显示 -->
        <button
          v-if="!isEditing && store.selectedArticle && !store.selectedArticle.isNew"
          @click="copyLink"
          class="text-[12px] border px-3 py-1 rounded transition flex items-center gap-1"
          :class="
            copyLinkState === 'copied'
              ? 'border-[#4caf50] text-[#4caf50] bg-green-50'
              : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700'
          "
        >
          {{ copyLinkState === "copied" ? "✓ 已复制" : "🔗 复制链接" }}
        </button>

        <template
          v-if="
            store.isAdmin &&
            !isEditing &&
            store.selectedArticle &&
            !store.selectedArticle.isNew
          "
        >
          <button
            @click="handleToggleHot"
            class="text-[12px] border px-3 py-1 rounded transition"
            :class="
              store.selectedArticle.isHot
                ? 'border-orange-300 text-orange-500 bg-orange-50'
                : 'border-gray-300 text-gray-500 hover:text-orange-500 hover:border-orange-300'
            "
          >
            {{ store.selectedArticle.isHot ? "🔥 已推荐" : "设为推荐" }}
          </button>
          <button
            @click="startEdit"
            class="text-[12px] border border-gray-300 text-gray-500 hover:border-[#4caf50] hover:text-[#4caf50] px-3 py-1 rounded transition"
          >
            编辑文章
          </button>
        </template>
      </div>
    </div>

    <!-- ── 图片导入提示横幅 ── -->
    <!-- 等待选择图片文件夹 -->
    <div
      v-if="importStatus === 'waiting-images'"
      class="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-center justify-between gap-4 flex-shrink-0"
    >
      <div class="text-[13px] text-amber-800">
        <span class="font-semibold">检测到 {{ pendingImages.length }} 张本地图片</span>
        ，请选择图片所在文件夹（整个文件夹），将自动嵌入文章。
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button
          @click="imgFolderInput.click()"
          class="text-[12px] bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600 transition font-semibold"
        >
          📁 选择图片文件夹
        </button>
        <button
          @click="skipImages"
          class="text-[12px] border border-amber-300 text-amber-700 px-3 py-1 rounded hover:bg-amber-100 transition"
        >
          跳过
        </button>
      </div>
    </div>

    <!-- 处理完成 + 缺失提示 -->
    <div
      v-if="importStatus === 'done' && missingImages.length > 0"
      class="bg-red-50 border-b border-red-200 px-5 py-2.5 flex items-start gap-3 flex-shrink-0"
    >
      <span class="text-red-500 text-sm flex-shrink-0">⚠️</span>
      <div class="text-[12px] text-red-700">
        <span class="font-semibold">以下图片未找到，将显示为损坏图标：</span>
        <span class="ml-1">{{ missingImages.join("、") }}</span>
        <button
          @click="imgFolderInput.click()"
          class="ml-3 underline text-red-600 hover:text-red-800"
        >
          重新选择文件夹
        </button>
      </div>
    </div>

    <!-- 处理完成无缺失 -->
    <div
      v-if="
        importStatus === 'done' && missingImages.length === 0 && pendingImages.length > 0
      "
      class="bg-green-50 border-b border-green-200 px-5 py-2 flex items-center gap-2 flex-shrink-0"
    >
      <span class="text-green-600 text-sm">✅</span>
      <span class="text-[12px] text-green-700 font-medium"
        >{{ pendingImages.length }} 张图片已全部嵌入</span
      >
    </div>

    <!-- 主要内容区域 -->
    <div class="flex-1 flex flex-col overflow-y-auto">
      <!-- EDIT MODE (编辑模式) -->
      <!-- 当 isEditing 为 true 时显示 -->
      <div
        v-if="isEditing"
        class="flex-1 flex flex-col min-h-0 bg-gray-50 border border-gray-200 rounded px-4 py-2 text-xl font-bold outline-none focus:border-[#4caf50] transition"
      >
        <!-- 标题输入框和分类选择框 -->
        <div class="flex gap-3 items-center flex-wrappx-4 py-3 flex-shrink-0">
          <!-- 双向绑定 draft.title -->
          <input
            v-model="draft.title"
            class="flex-1 min-w-0 text-2xl font-bold border-b border-gray-300 focus:border-[#4caf50] outline-none text-gray-900 py-1 placeholder-gray-300 transition bg-transparent"
            placeholder="文章标题..."
          />

          <!-- 分类下拉框 -->
          <!-- 双向绑定 draft.colId -->
          <!-- 过滤掉 id 为 0 的分类 (通常代表 '未分类' 或无效项) -->
          <select
            v-model="draft.colId"
            class="bg-white border border-gray-300 text-gray-600 text-[13px] px-3 py-2 rounded outline-none focus:border-[#4caf50]"
          >
            <option
              v-for="c in store.columns.filter((i) => i.id !== 0)"
              :key="c.id"
              :value="c.id"
            >
              {{ c.name }}
            </option>
          </select>
        </div>

        <!-- 编辑器主体布局 -->
        <!-- 使用 flex 布局实现左右分栏 -->
        <div class="flex-1 flex gap-4 min-h-0 px-4 pb-4">
          <div class="flex-1 flex flex-col min-h-0">
            <ImagePasteEditor v-model="draft.content" class="flex-1" />
          </div>

          <!-- 右侧：实时预览区 (仅当 showPreview 为 true 时显示) -->
          <div
            v-if="showPreview"
            class="flex-1 overflow-y-auto border border-gray-200 rounded bg-white px-6 py-5 markdown-body"
          >
            <!-- v-html 渲染 previewHtml 计算属性生成的 HTML -->
            <div v-html="previewHtml"></div>
          </div>
        </div>
      </div>

      <!-- READ MODE (阅读模式) -->
      <!-- 当 isEditing 为 false 时显示 -->
      <div v-else class="flex h-full">
        <!-- 文章主体 -->
        <div class="flex-1 overflow-y-auto relative" id="article-scroll-container">
          <div class="max-w-5xl mx-auto px-8 py-10">
            <!-- 文章标题 -->
            <h1 class="text-3xl font-extrabold text-gray-900 leading-tight mb-3">
              {{ store.selectedArticle?.title }}
            </h1>

            <!-- 文章元信息 (日期、阅读量) -->
            <div class="flex items-center gap-3 text-[12px] text-gray-400 mb-10">
              <span>{{ store.selectedArticle?.date }}</span>
              <span>·</span>
              <span>{{ store.selectedArticle?.views }} 阅读</span>
            </div>

            <!-- 渲染文章内容 -->
            <!-- 使用 v-html 渲染经过处理的 HTML (包含 ID 锚点) -->
            <div v-html="renderedHtml" class="markdown-body"></div>

            <!-- 评论系统组件 -->
            <CommentSystem />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 基础样式类 */
.markdown-body {
  color: #374151;
  font-size: 15px;
  line-height: 2.2rem;
  font-size: 1rem;
}

/* 标题样式 */
.markdown-body h1 {
  font-size: 1.75rem;
  font-weight: 600;
  margin: 1.75rem 0;
  color: #111827;
}
/* --- 修改：段落首行缩进 --- */
.markdown-body p {
  margin: 0rem 0;
  font-weight: 300;
  text-indent: 2em; /* 缩进两个字符 */
  text-align: justify; /* 建议配合两端对齐，排版更整齐 */
}

/* 排除掉包含图片的段落（可选），防止图片位置偏移 */
.markdown-body p:has(img) {
  text-indent: 0;
}

/* 标题样式 - 标题通常不缩进 */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  text-indent: 0;
}
.markdown-body h2 {
  font-size: 1.4rem;
  font-weight: 500;
  margin: 1.5rem 0 1rem;
  color: #1f2937;
  border-bottom: 2px solid #e5e7eb;
  /* H2 下方加分割线 */
  padding-bottom: 6px;
}

.markdown-body h3 {
  font-size: 1.15rem;
  font-weight: 400;
  margin: 1.25rem 0 0.75rem;
  color: #374151;
}

/* 段落间距 */
.markdown-body p {
  margin: 1.15 rem 0;
}
/* 核心修复：引用（Blockquote）渲染样式 */
.markdown-body blockquote {
  margin: 16px 0;
  padding: 0 15px;
  color: #6a737d;
  border-left: 6px solid #0ca92b; /* 经典的灰色左边框 */
  background-color: #f9f9f9; /* 浅灰色背景 */
}
/* 引用内的文字通常不缩进，或者根据需求决定 */
.markdown-body blockquote p {
  text-indent: 0;
}
/* 链接样式：绿色下划线 */
.markdown-body a {
  color: #4caf50;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* 强调与行内代码 */
.markdown-body strong {
  color: #111827;
  font-weight: 600;
}

.markdown-body em {
  font-style: italic;
}

/* 行内代码块样式：绿色背景 */
.markdown-body code {
  background: #f0fdf4;
  color: #16a34a;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 15px;
  font-family: "JetBrains Mono", monospace;
}

/* 代码块容器 */
.markdown-body pre {
  background: #e8edf9;
  color: #06f85f;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 18px 20px;
  margin: 18px 0;

  /* 核心：处理换行 */
  white-space: pre-wrap; /* 保留空格并允许自动换行 */
  word-wrap: break-word; /* 兼容旧浏览器 */
  word-break: break-all; /* 强制在任何字符间断行，防止长字符串溢出 */
  overflow-x: hidden; /* 既然换行了，通常就不需要横向滚动条了 */
}

/* 代码块内的文字 */
.markdown-body pre code {
  background: none;
  color: #03523b;
  padding: 0;
  font-size: 18px;
  text-indent: 0; /* 必须确保代码内不缩进 */
}

/* 图片样式优化 */
.markdown-body img {
  /* 核心：确保图片宽度自适应，最大不超过正文宽度 */
  max-width: 100%;
  height: auto; /* 保持纵横比 */

  /* 布局：居中显示 */
  display: block;
  margin: 20px auto;

  /* 美化：圆角、边框和阴影 */
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);

  /* 交互：缩进排除 */
  text-indent: 0; /* 确保图片不受父级 p 标签首行缩进的影响 */
}

/* 针对移动端的微调 */
@media (max-width: 640px) {
  .markdown-body img {
    max-width: 100%;
    border-radius: 4px; /* 小屏上圆角稍微调小更协调 */
    margin: 15px auto;
  }
}

/* 列表样式 */
.markdown-body ul {
  list-style: disc;
  padding-left: 1.6em;
  margin: 12px 0;
  text-indent: 0;
  font-weight: 300;
}

.markdown-body ol {
  list-style: decimal;
  padding-left: 1.6em;
  font-weight: 300;
  margin: 12px 0;
  text-indent: 0;
}

.markdown-body li {
  margin: 5px 0;
  text-indent: 0;
  font-weight: 300;
}

/* 分割线 */
.markdown-body hr {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 24px 0;
}

/* 表格样式 */
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 20px 0;
  font-size: 15px;
  font-weight: 300;
}

.markdown-body th {
  background: #f0fdf4;
  color: #16a34a;
  padding: 10px 14px;
  text-align: left;
  border: 1px solid #d1fae5;
}

.markdown-body td {
  padding: 8px 14px;
  border: 1px solid #e5e7eb;
  color: #374151;
}

/* 偶数行背景色 */
.markdown-body tr:nth-child(even) td {
  background: #f9fafb;
}
</style>
