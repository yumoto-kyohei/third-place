import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/third-place/',
  plugins: [react()],
  // react-three-fiber が別のReactインスタンスを掴んで "Invalid hook call" になるのを防ぐ
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      input: {
        // 本番アプリ
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        // 2.5D検証用モックアップ（本番とは独立。/third-place/mockup.html で配信）
        mockup: fileURLToPath(new URL('mockup.html', import.meta.url)),
      },
    },
  },
})
