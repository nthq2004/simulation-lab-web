<script setup>
// 1. 从 Vue 引入 computed，用于创建响应式计算属性
import { computed } from 'vue';
// 2. 引入全局状态管理 store
import { store } from '../store/blogData.js';
import { useRoute,useRouter } from 'vue-router'

const router = useRouter();
const route = useRoute();
// ==========================================
// 数据过滤与排序逻辑
// ==========================================
const handleArticleClick = (art) => {
  // 不再仅仅是赋值，而是跳转路由
  router.push(`/article/${art.id}`);
};
// 计算属性：获取经过筛选和排序后的文章列表
const displayArticles = computed(() => {
  // 1. 复制一份文章数组，避免直接修改原始数据
  let list = [...store.articles];
  
  // 2. 栏目过滤：如果当前选中的不是“所有文章”(id为0)，则筛选出属于当前栏目的文章
  if (store.currentColId !== 0) list = list.filter(a => a.colId === store.currentColId);
  
  // 3. 搜索过滤：如果有搜索关键词
  if (store.searchQuery) {
    // 将搜索词转换为小写，实现不区分大小写的搜索
    const q = store.searchQuery.toLowerCase();
    // 筛选出标题中包含搜索关键词的文章
    list = list.filter(a => a.title.toLowerCase().includes(q));
  }
  
  // 4. 排序：按日期倒序排列（最新的文章在最前面）
  // new Date(b.date) - new Date(a.date) 实现降序
  return list.sort((a, b) => new Date(b.date) - new Date(a.date));
});

// 计算属性：获取当前栏目的名称，用于页面标题显示
const colName = computed(() =>
  // 如果当前栏目 ID 为 0，显示“所有文章”
  store.currentColId === 0
    ? '所有文章'
    // 否则在 columns 数组中查找对应名称，如果找不到则显示“未知专栏”
    : store.columns.find(c => c.id === store.currentColId)?.name ?? '未知专栏'
);

// ==========================================
// 交互操作逻辑
// ==========================================

// 函数：打开“新建文章”界面
const openNew = () => {
// 先设置 store 状态，再跳转
  store.selectedArticle = {
    isNew: true,
    title: '',
    content: '',
    colId: store.currentColId !== 0 ? store.currentColId : (store.columns[1]?.id ?? 0)
  };
  router.push('/article/new');
};

// 函数：处理“编辑”按钮点击
const handleEdit = async (art) => {

      // 1. 跳转到对应文章的路由
  router.push(`/article/${art.id}`);  
  // 2. 获取全文数据
  const fullArt = await store.fetchArticleDetail(art.id);

  
  // 3. 设置编辑标记
  store.selectedArticle = { ...fullArt, _editing: true };


};

// 修改后的删除逻辑
const handleDelete = (id) => {
  if (confirm('确认删除该文章吗？')) {
    store.deleteArticle(id);
  }
};

</script>

<template>
  <!-- 根容器：Flex 纵向布局，占满高度，白色背景 -->
  <div class="flex flex-col h-full bg-white">
    
    <!-- 顶部表头：显示栏目名和“发布新文章”按钮 -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
      <!-- 栏目名称标题 -->
      <h2 class="text-lg font-bold text-gray-800">{{ colName }}</h2>
      
      <!-- 发布按钮：仅在管理员模式下显示 -->
      <button v-if="store.isAdmin" @click="openNew"
        class="flex items-center gap-1.5 bg-[#4caf50] text-white text-[15px] font-semibold px-3 py-1.5 rounded hover:bg-[#43a047] transition">
        <!-- 加号图标 -->
        <span class="text-base leading-none">+</span> 
        <!-- 按钮文字 -->
        发布新文章
      </button>
    </div>

    <!-- 文章列表滚动区域：占据剩余空间，溢出滚动 -->
    <div class="flex-1 overflow-y-auto">
      
      <!-- 空状态：如果过滤后文章列表为空，显示提示 -->
      <div v-if="displayArticles.length === 0"
        class="flex items-center justify-center h-40 text-gray-400 text-sm">
        暂无文章
      </div>

      <!-- 循环渲染文章列表 -->
      <div v-for="art in displayArticles" :key="art.id"
        class="group flex items-center justify-between px-6 py-4 border-b border-gray-100 hover:bg-gray-50 transition cursor-pointer">
        
        <!-- 左侧：文章信息区域（点击整行进入阅读模式） -->
        <!-- @click 触发选中文章，min-w-0 防止 flex 子元素溢出，pr-4 留出右侧间距 -->
        <div @click="handleArticleClick(art)" class="flex-1 min-w-0 pr-4">
          <!-- 标题行：包含 HOT 标签和标题文本 -->
          <div class="flex items-center gap-2">
            <!-- HOT 标签：仅当 art.isHot 为真时显示 -->
            <span v-if="art.isHot"
              class="text-[12px] bg-orange-100 text-orange-500 px-1.5 py-0.5 rounded font-bold tracking-wide flex-shrink-0">HOT</span>
            <!-- 文章标题：截断超长文本，悬停时变色 -->
            <span class="font-semibold text-gray-800 group-hover:text-[#4caf50] transition truncate">{{ art.title }}</span>
          </div>
          
          <!-- 元数据行：日期、阅读量、所属栏目 -->
          <div class="text-[11px] text-gray-400 mt-1.5 flex items-center gap-2">
            <span>{{ art.date }}</span>
            <span>·</span>
            <span>{{ art.views }} 阅读</span>
            <span>·</span>
            <!-- 动态查找并显示栏目名称 -->
            <span>{{ store.columns.find(c => c.id === art.colId)?.name ?? '未分类' }}</span>
          </div>
        </div>

        <!-- 右侧：管理操作按钮组 -->
        <!-- 仅在管理员模式下显示，使用 opacity-0 和 group-hover:opacity-100 实现悬停显示 -->
        <div v-if="store.isAdmin"
          class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
          
          <!-- 推荐/取消推荐按钮 -->
          <!-- 动态样式：已推荐显示橙色，未推荐显示灰色 -->
          <button @click.stop="store.toggleHot(art.id)"
            class="text-[13px] px-2 py-1 rounded border transition"
            :class="art.isHot
              ? 'border-orange-300 text-orange-500 bg-orange-50 hover:bg-orange-100'
              : 'border-gray-200 text-gray-400 hover:border-orange-300 hover:text-orange-500'">
            {{ art.isHot ? '取消推荐' : '设为推荐' }}
          </button>
          
          <!-- 编辑按钮：点击触发 handleEdit，获取全文并进入编辑模式 -->
          <button @click.stop="handleEdit(art)"
            class="text-[13px] px-2 py-1 rounded border border-gray-200 text-gray-500 hover:border-[#4caf50] hover:text-[#4caf50] transition">
            编辑
          </button>
          
          <!-- 删除按钮 -->
          <button @click.stop="handleDelete(art.id)"
            class="text-[13px] px-2 py-1 rounded border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-500 transition">
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
