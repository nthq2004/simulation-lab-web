// 1. 从 Vue 导入 reactive 函数
// reactive 用于创建一个响应式代理对象，当内部属性变化时，使用它的组件会自动更新
import { reactive } from 'vue';

// 2. 定义 API 基础地址
// 根据环境变量判断：开发环境用本地地址，生产环境用线上地址
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:8787'
  : 'https://blogapi.wangaijun.click';

// 3. 导出 store 对象
// 这是一个响应式单例，整个应用共享这一个状态
export const store = reactive({
  
  // ==========================================
  // 状态数据 (State)
  // ==========================================
  
  // 管理员登录状态：检查本地存储是否有 token，有则为 true
  isAdmin: !!localStorage.getItem('blog_admin_token'),
  
  // 专栏列表数据
  columns: [],
  
  // 文章列表数据（通常只包含摘要信息）
  articles: [],
  
  // 评论列表数据
  comments: [],
  
  // 当前选中的专栏 ID（0 通常代表“所有文章”）
  currentColId: 0,
  
  // 当前选中的文章对象（用于查看详情或编辑）
  selectedArticle: null,
  
  // 搜索关键词
  searchQuery: '',
  // 图片缓存：使用 Map 存储已加载的图片数据，键为图片 URL，值为图片数据
  imageMap: new Map(), 

  // ==========================================
  // 核心工具方法 (Core Utilities)
  // ==========================================

  // 统一的 API 请求封装方法
  // 参数：path(路径), method(请求方法), body(请求体)
  async apiRequest(path, method = 'GET', body = null) {
    // 构建请求配置对象
    const options = {
      method, // 请求方法 (GET, POST 等)
      headers: {
        'Content-Type': 'application/json', // 声明发送 JSON 数据
        // 从本地存储获取 Token，如果没有则为空字符串
        'Authorization': localStorage.getItem('blog_admin_token') || ''
      }
    };
    
    // 如果有请求体（如 POST/PUT），将其序列化为 JSON 字符串
    if (body) options.body = JSON.stringify(body);

    // 发起 fetch 请求，拼接完整 URL
    const res = await fetch(`${API_BASE}${path}`, options);
    
    // 权限检查：如果返回 401 状态码（未授权）
    if (res.status === 401) {
      this.logout(); // 调用登出方法，清除本地状态
      throw new Error('登录失效，请重新登录'); // 抛出错误，中断后续逻辑
    }
    
    // 解析 JSON 响应并返回
    return res.json();
  },

  // ==========================================
  // 初始化与认证 (Init & Auth)
  // ==========================================

  // 初始化应用数据
  async init() {
    try {
      // 1. 强制先拉取专栏列表（因为文章依赖专栏 ID）
      await this.fetchColumns();
      // 2. 拉取文章列表
      await this.fetchArticles();

      // 3. 容错处理：如果专栏列表为空，输出警告（可选逻辑）
      if (this.columns.length === 0) {
        console.warn("没有发现专栏数据");
      }
    } catch (e) {
      // 捕获初始化过程中的错误
      console.error("初始化数据失败", e);
    }
  },

  // 管理员登录方法
  async login(password) {
    try {
      // 调用 API 发送密码进行验证
      // 假设后端验证通过后返回 { token: "..." }
      const data = await this.apiRequest('/api/login', 'POST', { password });
      
      // 如果返回了 token
      if (data.token) {
        this.isAdmin = true; // 更新本地状态为已登录
        // 将 token 持久化存储到浏览器，刷新页面依然有效
        localStorage.setItem('blog_admin_token', data.token);
        return true; // 返回成功
      }
    } catch (e) {
      // 登录失败（如密码错误、网络错误）
      return false;
    }
  },

  // 退出登录方法
  logout() {
    this.isAdmin = false; // 重置状态
    localStorage.removeItem('blog_admin_token'); // 清除持久化存储
  },

  // ==========================================
  // 专栏管理 (Column Management)
  // ==========================================

  // 获取专栏列表
  async fetchColumns() {
    // 调用 API 获取数据并直接赋值给 columns 数组
    this.columns = await this.apiRequest('/api/columns');
  },

  // 添加新专栏
  async addColumn(name) {
    // 发送 POST 请求创建专栏
    await this.apiRequest('/api/columns', 'POST', { name });
    // 创建成功后，重新拉取列表以获取最新数据（包含新 ID）
    await this.fetchColumns();
  },

  // 重命名专栏
  async renameColumn(id, newName) {
    // 发送 PUT 请求更新专栏名称
    await this.apiRequest(`/api/columns/${id}`, 'PUT', { name: newName });
    // 更新后重新拉取列表
    await this.fetchColumns();
  },

  // 删除专栏
  async deleteColumn(id) {
    // 保护逻辑：不允许删除 ID 为 0 的默认专栏
    if (id === 0) return;
    
    // 二次确认
    if (confirm('确定删除专栏吗？相关文章将归入“所有文章”')) {
      // 发送 DELETE 请求
      await this.apiRequest(`/api/columns/${id}`, 'DELETE');
      // 删除后重新初始化整个应用（确保文章归属关系正确更新）
      await this.init();
    }
  },

  // ==========================================
  // 文章管理 (Article Management)
  // ==========================================

  // 获取文章列表（摘要）
  async fetchArticles() {
    // 获取列表并赋值
    this.articles = await this.apiRequest('/api/articles');
  },

  // 获取单篇文章详情（包含完整内容）
  async fetchArticleDetail(id) {
    try {
      // 请求单篇文章详情
      const fullArt = await this.apiRequest(`/api/articles/${id}`);
      
      // 数据同步策略：
      // 将获取到的完整数据（含 content）更新到本地的 articles 数组中
      // 这样下次用到时就不需要再次请求
      const index = this.articles.findIndex(a => a.id === id);
      if (index !== -1) {
        this.articles[index] = fullArt;
      }
      
      return fullArt; // 返回完整数据供调用者使用
    } catch (e) {
      console.error("获取文章详情失败", e);
    }
  },

  // 发布新文章
  async publishArticle(newArt) {
    // 发送 POST 请求创建文章
    await this.apiRequest('/api/articles', 'POST', newArt);
    // 创建后刷新列表
    await this.fetchArticles();
    // 清空选中状态，返回列表视图
    this.selectedArticle = null;
  },

  // 更新文章
  async updateArticle(updated) {
    // 发送 PUT 请求更新文章
    await this.apiRequest(`/api/articles/${updated.id}`, 'PUT', updated);
    // 更新后刷新列表
    await this.fetchArticles();
  },

  // 删除文章
  async deleteArticle(id) {
    if (confirm('确定彻底删除这篇文章吗？')) {
      // 发送 DELETE 请求
      await this.apiRequest(`/api/articles/${id}`, 'DELETE');
      // 刷新列表
      await this.fetchArticles();
      // 如果当前正查看该文章，则清空选中状态
      this.selectedArticle = null;
    }
  },

  // 增加阅读量
  async addView(id) {
    if (!id) return; // 安全检查
    try {
      // 1. 发送统计请求（使用原生 fetch，不需要 token 验证）
      await fetch(`${API_BASE}/api/articles/${id}/view`, { method: 'POST' });

      // 2. 乐观更新：仅更新本地显示的阅读数
      // 这样不需要重新拉取整个列表，用户体验更流畅
      const art = this.articles.find(a => a.id === id);
      if (art) art.views++;
    } catch (e) {
      console.error(e);
    }
  },

  // 切换推荐状态 (设为热门/取消热门)
  async toggleHot(id) {
    // 发送 POST 请求切换状态
    await this.apiRequest(`/api/articles/${id}/toggle-hot`, 'POST');
    // 切换后刷新列表以更新 UI 状态
    await this.fetchArticles();
  },

  // ==========================================
  // 评论管理 (Comment Management)
  // ==========================================

  // 获取某篇文章的评论列表
  async fetchComments(artId) {
    // 通过查询参数 artId 获取对应评论
    this.comments = await this.apiRequest(`/api/comments?artId=${artId}`);
  },

  // 添加评论
  async addComment(artId, user, text) {
    // 发送 POST 请求创建评论
    await this.apiRequest('/api/comments', 'POST', {
      artId,
      user: user || '匿名访客', // 如果没有用户名，默认为匿名
      text
    });
    // 添加后重新拉取该文章的评论列表
    await this.fetchComments(artId);
  },

  // 删除评论
  async deleteComment(id) {
    // 发送 DELETE 请求
    await this.apiRequest(`/api/comments/${id}`, 'DELETE');
    
    // 如果当前有选中的文章，重新拉取该文章的评论以更新 UI
    if (this.selectedArticle) {
      await this.fetchComments(this.selectedArticle.id);
    }
  },

    // 用于清理内存的方法
  clearImageMap() {
      this.imageMap.forEach((_, url) => URL.revokeObjectURL(url));
      this.imageMap.clear();
  }
});