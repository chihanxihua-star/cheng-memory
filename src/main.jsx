import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Eruda：在手机屏幕上画一个 console 浮窗，iOS + Windows 也能直接看 log
// 暂时无条件开，调完了删
;(() => {
  const s = document.createElement('script')
  s.src = 'https://cdn.jsdelivr.net/npm/eruda@3'
  s.onload = () => { try { window.eruda && window.eruda.init() } catch (e) {} }
  document.head.appendChild(s)
})()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
