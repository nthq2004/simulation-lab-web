<script setup>
import { ref, computed } from 'vue'

// 1. 定义响应式数据
const newTodo = ref('') // 输入框的内容
const todos = ref([     // 任务列表
  { id: 1, text: '学习 Vue 3', done: false },
  { id: 2, text: '构建待办应用', done: true }
])

// 2. 定义方法
const addTodo = () => {
  if (newTodo.value.trim() === '') return
  todos.value.push({
    id: Date.now(), // 使用时间戳作为唯一ID
    text: newTodo.value,
    done: false
  })
  newTodo.value = '' // 清空输入框
}

const removeTodo = (todo) => {
  todos.value.splice(todos.value.indexOf(todo), 1)
}

// 3. 计算属性：自动统计剩余任务
const remainingCount = computed(() => {
  return todos.value.filter(t => !t.done).length
})
</script>

<template>
  <!-- 主容器：居中、最大宽度、白色背景、圆角、阴影 -->
  <div class="min-h-screen bg-gray-100 py-10 flex justify-center">
    <div class="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
      
      <!-- 头部 -->
      <div class="bg-indigo-600 p-6">
        <h1 class="text-2xl font-bold text-white text-center">我的待办清单</h1>
      </div>

      <!-- 输入区域：Flex布局、间距 -->
      <div class="p-6 flex gap-3">
        <input 
          v-model="newTodo" 
          @keyup.enter="addTodo"
          class="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
          placeholder="今天要做什么？" 
        />
        <button 
          @click="addTodo"
          class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-6 rounded-lg transition duration-200"
        >
          添加
        </button>
      </div>

      <!-- 列表区域 -->
      <ul class="divide-y divide-gray-100">
        <li 
          v-for="todo in todos" 
          :key="todo.id"
          class="p-4 flex justify-between items-center hover:bg-gray-50 transition group"
        >
          <span 
            :class="todo.done ? 'text-gray-400 line-through' : 'text-gray-700'"
            @click="todo.done = !todo.done"
            class="cursor-pointer select-none flex-1"
          >
            {{ todo.text }}
          </span>
          <!-- 删除按钮：悬停显示、红色 -->
          <button 
            @click="removeTodo(todo)"
            class="text-gray-300 hover:text-red-500 transition ml-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
          </button>
        </li>
      </ul>

      <!-- 底部统计 -->
      <div class="bg-gray-50 px-6 py-3 border-t border-gray-100 text-sm text-gray-500 flex justify-between items-center">
        <span>剩余 {{ remainingCount }} 项任务</span>
        <span v-if="todos.length === 0" class="text-indigo-500 font-medium">暂无任务，享受生活！</span>
      </div>

    </div>
  </div>
</template>
