<script setup>
import { store } from '../store/blogData.js';
</script>
<template>
  <aside class="w-52 border-r bg-gray-50 p-3">
    <h3 class="text-gray-400 font-bold mb-3 text-xs uppercase">技术专栏</h3>
    <div v-for="col in store.columns" :key="col.id" 
         @click="store.currentColId = col.id; store.selectedArticle = null"
         :class="['p-2 mb-1 rounded cursor-pointer transition', store.currentColId === col.id ? 'bg-blue-100 text-blue-700 font-bold' : 'hover:bg-gray-200']">
      # {{ col.name }}
    </div>
  </aside>
</template>