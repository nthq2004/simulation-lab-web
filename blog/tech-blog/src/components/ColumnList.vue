<script setup>
// 1. 从 Vue 引入 computed 用于处理响应式计算属性
import { computed, watch } from "vue";
// 2. 引入全局状态管理 store
import { store } from "../store/blogData.js";
import { useRoute, useRouter } from "vue-router";

const router = useRouter();
const route = useRoute();
const isDetail = computed(() => !!route.params.id);

// 监听路由路径
watch(
  () => route.path,
  (newPath) => {
    // 如果回到首页（列表页），清空选中的文章，让侧边栏恢复显示专题
    if (newPath === "/" || newPath === "/index.html") {
      store.selectedArticle = null;
    }
  }
);
// 修改 Logo 点击事件或导航点击事件
const goHome = () => {
  store.selectedArticle = null;
  store.currentColId = 0;
  router.push("/"); // 强制跳转回根路径
};

// 如果你想让导航条点击也支持路由（可选）
const selectColumn = (colId) => {
  store.currentColId = colId;
  store.selectedArticle = null;
  router.push("/"); // 切换栏目时回到列表页
};
// ==========================================
// 专栏管理逻辑 (增、改、删)
// ==========================================

// 添加新专栏的函数
const addCol = () => {
  // 弹出输入框提示用户输入名称
  const name = prompt("输入新专栏名称:");
  // 如果用户输入了内容（非空且非取消），调用 store 方法添加专栏
  // ?. 是可选链，trim() 去除首尾空格
  if (name?.trim()) store.addColumn(name.trim());
};

// 编辑（重命名）专栏的函数，接收当前专栏对象 col
const editCol = (col) => {
  // 弹出输入框，默认值为当前专栏名称
  const name = prompt("重命名专栏:", col.name);
  // 如果用户输入了新名称，调用 store 方法更新
  if (name?.trim()) store.renameColumn(col.id, name.trim());
};

// 删除专栏的函数，接收专栏 ID
const delCol = (id) => {
  // 弹出确认框，提示删除后果（文章归入默认栏目）
  if (confirm("确定删除此专栏？专栏内文章将归入「所有文章」。"))
    // 用户确认后，调用 store 方法删除
    store.deleteColumn(id);
};

// ==========================================
// 目录 (TOC) 解析逻辑
// ==========================================

