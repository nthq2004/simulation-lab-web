import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => {
  const isOne = mode === 'one'

  return {
    base: './',

    // 开发服务器：避开 Windows 保留/排除端口段（netsh 显示 5175~5274 被占用，
    // 落在其中会报 EACCES: permission denied）。固定用 8080，被占用时自动 +1。
    server: {
      port: 8080,
      strictPort: false,
    },
    preview: {
      port: 8080,
      strictPort: false,
    },

    plugins: [
      isOne && viteSingleFile()
    ].filter(Boolean),

    build: {
      // 防止覆盖原构建
      outDir: isOne ? 'dist-one' : 'dist',

      // 单文件关键配置
      cssCodeSplit: !isOne,
      assetsInlineLimit: isOne ? 100000000 : 4096,
      chunkSizeWarningLimit: 2000, // 或更大（单位 KB）

      rollupOptions: isOne
        ? {
            output: {
              manualChunks: undefined,
              inlineDynamicImports: true
            }
          }
        : {}
    }
  }
})
