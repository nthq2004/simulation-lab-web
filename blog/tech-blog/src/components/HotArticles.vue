<script setup>
// 1. 从 Vue 引入 computed，用于创建响应式计算属性
import { computed } from "vue";
// 2. 引入全局状态管理 store
import { store } from "../store/blogData.js";
import { useRoute,useRouter } from 'vue-router'
const router = useRouter();
const route = useRoute();
const handleArticleClick = (art) => {
  // 不再仅仅是赋值，而是跳转路由
  router.push(`/article/${art.id}`);
};
// 计算属性：生成热门/推荐文章列表
const hotArticles = computed(() => {
  // 步骤 1：获取所有文章，使用 || [] 防止 articles 为 undefined 时报错
  const all = store.articles || [];

  // 步骤 2：筛选“人工推荐”的文章
  // 筛选出 isHot 属性为真（1 或 true）的文章，这些是管理员手动置顶的
  const featured = all.filter((a) => !!a.isHot);

  // 步骤 3：获取“热度排行”的文章
  // 复制数组并排序，按浏览量 (views) 从高到低排列
  // (b.views || 0) 确保即使 views 缺失也不会报错
  const topViews = [...all].sort((a, b) => (b.views || 0) - (a.views || 0));

  // 步骤 4：使用 Set 进行去重合并
  // Set 是一种只存储唯一值的数据结构，用来防止同一篇文章既是“推荐”又是“高热度”时重复出现
  const resultSet = new Set();

  // 优先级 A：先加入所有被“人工推荐”的文章
  // 这些文章具有最高优先级，一定会出现在列表中
  featured.forEach((a) => resultSet.add(a));

  // 优先级 B：补充“高阅读量”的文章
  // 取出阅读量最高的前 5 篇
  // 如果这些文章中有些已经是“推荐文章”，Set 会自动忽略，不会重复添加
  topViews.slice(0, 5).forEach((a) => resultSet.add(a));

  // 步骤 5：最终处理
  // 将 Set 转回数组，并截取前 8 篇作为最终展示列表（限制侧边栏长度）
  return Array.from(resultSet).slice(0, 8);
});
</script>

<template>
  <!-- 侧边栏容器：固定宽度 62 (13rem)，白色背景，左侧边框，Flex 纵向布局 -->
  <aside class="w-full bg-white border-l border-gray-200 flex flex-col flex-shrink-0">
    
    <!-- 侧边栏头部：标题区域 -->
    <div class="px-4 pt-4 pb-2 border-b border-gray-100">
      <!-- 标题文字：灰色小字，全大写，增加字间距 -->
      <span class="text-[15px] font-bold tracking-wider text-gray-400 uppercase"
        >热门推荐</span
      >
    </div>

    <!-- 列表滚动区域：占据剩余空间，内容溢出时垂直滚动 -->
    <div class="flex-1 overflow-y-auto py-2">
      
      <!-- 空状态：如果计算出的列表为空，显示提示 -->
      <div
        v-if="hotArticles.length === 0"
        class="text-gray-400 text-xs px-4 py-3 text-center"
      >
        暂无推荐文章
      </div>

      <!-- 循环渲染文章列表 -->
      <div
        v-for="art in hotArticles"
        :key="art.id"
        @click="handleArticleClick(art)"
        class="group flex items-start gap-2 mx-2 px-3 py-2.5 rounded cursor-pointer hover:bg-gray-100 transition"
      >
        <!-- 图标列：根据文章类型显示不同 Emoji -->
        <!-- flex-shrink-0 防止图标被压缩，mt-0.5 用于垂直对齐文本 -->
        <span class="text-xs mt-0.5 flex-shrink-0">
          <!-- 如果是人工推荐(isHot)，显示火焰；否则显示趋势图（代表热度） -->
          {{ !!art.isHot ? "🔥" : "📈" }}
        </span>

        <!-- 文本信息列 -->
        <div class="min-w-0">
          <!-- 文章标题：截断超长文本，悬停变绿 -->
          <div
            class="text-gray-700 text-[14px] group-hover:text-[#4caf50] transition truncate leading-snug"
          >
            <!-- 如果是人工推荐，显示 [精] 标签，橙色加粗 -->
            <span v-if="!!art.isHot" class="text-orange-500 font-bold mr-1">[精]</span>
            <!-- 标题文本 -->
            {{ art.title }}
          </div>
          
          <!-- 元数据行：显示阅读量和推荐标签 -->
          <div class="text-gray-400 text-[11px] mt-0.5 flex items-center gap-2">
            <!-- 显示阅读量 -->
            <span>{{ art.views }} 阅读</span>
            
            <!-- 额外的推荐标签：仅在人工推荐时显示 -->
            <!-- 橙色边框和文字，圆角背景 -->
            <span
              v-if="!!art.isHot"
              class="text-orange-300 text-[10px] border border-orange-200 px-1 rounded"
              >推荐</span
            >
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>