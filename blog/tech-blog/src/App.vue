<script setup>
import router from './router' // 导入上面的路由配置
import { onMounted } from 'vue';
import { store } from './store/blogData.js';

onMounted(async () => {
  // 必须在这里显式调用，数据才会从 D1 加载到本地
  await store.init();
});
</script>

<template>
  <router-view />
</template>
