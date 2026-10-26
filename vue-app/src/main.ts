import { createApp } from 'vue'
import App from './App.vue'
import {kodboxRequested,initCloudStore} from './lib/kodbox-bridge'
import './assets/main.css'
import './assets/theme.css'
import './assets/notedesk.css'
import './assets/glass.css'
import './assets/glass-104-exact.css'
import './assets/notedesk-201.css'
import './assets/modern-appdown.css'
import './assets/theme-panel.css'
if(kodboxRequested){
  try { await initCloudStore() }
  catch(e) { document.querySelector('#app')!.textContent = 'KodBox FoldMemo 初始化失败：'+String(e instanceof Error?e.message:e); throw e }
}
window.__FOLDMEMO_TEMPLATE__ = '<!doctype html>\n' + document.documentElement.outerHTML
createApp(App).mount('#app')
