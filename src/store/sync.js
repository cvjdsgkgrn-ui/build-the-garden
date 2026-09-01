// 营造之间 · WS 同步客户端
// 管理 WebSocket 连接 + 重连 + 事件分发
// 用 location.hostname 动态拼地址：手机/局域网设备打开页面时连到「服务器」而不是自己；
// 端口跟随页面当前端口（生产模式页面与服务器同端口；dev 模式由 vite 代理 /ws 转发）
export function getWebSocketUrl(locationLike = globalThis.location) {
  const hostname = locationLike?.hostname || '127.0.0.1'
  const port = locationLike?.port ? `:${locationLike.port}` : (locationLike ? '' : ':8088')
  const protocol = locationLike?.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${hostname}${port}/ws`
}

const WS_URL = getWebSocketUrl()

let ws = null
let reconnectTimer = null
let closed = false
const listeners = new Set()

export function getStableVisitorId(name, { storage = globalThis.localStorage, random = Math.random } = {}) {
  let suffix = ''
  try { suffix = storage?.getItem('garden_visitor_suffix') || '' } catch {}
  if (!/^[a-z0-9]{4}$/.test(suffix)) {
    suffix = random().toString(36).slice(2, 6).padEnd(4, '0').slice(0, 4)
    try { storage?.setItem('garden_visitor_suffix', suffix) } catch {}
  }
  const normalizedName = String(name || 'guest')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '')
    .slice(0, 10) || 'guest'
  return `u-${normalizedName}-${suffix}`
}

export function initSync({ name, avatar, color }) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  closed = false
  // 同一浏览器刷新 → 同 id → 服务器去重不累加；不同浏览器同名 → 不同 id → 正确区分
  const id = getStableVisitorId(name)
  const me = { id, name, avatar, color }
  connect(me)
  return () => { closed = true; ws?.close() }
}

function connect(me) {
  ws = new WebSocket(WS_URL)
  ws.onopen = () => {
    emit('conn', { state: 'connected' })
    ws.send(JSON.stringify({ type: 'join', id: me.id, name: me.name, avatar: me.avatar, color: me.color }))
  }
  ws.onmessage = (e) => {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    emit(msg.type, msg)
  }
  ws.onclose = () => {
    emit('conn', { state: 'disconnected' })
    if (!closed) reconnectTimer = setTimeout(() => connect(me), 2000)
  }
  ws.onerror = () => ws?.close()
}

export function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

export function onSync(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit(type, payload) {
  listeners.forEach(fn => fn(type, payload))
}
