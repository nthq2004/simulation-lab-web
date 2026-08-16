import { createRouter, createWebHistory } from 'vue-router'
import BlogLayout from '../components/BlogLayout.vue'
import MarkdownViewer from '../components/MarkdownViewer.vue'

const routes = [
    {
        path: '/',
        component: BlogLayout,
        children: [
            {
                // 注意：子路由的 path 不要带 /，它会自动拼接成 /article/:id
                path: 'article/:id',
                name: 'article-detail',
                component: MarkdownViewer,
                props: true
            },
            {
                path: 'article/new', // 新增：发布文章的路由
                name: 'article-new',
                component: MarkdownViewer
            }
        ]
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router