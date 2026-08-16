<script setup>
import { store } from '../store/blogData.js';
import CommentSystem from './CommentSystem.vue';
// 最小演示：手动提取 H1/H2 作为目录
const toc = [{ id: 1, text: '文章开头' }, { id: 2, text: '技术核心' }];
</script>
<template>
  <div class="flex h-full">
    <div class="w-40 border-r p-4 text-xs text-gray-500">
      <div class="font-bold mb-2 uppercase">目录</div>
      <div v-for="t in toc" :key="t.id" class="mb-2 hover:text-blue-600 cursor-pointer">· {{ t.text }}</div>
    </div>
    <div class="flex-1 p-8 overflow-y-auto">
      <button @click="store.selectedArticle = null" class="text-blue-500 mb-4">← 返回列表</button>
      <article class="prose max-w-none">
        <h1 class="text-3xl font-bold mb-4">{{ store.selectedArticle.title }}</h1>
        <pre class="bg-gray-100 p-4 rounded">{{ store.selectedArticle.content }}</pre>
      </article>
      <CommentSystem />
    </div>
  </div>
</template>