import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /api/stt/* proxies to the local faster-whisper service (server/main.py),
// so the browser stays same-origin and CORS never enters the picture.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/stt': {
        target: 'http://127.0.0.1:8100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/stt/, ''),
      },
    },
  },
})
