<script setup>
import { computed } from 'vue';
import { store } from '../store/blogData.js';
import ColumnList from './ColumnList.vue';
import ArticleList from './ArticleList.vue';
import HotArticles from './HotArticles.vue';
import MarkdownViewer from './MarkdownViewer.vue';

const isDetail = computed(() => !!store.selectedArticle);
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-100 text-sm">
    <header class="h-12 bg-white border-b flex items-center px-4 justify-between shadow-sm">
      <div class="font-bold text-blue-600">TECH-SIM BLOG</div>
      <input v-model="store.searchQuery" type="text" placeholder="搜索文章..." 
             class="border rounded-full px-4 py-1 w-64 outline-none focus:ring-1 ring-blue-400">
      <div class="w-20"></div>
    </header>

    <main class="flex flex-1 overflow-hidden">
      <ColumnList />
      <div class="flex-1 bg-white overflow-y-auto">
        <MarkdownViewer v-if="isDetail" />
        <ArticleList v-else />
      </div>
      <HotArticles />
    </main>
  </div>
</template>