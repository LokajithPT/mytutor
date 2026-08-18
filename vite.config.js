import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// alphacephei.com doesn't send CORS headers, so the browser can't fetch the
// model directly. Proxy it through the dev server (same-origin) instead.
// For production, host the model file yourself and point MODEL_URL at it.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/vosk-models': {
        target: 'https://alphacephei.com/vosk/models',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/vosk-models/, ''),
      },
    },
  },
})
