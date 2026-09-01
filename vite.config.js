import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    proxy: {
      // 注意：同步服务器端口可用 PORT 环境变量覆盖（如 PORT=8088 npm run dev:server），此处需保持一致
      '/api': {
        target: 'http://127.0.0.1:8088',
        changeOrigin: true,
      },
      // dev 模式：WS 也经 vite 代理到同步服务器（前端 WS_URL 跟随页面端口）
      '/ws': {
        target: 'ws://127.0.0.1:8088',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    // 分包：three / react / r3f 独立 chunk，局域网首屏加载更快
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
})
