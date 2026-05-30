import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ChatPanel from './ChatPanel.jsx'

// 聊天独立入口（/chat/）。onBack = 回主壳首页（/）。
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ChatPanel onBack={() => { window.location.href = '/' }} />
  </StrictMode>,
)
