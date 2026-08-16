<script setup>
import { computed } from 'vue';
import { store } from '../store/blogData.js';

const displayArticles = computed(() => {
  if (store.searchQuery) {
    return store.articles.filter(a => a.title.includes(store.searchQuery));
  }
  return store.articles.filter(a => a.colId === store.currentColId);
});
</script>
<template>
  <div class="p-6">
    <h2 class="text-xl font-bold mb-4">{{ store.searchQuery ? '搜索结果' : '文章列表' }}</h2>
    <div v-for="art in displayArticles" :key="art.id" @click="store.selectedArticle = art"
         class="border-b py-3 hover:text-blue-600 cursor-pointer group">
      <div class="font-medium">{{ art.title }}</div>
      <div class="text-xs text-gray-400 mt-1">浏览量: {{ art.views }}</div>
    </div>
  </div>
</template>