import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // onnxruntime-web ships wasm + worker files that must not be pre-bundled.
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
})
