import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command }) => ({
  base: process.env.VITE_APP_BASE || (command === 'serve' ? '/' : '/guardian/admin/'),
  plugins: [vue()],
  server: { port: 8081, proxy: { '/api': 'http://127.0.0.1:8791', '/ws': { target: 'ws://127.0.0.1:8791', ws: true } } },
}))
