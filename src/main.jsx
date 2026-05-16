import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Eruda：手机端 console 浮窗，已被操作日志替代，需要时取消注释
// ;(() => {
//   const s = document.createElement('script')
//   s.src = 'https://cdn.jsdelivr.net/npm/eruda@3'
//   s.onload = () => { try { window.eruda && window.eruda.init() } catch (e) {} }
//   document.head.appendChild(s)
// })()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
