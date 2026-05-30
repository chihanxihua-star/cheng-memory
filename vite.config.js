import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
// 多入口：主壳(index.html=/) + 聊天独立页(chat.html=/chat/)。
// 同仓库共享 src/lib 等公共代码,各自打包、互不拖累。
// 注意:项目是 ESM(package.json type:module),不能用 __dirname,用 fileURLToPath(new URL(...)).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        chat: fileURLToPath(new URL('./chat.html', import.meta.url)),
      },
    },
  },
})
