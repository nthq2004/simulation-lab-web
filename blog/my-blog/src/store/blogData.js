import { reactive } from 'vue';

export const store = reactive({
  columns: [
    { id: 1, name: '船舶自动化' },
    { id: 2, name: '电路仿真算法' },
    { id: 3, name: 'Vue 实战技巧' }
  ],
  articles: [
    { id: 101, colId: 1, title: 'PID水温控制逻辑解析', content: '# PID逻辑\n\n本文介绍船舶冷却水系统的PID调节器实现...', isHot: true, views: 1240 },
    { id: 102, colId: 2, title: 'MNA矩阵求解基础', content: '# MNA基础\n\n修改节点分析法是电路仿真的核心...', isHot: true, views: 980 },
    { id: 103, colId: 1, title: '柴油机故障注入实验', content: '# 故障模拟\n\n关于PT100短路显示LLLL的逻辑...', isHot: false, views: 450 }
  ],
  searchQuery: '',
  currentColId: 1,
  selectedArticle: null
});