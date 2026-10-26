import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import {fileURLToPath,URL} from 'node:url'
export default defineConfig({
 plugins:[vue(),tailwindcss()],
 resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
 base:'./',
 build:{target:'es2022',outDir:'../plugins/foldMemo/static/app',emptyOutDir:true,
  assetsInlineLimit:4096,cssCodeSplit:true,rollupOptions:{output:{manualChunks:{framework:['vue']}}}}
})
