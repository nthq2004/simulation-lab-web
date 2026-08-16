<script setup>
// 1. 从 Vue 导入 ref，用于创建响应式引用 (如 DOM 引用)
import { ref,watch } from "vue";

// 2. 定义组件的 Props (外部传入的数据)
// 这是一个受控组件，使用 v-model 时，value 会被映射为 modelValue
const props = defineProps({
  // modelValue: 绑定的 Markdown 文本内容
  modelValue: {
    type: String,
    default: "",
  },
  // placeholder: 文本框的占位符提示
  placeholder: {
    type: String,
    default: "使用 Markdown 编写内容...",
  },
  // minHeight: 编辑器的最小高度 (支持传入字符串如 '300px')
  minHeight: {
    type: String,
    default: "300px",
  },
});

// 3. 定义组件触发的事件 (用于更新父组件数据)
// update:modelValue 是 v-model 默认监听的事件
const emit = defineEmits(["update:modelValue"]);

// 历史记录状态
const history = ref([]);
const historyIndex = ref(-1);
const isUndoing = ref(false);

// 监听内容变化并记录历史
watch(() => props.modelValue, (newVal) => {
  if (isUndoing.value) {
    isUndoing.value = false;
    return;
  }
  // 如果内容真的变了（且不是由撤销操作触发的），存入历史
  if (newVal !== history.value[historyIndex.value]) {
    // 如果在历史中间做了修改，删除后面的记录
    history.value = history.value.slice(0, historyIndex.value + 1);
    history.value.push(newVal);
    // 限制历史长度（如50条）
    if (history.value.length > 50) history.value.shift();
    historyIndex.value = history.value.length - 1;
  }
}, { immediate: true });

const undo = () => {
  if (historyIndex.value > 0) {
    isUndoing.value = true;
    historyIndex.value--;
    emit("update:modelValue", history.value[historyIndex.value]);
  }
};

const redo = () => {
  if (historyIndex.value < history.value.length - 1) {
    isUndoing.value = true;
    historyIndex.value++;
    emit("update:modelValue", history.value[historyIndex.value]);
  }
};


// 4. 创建 DOM 引用 (Ref)，用于直接操作原生 HTML 元素
const textarea = ref(null); // 引用 textarea 元素，用于光标定位
const fileInput = ref(null); // 引用隐藏的 file input 元素
const isDragging = ref(false); // 响应式状态：是否正在拖拽文件

// 5. 核心数据结构：图片映射表
// Map 结构：临时 URL (blob:) -> 真实数据 (base64:)
// 作用：解决 Vue 模板中无法直接显示 Base64 图片或需要上传后回显的问题
// 在此组件中，用于将文件转为 Base64 并建立映射，方便后续保存
// const imageMap = new Map();
// 由于 imageMap 是全局状态的一部分，应该放在 store 中管理
import { store } from "../store/blogData.js";
const imageMap = store.imageMap; // 从全局 store 中获取 imageMap

// ───────────────────────────── 核心方法区 ─────────────────────────────

// 方法：插入图片文件 (被粘贴、拖拽、选择文件调用)
const insertImageFile = (file) => {
  // 1. 创建 FileReader 实例读取文件
  const reader = new FileReader();

  // 2. 定义读取完成后的回调
  reader.onload = (e) => {
    // 3. 获取 Base64 数据结果
    const base64 = e.target.result;

    // 4. 创建临时 Blob URL
    // URL.createObjectURL(file) 生成类似 blob:http://xxx 的 URL
    // 这种 URL 可以直接被 <img src> 显示，且比 Base64 更快
    const blobUrl = URL.createObjectURL(file);

    // 5. 建立映射关系
    // 将 临时 URL 作为 Key，Base64 数据作为 Value 存入 Map
    // 这样在保存文章时，可以通过查找 Map 将 blob: 替换回 base64: 或上传到服务器
    imageMap.set(blobUrl, base64);

    // 6. 插入 Markdown 语法到光标位置
    // 格式：\n![文件名](临时URL)\n
    insertAtCursor(`\n![${file.name}](${blobUrl})\n`);
  };

  // 7. 开始读取文件为 Data URL (Base64 格式)
  reader.readAsDataURL(file);
};

