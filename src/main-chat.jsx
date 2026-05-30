import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ChatPanel from './ChatPanel.jsx'
import PasswordGate from './PasswordGate.jsx'

// 软键盘弹出/收起时根容器高度跟随 visualViewport（拆分前这段在 MemoryManager 里，
// 聊天独立入口不经过它，需在此复制一份，否则 /chat/ 打字时界面跳、输入框被键盘顶没）。
;(() => {
  const root = document.documentElement
  const vv = window.visualViewport
  const update = () => {
    const h = vv ? vv.height : window.innerHeight
    root.style.setProperty('--app-height', h + 'px')
    if (vv && vv.height >= window.innerHeight - 1 && window.scrollY !== 0) {
      window.scrollTo(0, 0)
    }
  }
  update()
  if (vv) {
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
  } else {
    window.addEventListener('resize', update)
  }
})()

// 主题：跟主壳一致，启动时把 data-theme 写到 <html>（否则 /chat/ 不读主壳的主题逻辑会用默认色）
;(() => {
  let pref = localStorage.getItem('chat-theme') || 'light'
  if (pref === 'system') {
    pref = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.setAttribute('data-theme', pref)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = pref === 'dark' ? '#2A2A2C' : '#FBFAF6'
})()

// 聊天独立入口（/chat/）。PasswordGate：无 token 时弹登录（拆分前靠主壳的门，独立后须自带，
// 否则直接开 /chat/ 没 token → /api 全 401 → 澄 unauthorized）。onBack = 回主壳首页（/）。
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PasswordGate>
      <ChatPanel onBack={() => { window.location.href = '/' }} />
    </PasswordGate>
  </StrictMode>,
)
