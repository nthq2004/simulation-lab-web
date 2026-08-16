<script setup>
import { store } from '../store/blogData.js';
const hotOnes = store.articles.filter(a => a.isHot);
</script>
<template>
  <aside class="w-64 border-l bg-gray-50 p-4">
    <h3 class="text-gray-400 font-bold mb-3 text-xs uppercase">热门推荐</h3>
    <div v-for="art in hotOnes" :key="art.id" @click="store.selectedArticle = art"
         class="mb-3 cursor-pointer hover:underline text-sm text-gray-700">
      🔥 {{ art.title }}
    </div>
  </aside>
</template>