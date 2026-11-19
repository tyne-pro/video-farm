import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Сторінка програми: http://127.0.0.1:4747/studio/. Композиція ролика — та сама, що збирає фінал (../remotion).
export default defineConfig({
  base: '/studio/',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'remotion', '@remotion/google-fonts', '@remotion/player'] },
  server: { fs: { allow: ['..'] }, proxy: { '/api': 'http://127.0.0.1:4747', '/root': 'http://127.0.0.1:4747' } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
})
