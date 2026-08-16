import { reactive } from 'vue';

const initialArticles = [
  {
    id: 101, colId: 1,
    title: 'PID 水温控制逻辑',
    content: `# PID 水温控制逻辑\n\n## 简介\n\nPID（比例-积分-微分）控制器是工业自动化中最常用的控制算法之一。\n\n## 参数调节\n\n- **Kp**：比例系数，决定响应速度\n- **Ki**：积分系数，消除稳态误差\n- **Kd**：微分系数，抑制超调\n\n## 代码示例\n\n\`\`\`python\ndef pid_control(setpoint, measured, kp, ki, kd, dt):\n    error = setpoint - measured\n    return kp * error\n\`\`\`\n`,
    isHot: true, views: 1240, date: '2026-03-20'
  },
  {
    id: 102, colId: 2,
    title: 'MNA 矩阵求解基础',
    content: `# MNA 矩阵求解基础\n\n修正节点分析法（MNA）是电路仿真的核心算法。\n\n## 基本方程\n\nGx = b\n\n其中 G 为电导矩阵，x 为未知量向量，b 为激励向量。\n`,
    isHot: true, views: 980, date: '2026-03-25'
  }
];

export const my_d1 = {
  "d1_databases": [
    {
      "binding": "my_blog_db",
      "database_name": "my-blog-db",
      "database_id": "5771c031-4809-494e-b4a4-3e3909596282"
    }
  ]
};

export const my_r2 = {
  "r2_buckets": [
    {
      "bucket_name": "my-blog-assets",
      "binding": "my_blog_assets"
    }
  ]
};



export const store = reactive({
  isAdmin: true,
  columns: [
    { id: 0, name: '📋 所有文章' },
    { id: 1, name: '船舶自动化' },
    { id: 2, name: '电路仿真算法' }
  ],
  articles: initialArticles,
  comments: [
    { id: 1, artId: 101, user: 'Visitor_A', text: '很有用的算法！', date: '2026-03-26' }
  ],
  currentColId: 0,
  selectedArticle: null,
  searchQuery: '',

  // 专栏管理
  addColumn(name) {
    this.columns.push({ id: Date.now(), name });
  },
  renameColumn(id, newName) {
    const col = this.columns.find(c => c.id === id);
    if (col && id !== 0) col.name = newName;
  },
  deleteColumn(id) {
    if (id === 0) return;
    this.columns = this.columns.filter(c => c.id !== id);
    this.articles.forEach(a => { if (a.colId === id) a.colId = 0; });
  },

  // 文章管理
  publishArticle(newArt) {
    this.articles.unshift({
      ...newArt,
      id: Date.now(),
      views: 0,
      date: new Date().toISOString().slice(0, 10)
    });
  },
  updateArticle(updated) {
    const idx = this.articles.findIndex(a => a.id === updated.id);
    if (idx !== -1) this.articles[idx] = { ...this.articles[idx], ...updated };
  },
  deleteArticle(id) {
    this.articles = this.articles.filter(a => a.id !== id);
    if (this.selectedArticle?.id === id) this.selectedArticle = null;
  },
  toggleHot(id) {
    const art = this.articles.find(a => a.id === id);
    if (art) art.isHot = !art.isHot;
  },

  // 评论管理
  addComment(artId, user, text) {
    this.comments.push({
      id: Date.now(),
      artId,
      user: user || '匿名访客',
      text,
      date: new Date().toISOString().slice(0, 10)
    });
  },
  deleteComment(id) {
    this.comments = this.comments.filter(c => c.id !== id);
  }
});
