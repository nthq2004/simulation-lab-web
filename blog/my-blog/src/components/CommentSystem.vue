<script setup>
import { ref, onMounted } from 'vue';
const visitor = ref({ id: '', avatar: '' });
const comments = ref([{ user: 'Admin', text: '欢迎交流仿真技术！' }]);
const newMsg = ref('');

onMounted(() => {
  let user = localStorage.getItem('sim_user');
  if (!user) {
    user = JSON.stringify({ id: 'Visitor_' + Math.random().toString(36).slice(2, 7).toUpperCase() });
    localStorage.setItem('sim_user', user);
  }
  visitor.value = JSON.parse(user);
});

const send = () => {
  if (!newMsg.value) return;
  comments.value.push({ user: visitor.value.id, text: newMsg.value });
  newMsg.value = '';
};
</script>
<template>
  <div class="mt-12 border-t pt-6">
    <h3 class="font-bold mb-4">评论 ({{ comments.length }})</h3>
    <div class="space-y-3 mb-6">
      <div v-for="(c, i) in comments" :key="i" class="text-sm bg-gray-50 p-2 rounded">
        <span class="font-bold text-blue-600">{{ c.user }}:</span> {{ c.text }}
      </div>
    </div>
    <div class="flex gap-2">
      <input v-model="newMsg" type="text" :placeholder="`${visitor.id} 说点什么...`" 
             class="flex-1 border rounded px-3 py-1">
      <button @click="send" class="bg-blue-500 text-white px-4 py-1 rounded">发送</button>
    </div>
  </div>
</template>