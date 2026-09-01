import React, { useEffect, useRef } from 'react'

// 顶部实时对话气泡：飘出几秒后消失，不做历史记录
export default function ToastDialogue({ dialogues }) {
  return (
    <div className="toast-stack">
      {dialogues.map((d, i) => <ToastBubble key={d.id} d={d} />)}
    </div>
  )
}

function ToastBubble({ d }) {
  return (
    <div className="toast-bubble" style={{ borderLeftColor: d.color }}>
      <div className="toast-speaker" style={{ color: d.color }}>{d.name}</div>
      <div className="toast-text">{d.text}</div>
    </div>
  )
}
