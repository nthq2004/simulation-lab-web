<script setup>
// 1. 从 Vue 引入响应式 API
import { ref, computed } from 'vue';
// 2. 引入全局状态管理 store
import { store } from '../store/blogData.js';
// 3. 引入图片粘贴编辑器组件（支持 Markdown 和图片上传）
import ImagePasteEditor from './ImagePasteEditor.vue';
// 4. 引入 markdown-it 库，用于将 Markdown 文本转换为 HTML
import MarkdownIt from 'markdown-it';

// 初始化 Markdown 解析器
// { html: false } 禁用 HTML 标签以防 XSS 攻击，{ breaks: false } 禁用换行符转换
const md = new MarkdownIt({ html: false, breaks: false });

// 定义响应式变量：评论者用户名
const userName = ref('');
// 定义响应式变量：评论文本内容
const commentText = ref('');
// 定义响应式变量：提交状态（防止重复提交）
const submitting = ref(false);

// 计算属性：获取当前文章的评论列表
const articleComments = computed(() =>
  // 过滤 store.comments，只保留属于当前选中文章 (artId 匹配) 的评论
  store.comments.filter(c => c.artId === store.selectedArticle?.id)
);

// 辅助函数：渲染 Markdown 文本为 HTML
const renderComment = (text) => md.render(text || '');

// 提交评论函数
const submit = () => {
  // 如果评论内容为空（去除空格后），则直接返回，不执行后续操作
  if (!commentText.value.trim()) return;
  
  // 开启提交中状态（用于禁用按钮和显示加载文字）
  submitting.value = true;
  
  // 模拟网络延迟（300ms），实际项目中可能是 await store.addComment(...)
  setTimeout(() => {
    // 调用 store 方法添加评论
    // 参数：文章ID, 用户名（如果为空则默认为'匿名访客'）, 评论内容
    store.addComment(
      store.selectedArticle.id,
      userName.value.trim() || '匿名访客',
      commentText.value.trim()
    );
    
    // 提交成功后，清空评论输入框
    commentText.value = '';
    // 重置提交状态
    submitting.value = false;
  }, 300);
};

// 删除评论函数（仅管理员可用）
const deleteC = (id) => {
  // 弹出确认框，用户确认后调用 store 方法删除评论
  if (confirm('确定删除此评论？')) store.deleteComment(id);
};
</script>

<template>
  <!-- 评论区主容器：顶部边框，上边距和上内边距 -->
  <div class="mt-12 pt-8 border-t border-gray-200">
    
    <!-- 标题区域 -->
    <h3 class="text-lg font-bold mb-5 text-gray-800">
      评论区
      <!-- 评论数量统计：灰色小字 -->
      <span class="text-sm font-normal text-gray-400 ml-2">{{ articleComments.length }} 条</span>
    </h3>

    <!-- 评论列表区域 -->
    <div class="space-y-3 mb-8">
      <!-- 空状态：如果没有评论，显示提示 -->
      <div v-if="articleComments.length === 0" class="text-gray-400 text-sm py-4 text-center bg-gray-50 rounded border border-gray-200">
        暂无评论，来发表第一条吧
      </div>

      <!-- 循环渲染评论列表 -->
      <div v-for="c in articleComments" :key="c.id"
        class="group flex gap-3 p-4 rounded border border-gray-200 hover:border-gray-300 bg-white transition">
        
        <!-- 用户头像：使用用户名的首字母作为头像 -->
        <!-- flex-shrink-0 防止头像被压缩 -->
        <div class="w-9 h-9 rounded-full bg-[#4caf50]/10 text-[#4caf50] flex items-center justify-center font-bold text-sm flex-shrink-0">
          {{ c.user[0].toUpperCase() }}
        </div>
        
        <!-- 评论详情区域 -->
        <div class="flex-1 min-w-0">
          <!-- 头部信息：用户名 + 时间 + 删除按钮 -->
          <div class="flex items-center justify-between gap-2">
            <div>
              <!-- 用户名 -->
              <span class="text-[13px] font-bold text-gray-700">{{ c.user }}</span>
              <!-- 评论时间 -->
              <span class="text-[11px] text-gray-400 ml-2">{{ c.date }}</span>
            </div>
            <!-- 删除按钮：仅在管理员模式下显示，鼠标悬停时显示 -->
            <button v-if="store.isAdmin" @click="deleteC(c.id)"
              class="text-[11px] text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
              删除
            </button>
          </div>
          
          <!-- 评论内容：使用 v-html 渲染 Markdown 转换后的 HTML -->
          <!-- leading-relaxed 增加行高以提升阅读体验 -->
          <div class="mt-1.5 text-[13px] text-gray-700 leading-relaxed comment-content"
               v-html="renderComment(c.text)">
          </div>
        </div>
      </div>
    </div>

    <!-- 发表评论表单区域 -->
    <div class="border border-gray-200 rounded p-4 bg-gray-50">
      <!-- 表单标题 -->
      <h4 class="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-3">发表评论</h4>
      
      <!-- 用户名输入框 -->
      <input v-model="userName" type="text" placeholder="你的名字（选填）"
        class="w-full mb-3 bg-white border border-gray-300 rounded px-3 py-2 text-gray-700 text-[13px] outline-none focus:border-[#4caf50] transition placeholder-gray-400" />
      
      <!-- 评论编辑器组件：支持 Markdown 和图片粘贴 -->
      <ImagePasteEditor
        v-model="commentText"
        placeholder="写下你的评论... 支持 Markdown，可直接粘贴图片"
        minHeight="120px"
      />
      
      <!-- 提交按钮区域 -->
      <div class="flex justify-end mt-3">
        <!-- 提交按钮 -->
        <!-- :disabled 属性：当内容为空或正在提交时禁用按钮 -->
        <button @click="submit" :disabled="!commentText.trim() || submitting"
          class="px-4 py-1.5 bg-[#4caf50] text-white text-[12px] font-semibold rounded hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed transition">
          <!-- 按钮文字：根据提交状态动态显示 -->
          {{ submitting ? '提交中...' : '发表评论' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 针对评论内容中的图片样式 */
.comment-content :deep(img) {
  max-width: 100%;      /* 图片最大宽度 100%，防止溢出 */
  border-radius: 6px;   /* 圆角 */
  margin: 8px 0;        /* 上下边距 */
  border: 1px solid #e5e7eb; /* 边框 */
}

/* 针对评论内容中的行内代码样式 */
.comment-content :deep(code) {
  background: #f0fdf4;  /* 浅绿色背景 */
  color: #16a34a;       /* 深绿色文字 */
  padding: 1px 5px;     /* 内边距 */
  border-radius: 4px;   /* 圆角 */
  font-size: 12px;      /* 字体大小 */
}

/* 针对评论内容中的代码块样式 */
.comment-content :deep(pre) {
  background: #f9fafb;  /* 浅灰色背景 */
  border: 1px solid #e5e7eb; /* 边框 */
  border-radius: 6px;   /* 圆角 */
  padding: 12px;        /* 内边距 */
  overflow-x: auto;     /* 横向滚动，防止代码过长溢出 */
  margin: 8px 0;        /* 上下边距 */
}
</style>