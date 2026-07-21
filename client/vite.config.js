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
  optimizeDeps: {
    // 両方のHTMLエントリを最初からスキャンさせないと、mockup.html に直接アクセスしたときに
    // 依存関係が段階的に見つかって何度も再最適化→リロードを繰り返し、
    // その途中で "Invalid hook call" になることがある。
    entries: ['index.html', 'mockup.html'],
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@react-three/fiber',
      '@react-three/drei',
      'three',
    ],
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
