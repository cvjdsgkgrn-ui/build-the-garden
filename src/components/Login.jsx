import React, { useState } from 'react'

const AVATARS = [
  { id: 'c1', color: '#b75c3a', name: '赭石' },
  { id: 'c2', color: '#c4956a', name: '木' },
  { id: 'c3', color: '#6b8e7a', name: '青' },
  { id: 'c4', color: '#8a8378', name: '石' },
  { id: 'c5', color: '#5a6a80', name: '靛' },
  { id: 'c6', color: '#b03a2e', name: '朱' },
]
const IDENTITIES = ['游园客', '营造者', '题字人']

export default function Login({ onEnter }) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('c1')
  const [identity, setIdentity] = useState('营造者')

  const enter = () => {
    if (!name.trim()) return
    const chosen = AVATARS.find(a => a.id === avatar)
    onEnter({ name: name.trim(), avatar, color: chosen.color, identity })
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">营造之间</div>
        <div className="login-sub">BUILD THE GARDEN</div>
        <div className="login-line"></div>

        <div className="login-field">
          <label>给自己取个名号</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="如：山月 · 一樵 · 拾径人" maxLength={8} autoFocus />
        </div>

        <div className="login-field">
          <label>选一位园中人</label>
          <div className="avatar-grid">
            {AVATARS.map(a => (
              <div key={a.id}
                className={'avatar' + (avatar === a.id ? ' selected' : '')}
                onClick={() => setAvatar(a.id)}>
                <div className="fig" style={{ background: a.color }}></div>
              </div>
            ))}
          </div>
        </div>

        <div className="login-field">
          <label>你的身份</label>
          <div className="opt-row">
            {IDENTITIES.map(id => (
              <div key={id}
                className={'opt' + (identity === id ? ' selected' : '')}
                onClick={() => setIdentity(id)}>{id}</div>
            ))}
          </div>
        </div>

        <button className="login-btn" onClick={enter} disabled={!name.trim()}>
          {name.trim() ? `以「${name.trim()}」入园` : '入园'}
        </button>
        <div className="login-tiny">扫码进入 · 与众人同造一座园</div>
      </div>
    </div>
  )
}