// 计算属性：根据文章内容自动生成目录
const tocItems = computed(() => {
  // 获取当前选中文章的内容，如果没有选中文章则默认为空字符串
  const content = store.selectedArticle?.content || "";

  // 将文章内容按换行符分割成数组，以便逐行分析
  const lines = content.split("\n");

  // 使用 Set 集合来存储文档中出现过的标题层级（如 H1, H3），Set 自动去重
  const foundLevelsSet = new Set();
  // 数组用于临时存储解析出的所有标题对象
  const rawHeadings = [];

  // 遍历每一行文本
  for (const line of lines) {
    // 正则匹配：查找以 1-6 个 # 开头，后跟空格和文本的行（Markdown 标题语法）
    // m[1] 是 "###" 部分，m[2] 是标题文本部分
    const m = line.match(/^(#{1,6})\s+(.+)/);

    // 如果当前行匹配到了标题
    if (m) {
      // 获取标题层级（例如 "###" 的长度为 3，代表 H3）
      const lvl = m[1].length;
      // 将该层级加入集合（用于后续确定显示哪些层级）
      foundLevelsSet.add(lvl);
      // 将解析出的层级和文本存入数组
      rawHeadings.push({ lvl, text: m[2].trim() });
    }
  }

  // 将 Set 转为数组并排序（从小到大），例如 [1, 3] 表示文档主要用 H1 和 H3
  const sortedLevels = Array.from(foundLevelsSet).sort((a, b) => a - b);

  // 核心逻辑：为了目录简洁，只取前两个主要层级（例如只取 H1 和 H2，或者 H1 和 H3）
  const activeLevels = sortedLevels.slice(0, 2);

  // 最终返回的目录项数组
  const items = [];
  // 用于生成唯一 ID 的计数器对象（例如记录当前是第几个 h1）
  const counters = {};

  // 再次遍历所有解析出的标题
  rawHeadings.forEach((h) => {
    // 查找当前标题层级是否在我们要显示的“主要层级”列表中
    const levelIndex = activeLevels.indexOf(h.lvl);

    // 如果找到了（不等于 -1），说明这个标题需要显示在目录中
    if (levelIndex !== -1) {
      // 生成标签名，如 'h1', 'h3'
      const tag = `h${h.lvl}`;
      // 对应标签的计数加 1
      counters[tag] = (counters[tag] || 0) + 1;

      // 将目录项推入结果数组
      items.push({
        level: levelIndex + 1, // 目录显示的缩进层级（1 或 2）
        text: h.text, // 标题文本
        id: `heading-${tag}-${counters[tag]}`, // 生成的唯一锚点 ID
      });
    }
  });

  // 返回处理好的目录数据
  return items;
});

// ==========================================
// 滚动跳转逻辑
// ==========================================

// 点击目录项跳转到对应位置的函数
const scrollToHeading = (id) => {
  // 根据 ID 获取目标 DOM 元素
  const el = document.getElementById(id);

  // 如果元素存在
  if (el) {
    // 尝试获取文章内容的滚动容器（假设 MarkdownViewer 外层 ID 为 article-scroll-container）
    const container = document.getElementById("article-scroll-container");

    // 如果找到了滚动容器
    if (container) {
      // 控制容器的滚动位置：滚动到元素顶部减去 20px（留出边距），并开启平滑动画
      container.scrollTo({ top: el.offsetTop - 20, behavior: "smooth" });
    } else {
      // 如果没找到特定容器，则使用浏览器默认的滚动到视口方法
      el.scrollIntoView({ behavior: "smooth" });
    }
  }
};
</script>

<template>
  <!-- 侧边栏容器：固定宽度 52 (13rem)，白色背景，右侧边框，Flex 纵向布局 -->
  <aside class="w-full h-full bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
    <!-- 侧边栏头部：标题 + 添加按钮 -->
    <div
      class="px-4 pt-4 pb-2 flex items-center justify-between border-b border-gray-100"
    >
      <!-- 标题文字：根据是否选中文章动态显示“文章目录”或“技术专栏” -->
      <span class="text-[15px] font-bold tracking-wider text-gray-400 uppercase">
        {{ store.selectedArticle ? "文章目录" : "技术专栏" }}
      </span>

      <!-- 添加按钮：仅在“管理员模式”且“未选中文章（即处于专栏列表模式）”时显示 -->
      <button
        v-if="store.isAdmin && !store.selectedArticle"
        @click="addCol"
        class="w-5 h-5 rounded flex items-center justify-center text-[#4caf50] hover:bg-green-50 transition text-lg leading-none font-bold"
      >
        +
      </button>
    </div>

    <!-- 中间滚动区域：占据剩余空间，内容溢出时垂直滚动 -->
    <nav class="flex-1 overflow-y-auto py-2 pr-1 custom-scrollbar">
      <!-- 情况 A：当前处于“文章阅读模式” (store.selectedArticle 存在) -->
      <template v-if="store.selectedArticle">
        <!-- 如果目录解析结果为空，显示提示文字 -->
        <div v-if="tocItems.length === 0" class="px-4 py-2 text-xs text-gray-400 italic">
          暂无目录
        </div>

        <!-- 循环渲染目录项 -->
        <div
          v-for="item in tocItems"
          :key="item.id"
          @click="scrollToHeading(item.id)"
          class="mx-2 px-3 py-1.5 rounded cursor-pointer transition text-[13px] break-all hover:bg-green-50 hover:text-[#4caf50]"
          :class="
            item.level === 1
              ? 'font-semibold text-gray-700'
              : 'pl-6 text-gray-500 text-[12px]'
          "
        >
          <!-- 显示标题文本 -->
          {{ item.text }}
        </div>
      </template>

      <!-- 情况 B：当前处于“专栏管理模式” (store.selectedArticle 为空) -->
      <template v-else>
        <!-- 循环渲染专栏列表 -->
        <div
          v-for="col in store.columns"
          :key="col.id"
          class="group flex items-center justify-between gap-1 mx-2 px-3 py-2 rounded cursor-pointer transition text-[13px]"
          :class="
            store.currentColId === col.id
              ? 'bg-[#4caf50] text-white font-semibold'
              : 'text-gray-600 hover:bg-gray-100'
          "
        >
          <!-- 专栏名称：点击切换当前栏目 -->
          <span @click="selectColumn(col.id)" class="flex-1 truncate">
            {{ col.name }}
          </span>

          <!-- 管理操作按钮组：仅在“管理员模式”且“不是默认栏目(id!==0)”时显示 -->
          <!-- 使用 opacity-0 和 group-hover:opacity-100 实现鼠标悬停时才显示按钮 -->
          <div
            v-if="store.isAdmin && col.id !== 0"
            class="flex gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0"
          >
            <!-- 编辑按钮：@click.stop 阻止事件冒泡，防止触发父元素的点击事件 -->
            <button @click.stop="editCol(col)" class="text-[11px] px-1 hover:text-white">
              ✎
            </button>
            <!-- 删除按钮 -->
            <button
              @click.stop="delCol(col.id)"
              class="text-[11px] px-1 hover:text-red-500"
            >
              ×
            </button>
          </div>
        </div>
      </template>
    </nav>

    <!-- 底部区域：管理按钮 -->
    <div class="px-3 pb-4 pt-2 border-t border-gray-100">
      <!-- 底部切换按钮：仅在管理员模式下显示 -->
      <button
        v-if="store.isAdmin"
        @click="goHome()"
        class="w-full py-2 rounded text-[12px] font-bold transition flex items-center justify-center gap-2"
        :class="
          store.selectedArticle
            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            : 'bg-gray-50 text-[#4caf50] hover:bg-green-50'
        "
      >
        <!-- 根据当前状态显示不同文字：在文章页显示“返回”，在列表页显示“管理” -->
        {{ store.selectedArticle ? "← 返回文章管理" : "📋 管理所有文章" }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
/* 自定义滚动条样式 (适用于 Chrome, Edge, Safari) */
.custom-scrollbar::-webkit-scrollbar {
  width: 5px; /* 设置滚动条宽度为 5px */
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent; /* 轨道背景透明 */
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #e5e7eb; /* 滚动条滑块颜色（浅灰） */
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #d1d5db; /* 鼠标悬停时颜色加深 */
}

/* 针对 Firefox 的兼容性写法 */
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: #e5e7eb transparent;
}
</style>