<script setup>
// 1. 从 Vue 库中引入 computed 函数，用于创建计算属性
// 计算属性会根据响应式依赖自动更新，适合处理派生状态
import { computed } from "vue";

// 2. 从相对路径引入全局状态管理对象 store
// 这个 store 包含了博客的所有核心数据（如文章列表、当前选中项、用户状态等）
import { store } from "../store/blogData.js";

// 3. 引入子组件，用于构建页面的不同区域
import ColumnList from "./ColumnList.vue"; // 左侧边栏：显示栏目分类列表
import ArticleList from "./ArticleList.vue"; // 中间区域：显示文章列表（默认视图）
import HotArticles from "./HotArticles.vue"; // 右侧边栏：显示热门文章排行
import MarkdownViewer from "./MarkdownViewer.vue"; // 中间区域：显示文章详情（Markdown 阅读器）

// 4. 路由特性都定义在这里
import { useRoute, useRouter } from "vue-router";
const router = useRouter();
const route = useRoute();
//  定义计算属性：isDetail
// 用于判断当前界面是否处于“文章详情模式”,可以直接用 route.params.id 判断
const isDetail = computed(() => !!route.params.id);

// 5. 修改 Logo 点击事件或导航点击事件
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
// 6. 发布新文件，使用路由
const handleCreate = () => {
  // 不再仅仅是改 store，而是跳转路由
  router.push("/article/new");
};

// 75. 定义处理登录/登出的异步函数
const handleLogin = async () => {
  // 判断当前用户是否已经是管理员 (store.isAdmin 为 true)
  if (store.isAdmin) {
    // 如果是管理员，弹出确认框询问是否退出
    if (confirm("确定退出管理员模式吗？")) {
      // 用户点击确认后，调用 store 的 logout 方法清除登录状态
      store.logout();
    }
    // 执行完退出逻辑或用户取消后，直接结束函数，不再执行下方的登录逻辑
    return;
  }

  // --- 以下是非管理员（普通用户）的登录逻辑 ---

  // 弹出输入框，提示用户输入管理员密码
  const password = prompt("请输入管理员密码：");

  // 检查用户是否输入了内容（如果用户点击取消或输入为空，password 为 null 或空字符串）
  if (password) {
    // 调用 store 中的 login 方法，传入密码进行验证
    // await 表示等待异步操作完成（例如模拟网络请求）
    const success = await store.login(password);

    // 根据登录返回的结果进行反馈
    if (success) {
      // 登录成功，弹出提示
      alert("登录成功，已开启管理权限");
    } else {
      // 登录失败（密码错误），弹出提示
      alert("密码错误，请重试");
    }
  }
};
</script>

<template>
  <div class="flex flex-col h-screen bg-[#f5f5f5] text-sm font-sans overflow-hidden">
    <header class="bg-white border-b border-gray-200 flex items-center px-4 sm:px-6 py-2.5 justify-between flex-shrink-0 z-10">
      <div @click="goHome()" class="font-black text-[18px] sm:text-[20px] tracking-tight cursor-pointer select-none flex-shrink-0">
        <span class="text-gray-900">控制仿真</span>
        <span class="text-[#4caf50]">.博客</span>
      </div>

      <div class="relative mx-4 flex-1 max-w-xs hidden sm:block">
        <input
          v-model="store.searchQuery"
          type="text"
          placeholder="搜索文章..."
          class="border border-gray-300 rounded px-4 pr-10 py-1.5 w-full text-[13px] text-gray-700 outline-none focus:border-[#4caf50] transition"
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
      </div>

      <button
        @click="handleLogin"
        :class="[
          'text-xs font-bold px-3 py-2 sm:px-4 rounded-lg transition-all shadow-sm flex-shrink-0',
          store.isAdmin ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-[#4caf50] text-white hover:bg-[#43a047]',
        ]"
      >
        {{ store.isAdmin ? "退出" : "管理员登录" }}
      </button>
    </header>

    <nav class="bg-[#4caf50] flex items-center px-4 flex-shrink-0 h-9 gap-0.5 overflow-x-auto no-scrollbar">
      <button
        v-for="col in store.columns"
        :key="col.id"
        @click="selectColumn(col.id)"
        class="px-3 h-full text-[15px] font-semibold tracking-wide uppercase transition whitespace-nowrap"
        :class="store.currentColId === col.id ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/15 hover:text-white'"
      >
        {{ col.name }}
      </button>
    </nav>

    <main class="flex flex-1 overflow-hidden">
      <aside class="hidden lg:flex w-64 h-full flex-shrink-0 border-r border-gray-100 flex-col bg-white">
        <ColumnList />
      </aside>

      <div class="flex-1 min-w-0 overflow-hidden bg-white flex flex-col">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
        
        <ArticleList v-if="!$route.params.id && !$route.path.includes('new')" />
      </div>

      <aside class="hidden xl:flex w-64 h-full flex-shrink-0 border-l border-gray-100 flex-col bg-white">
        <HotArticles />
      </aside>
    </main>
  </div>
</template>