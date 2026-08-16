import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router' // 导入上面的路由配置

const app = createApp(App)
app.use(router) // 必须使用
app.mount('#app')