// 方法：在光标当前位置插入文本
const insertAtCursor = (text) => {
  const el = textarea.value; // 获取原生 DOM 元素
  if (!el) return;

  // 1. 获取光标起始和结束位置
  const start = el.selectionStart;
  const end = el.selectionEnd;

  // 2. 触发 emit 更新 v-model 绑定的值
  // 将文本切片，在中间插入新内容
  emit(
    "update:modelValue",
    props.modelValue.slice(0, start) + text + props.modelValue.slice(end)
  );

  // 3. 使用 setTimeout 确保 DOM 更新后操作光标
  // 将光标移动到插入文本的末尾
  setTimeout(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = start + text.length;
  }, 0);
};

// 方法：插入预设的 Markdown 格式
const insertFormat = (type) => {
  const el = textarea.value;
  if (!el) return;

  // 1. 获取当前选中的文本
  const sel = props.modelValue.slice(el.selectionStart, el.selectionEnd);

  // 2. 定义不同格式的模板
  // 如果有选中文本，就包裹选中内容；否则插入占位符
  const formats = {
    bold: `**${sel || "粗体文字"}**`,
    italic: `*${sel || "斜体文字"}*`,
    code: "`" + (sel || "代码") + "`",
    codeblock: "\n```\n" + (sel || "代码块") + "\n```\n",
    h1: `# ${sel || "一级标题"}`,
    h2: `## ${sel || "二级标题"}`,
    link: `[${sel || "链接文字"}](https://)`,
    quote: `> ${sel || "引用内容"}\n`,
    underline: `------\n`,
  };

  // 3. 调用插入方法
  insertAtCursor(formats[type] ?? "");
};

// 事件处理：粘贴 (Paste)
const onPaste = (e) => {
  // 1. 获取剪贴板中的数据项
  const items = e.clipboardData?.items;
  if (!items) return;

  // 2. 遍历所有剪贴板项
  for (const item of items) {
    // 3. 检查是否为图片类型 (image/png, image/jpeg 等)
    if (item.type.startsWith("image/")) {
      e.preventDefault(); // 阻止浏览器默认的粘贴图片行为 (防止变成纯文本或乱码)
      // 获取文件对象并插入
      insertImageFile(item.getAsFile());
      return; // 找到图片后退出循环
    }
  }
};

// 事件处理：拖拽释放 (Drop)
const onDrop = (e) => {
  isDragging.value = false; // 重置拖拽状态
  e.preventDefault(); // 阻止默认行为 (防止浏览器尝试打开文件)

  // 1. 获取拖拽进来的文件列表
  const file = e.dataTransfer?.files?.[0];
  // 2. 如果有文件，调用插入方法
  if (file) insertImageFile(file);
};

// 事件处理：文件选择框变化 (点击按钮选择文件)
const onFileChange = (e) => {
  const file = e.target.files[0]; // 获取第一个选中的文件
  if (file) insertImageFile(file);
  e.target.value = ""; // 重置 input value，允许重复选择同一个文件
};

// 工具栏配置数据
// 定义了工具栏上显示的按钮及其对应的操作 Key
const toolbarButtons = [
  { key: "h1", label: "H1" },
  { key: "h2", label: "H2" },
  { key: "bold", label: "B" },
  { key: "italic", label: "I" },
  { key: "code", label: "`" },
  { key: "codeblock", label: "</>" },
  { key: "link", label: "🔗" },
  { key: "quote", label: '"' },
  { key: "underline", label: "__" },
];
</script>

