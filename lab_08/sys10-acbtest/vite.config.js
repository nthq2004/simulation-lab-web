import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => {
  const isOne = mode === 'one'

  return {
    base: './',

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