<template>
  <!-- 容器 div -->
  <!-- 
    1. 样式：Flex 布局，添加边框、圆角和阴影
    2. 动态样式：:style 绑定外部传入的 minHeight
    3. class 中的 minHeight 是 Tailwind 的 minHeight，而 :style 是内联样式，两者配合使用
  -->
  <div
    class="flex flex-col border border-gray-300 rounded overflow-hidden bg-white h-full"
    style="min-height: 0"
  >
    <!-- 工具栏 (Toolbar) -->
    <!-- 
      1. 样式：灰色背景，底部边框，内边距
      2. flex-wrap：允许按钮换行 (在小屏幕上)
    -->
    <div
      class="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap flex-shrink-0"
    >
      <!-- 循环渲染工具栏按钮 -->
      <!-- 
        1. v-for：遍历 toolbarButtons
        2. @click：点击调用 insertFormat，传入按钮的 key
        3. 样式：悬停变绿，添加微小圆角
      -->
      <button
        v-for="btn in toolbarButtons"
        :key="btn.key"
        @click="insertFormat(btn.key)"
        class="px-2 py-1 text-[12px] font-mono text-gray-500 hover:text-[#4caf50] hover:bg-green-50 rounded transition"
      >
        {{ btn.label }}
      </button>

      <!-- 分割线 -->
      <!-- 竖线，用于视觉分隔功能区 -->
      <div class="w-px h-4 bg-gray-300 mx-1"></div>

      <!-- 插入图片按钮 -->
      <!-- 
        1. 点击事件：触发隐藏的 fileInput 的 click 事件
        2. 图标 🖼 和文字
      -->
      <button
        @click="fileInput.click()"
        class="flex items-center gap-1 px-2 py-1 text-[12px] text-gray-500 hover:text-[#4caf50] hover:bg-green-50 rounded transition"
      >
        🖼 插入图片
      </button>
      <!-- 分割线 -->
      <!-- 竖线，用于视觉分隔功能区 -->
      <div class="w-px h-4 bg-gray-300 mx-1"></div>
      <button @click="undo()" :disabled="historyIndex <= 0" class="p-1.5 px-2.5 text-[13px] text-gray-600 hover:bg-gray-100 rounded transition disabled:opacity-30 disabled:hover:bg-transparent" title="撤销">
        ↩️
      </button>
      <button
        @click="redo()"
        :disabled="historyIndex >= history.length - 1"
        class="p-1.5 px-2.5 text-[13px] text-gray-600 hover:bg-gray-100 rounded transition disabled:opacity-30 disabled:hover:bg-transparent"
        title="恢复"
      >
        ↪️
      </button>
      <!-- 隐藏的文件输入框 -->
      <!-- 
        1. ref="fileInput"：被上面的按钮引用
        2. accept="image/*"：只接受图片类型
        3. @change：选择文件后触发 onFileChange
        4. class="hidden"：隐藏原生样式，只通过按钮控制
      -->
      <input
        type="file"
        ref="fileInput"
        accept="image/*"
        @change="onFileChange"
        class="hidden"
      />

      <!-- 提示文字 -->
      <!-- 
        1. hidden sm:block：仅在小屏幕 (sm) 以上显示
        2. 提示用户支持粘贴和拖拽
      -->
      <span class="ml-auto text-[11px] text-gray-400 hidden sm:block">
        支持粘贴 / 拖拽图片
      </span>
    </div>

    <!-- 文本域 (Textarea - 核心编辑区) -->
    <!-- 
      1. ref="textarea"：用于获取 DOM 进行光标定位
      2. :value：绑定 v-model 的值 (单向数据流)
      3. @input：输入时触发 emit 更新父组件数据
      4. @paste：监听粘贴事件
      5. @dragover：拖拽经过时，设置 isDragging = true (配合 prevent)
      6. @dragleave：拖拽离开时重置状态
      7. @drop：拖拽释放时调用 onDrop
      8. :placeholder：显示占位符
      9. 动态 class：根据 isDragging 状态改变背景色 (提供视觉反馈)
      10. 动态 style：计算高度 (总高度减去工具栏高度 44px)
    -->
    <textarea
      ref="textarea"
      :value="modelValue"
      @input="emit('update:modelValue', $event.target.value)"
      @paste="onPaste"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop="onDrop"
      :placeholder="placeholder"
      class="flex-1 w-full resize-none text-gray-800 font-mono text-[13px] leading-relaxed px-4 py-3 outline-none placeholder-gray-400 transition min-h-0"
      style="height: 100%"
      :class="isDragging ? 'bg-green-50' : 'bg-white'"
    ></textarea>
  </div>
</template>
