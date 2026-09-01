// 营造之间 · 共享同步服务器
// 一台 Mac 跑一个 Node 服务：静态文件 + WebSocket 同步 + AI 对话代理
// 用法: DEEPSEEK_API_KEY=xxx node server/garden-server.mjs
import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
// 与前端共享园子常量（区块规模/细格），保证服务器校验与前端一致
import { ZONES, ZONE_SIZE } from '../src/store/types.js'
import { checkPlacement } from '../src/store/gardenState.js'
import { resolveServerPort } from './serverConfig.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = resolveServerPort(process.env.PORT)
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'
const MAX_CHAT_BODY_BYTES = 64 * 1024
const CHAT_WINDOW_MS = 60_000
const MAX_CHAT_REQUESTS_PER_WINDOW = 20
const chatWindows = new Map()

// ===== 园子状态（持久化到 state.json，重启自动恢复）=====
const STATE_FILE = process.env.GARDEN_STATE_FILE
  ? path.resolve(process.env.GARDEN_STATE_FILE)
  : path.join(__dirname, 'state.json')

// 原子写 + 防抖：临时文件再 rename，避免写一半崩溃损坏 state.json
let saveTimer = null
function saveState() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const tmp = STATE_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify({ constructs: state.constructs, savedAt: Date.now() }))
      fs.renameSync(tmp, STATE_FILE)
    } catch (e) { console.log('[persist] 保存失败:', e.message) }
  }, 300)
}
function flushSave() {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  try {
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ constructs: state.constructs, savedAt: Date.now() }))
    fs.renameSync(tmp, STATE_FILE)
  } catch (e) { console.log('[persist] 退出保存失败:', e.message) }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (Array.isArray(d.constructs)) {
      state.constructs = d.constructs
      console.log(`[persist] 已从 state.json 恢复 ${d.constructs.length} 个构件`)
    }
  } catch (e) { console.log('[persist] 恢复失败:', e.message) }
}

const state = {
  constructs: [],   // 已营造构件 [{id, typeId, gx, gz, author, ts, text?}]
  visitors: [],     // 在园的人 [{id, name, avatar, color}]
}
loadState()

// ===== DeepSeek 对话代理（Key 存后端）=====
async function handleChat(req, res) {
  let body = ''
  let bodyBytes = 0
  for await (const chunk of req) {
    bodyBytes += chunk.length
    if (bodyBytes <= MAX_CHAT_BODY_BYTES) body += chunk
  }
  if (bodyBytes > MAX_CHAT_BODY_BYTES) {
    res.writeHead(413); res.end('request too large'); return
  }
  const clientIp = req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const currentWindow = chatWindows.get(clientIp)
  if (!currentWindow || now >= currentWindow.resetAt) {
    chatWindows.set(clientIp, { count: 1, resetAt: now + CHAT_WINDOW_MS })
  } else if (currentWindow.count >= MAX_CHAT_REQUESTS_PER_WINDOW) {
    res.writeHead(429); res.end('too many requests'); return
  } else {
    currentWindow.count += 1
  }
  let data
  try { data = JSON.parse(body) } catch { res.writeHead(400); res.end('bad json'); return }
  const { messages } = data
  const validMessages = Array.isArray(messages)
    && messages.length > 0
    && messages.length <= 20
    && messages.every((message) => (
      message
      && ['system', 'user', 'assistant'].includes(message.role)
      && typeof message.content === 'string'
      && message.content.length <= 2000
    ))
  if (!validMessages) { res.writeHead(400); res.end('invalid messages'); return }

  if (!DEEPSEEK_KEY) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: '服务器未配置 DEEPSEEK_API_KEY' }))
    return
  }

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.8,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(30000),
    })
    const j = await resp.json()
    const text = j?.choices?.[0]?.message?.content
    if (!text) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'AI 无返回', detail: j }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ text }))
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: e.message }))
  }
}

// ===== 静态文件服务（发前端构建产物）=====
const MIME = {
  '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.glb':'model/gltf-binary',
  '.gltf':'model/gltf+json', '.hdr':'application/octet-stream', '.ico':'image/x-icon',
  '.svg':'image/svg+xml', '.woff2':'font/woff2',
}
function serveStatic(req, res) {
  // 状态查询端点（调试用）
  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ constructs: state.constructs, visitors: state.visitors }))
    return
  }
  // AI 对话代理
  if (req.url === '/api/chat' && req.method === 'POST') {
    return handleChat(req, res)
  }
  // 非法 URL 编码直接 400，避免 decodeURIComponent 抛异常拖垮进程
  let urlPath
  try { urlPath = decodeURIComponent(req.url.split('?')[0]) } catch {
    res.writeHead(400); res.end('Bad Request'); return
  }
  if (urlPath === '/') urlPath = '/index.html'
  const distRoot = path.join(ROOT, 'dist')
  const filePath = path.resolve(distRoot, '.' + urlPath)
  // 用相对路径校验，杜绝前缀匹配绕过（如 /../dist2/...）
  const rel = path.relative(distRoot, filePath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403); res.end('Forbidden'); return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return }
    const ext = path.extname(filePath).toLowerCase()
    // 缓存策略：index.html 不缓存（防止浏览器残留旧版页面导致 WS 连错端口/旧代码）；
    // 带 hash 的构建产物长缓存
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' }
    if (urlPath.endsWith('.html')) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    } else {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    }
    res.writeHead(200, headers)
    res.end(data)
  })
}

// ===== WebSocket 同步 =====
const server = http.createServer(serveStatic)
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 })

// 操作权限校验：构件无主（author 缺失/为 0，如历史数据）允许任何人操作；
// 有主构件只能由本人移动/旋转/删除。
// 身份一律取服务端 join 时记录的 ws.userId，忽略客户端自报的 author（防同名/伪造绕过）
function ownsConstruct(target, ws) {
  const owner = target.author
  if (!owner || owner === 0 || owner === '0') return true
  const caller = ws.userId || ''
  const legacyNameMatch = ws.userName && String(owner) === String(ws.userName)
  const ok = String(owner) === String(caller) || legacyNameMatch
  if (legacyNameMatch) {
    target.author = caller
    target.authorName = ws.userName
  }
  if (!ok) console.log('[sync] 权限拒绝:', caller, '试图操作', target.typeId, target.id, '（作者:', owner, '）')
  return ok
}

// 构件字段校验（服务器侧，防垃圾数据污染 state.json）
// 常量与前端 src/store/types.js 共享（ZONES/ZONE_SIZE）
function validItem(it) {
  if (!it || typeof it !== 'object') return false
  if (typeof it.id !== 'string' || !it.id || it.id.length > 64) return false
  if (typeof it.typeId !== 'string' || !it.typeId || it.typeId.length > 20) return false
  const num = (v) => Number.isInteger(v)
  if (!num(it.zoneX) || !num(it.zoneZ) || !num(it.gx) || !num(it.gz)) return false
  if (it.zoneX < 0 || it.zoneX >= ZONES.W || it.zoneZ < 0 || it.zoneZ >= ZONES.H) return false
  if (it.gx < 0 || it.gx >= ZONE_SIZE || it.gz < 0 || it.gz >= ZONE_SIZE) return false
  if (![0, 90, 180, 270].includes(it.rotation ?? 0)) return false
  return true
}

// 规整出一个合法构件（author 强制为服务端记录的用户 id）
function makeItem(it, ws) {
  return {
    id: it.id, typeId: it.typeId, zoneX: it.zoneX, zoneZ: it.zoneZ, gx: it.gx, gz: it.gz,
    rotation: it.rotation ?? 0, author: ws.userId || '', authorName: ws.userName || '',
    ts: Number.isFinite(it.ts) ? it.ts : Date.now(),
    ...(typeof it.text === 'string' && it.text.length <= 12 ? { text: it.text } : {}),
  }
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload })
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  }
}

wss.on('connection', (ws) => {
  console.log('[sync] 新连接，当前连接数:', wss.clients.size)
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
  ws.send(JSON.stringify({ type: 'snapshot', constructs: state.constructs, visitors: state.visitors }))
  // 记录本连接关联的用户 id（用于断开时移除）
  ws.userId = null
  ws.userName = null

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    switch (msg.type) {
      case 'join': {
        if (ws.userId) break
        const id = typeof msg.id === 'string' ? msg.id.trim() : ''
        if (!/^u-[\p{L}\p{N}._-]{3,61}$/u.test(id)) {
          ws.send(JSON.stringify({ type: 'error', error: 'invalid visitor id' }))
          ws.close(4003, 'Invalid visitor id')
          return
        }
        const duplicate = [...wss.clients].some(c => c !== ws && c.readyState === WebSocket.OPEN && c.userId === id)
        if (duplicate) {
          ws.send(JSON.stringify({ type: 'error', error: 'visitor id already active' }))
          ws.close(4009, 'Visitor already active')
          return
        }
        const name = typeof msg.name === 'string' ? msg.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : ''
        const avatar = /^c[1-6]$/.test(msg.avatar) ? msg.avatar : 'c1'
        const color = /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : '#b75c3a'
        const v = { id, name: name || '游园客', avatar, color }
        ws.userId = v.id
        ws.userName = v.name
        // 去重：同 id 已存在则不重复加（同一用户刷新/重连）
        if (!state.visitors.some(e => e.id === v.id)) {
          state.visitors.push(v)
        }
        broadcast('visitor-join', { visitor: v, count: state.visitors.length })
        console.log('[sync] 入园:', v.name, '当前游客:', state.visitors.length)
        break
      }
      case 'construct-add': {
        if (!ws.userId) break
        const it = msg.item
        if (!validItem(it)) { console.log('[sync] 拒绝非法构件:', JSON.stringify(it)?.slice(0, 120)); break }
        if (state.constructs.some(c => c.id === it.id)) break
        const placement = checkPlacement(it.typeId, it.zoneX, it.zoneZ, it.gx, it.gz, state.constructs, it.rotation)
        if (!placement.ok) { console.log('[sync] 拒绝非法放置:', placement.reason); break }
        const item = makeItem(it, ws)
        state.constructs.push(item)
        broadcast('construct-added', { item })
        saveState()
        console.log('[sync] 营造:', item.author, item.typeId, `z(${item.zoneX},${item.zoneZ})`, item.gx, item.gz, 'rot', item.rotation)
        break
      }
      case 'construct-add-batch': {
        if (!ws.userId) break
        // 湖画笔等一次多格：批量接收，一条消息一个广播
        const list = Array.isArray(msg.items) ? msg.items.slice(0, 200) : []
        const added = []
        for (const it of list) {
          if (!validItem(it) || state.constructs.some(c => c.id === it.id)) continue
          if (!checkPlacement(it.typeId, it.zoneX, it.zoneZ, it.gx, it.gz, state.constructs, it.rotation).ok) continue
          const item = makeItem(it, ws)
          state.constructs.push(item)
          added.push(item)
        }
        if (added.length) {
          broadcast('construct-added-batch', { items: added })
          saveState()
          console.log('[sync] 批量营造:', added.length, '个', added[0]?.author, added[0]?.typeId)
        }
        break
      }
      case 'construct-move': {
        if (!ws.userId) break
        // 移动构件到新位置
        const { id, zoneX, zoneZ, gx, gz } = msg
        const target = state.constructs.find(c => c.id === id)
        if (target) {
          if (!ownsConstruct(target, ws)) break
          const candidate = { ...target, zoneX, zoneZ, gx, gz }
          if (!validItem(candidate)) break
          const others = state.constructs.filter(c => c.id !== id)
          if (!checkPlacement(target.typeId, zoneX, zoneZ, gx, gz, others, target.rotation).ok) break
          target.zoneX = zoneX; target.zoneZ = zoneZ; target.gx = gx; target.gz = gz
          broadcast('construct-moved', { id, zoneX, zoneZ, gx, gz })
          saveState()
          console.log('[sync] 移动:', id, `-> z(${zoneX},${zoneZ})`, gx, gz)
        }
        break
      }
      case 'construct-rotate': {
        if (!ws.userId) break
        const { id, rotation } = msg
        const target = state.constructs.find(c => c.id === id)
        if (target) {
          if (!ownsConstruct(target, ws)) break
          if (![0, 90, 180, 270].includes(rotation)) break
          const others = state.constructs.filter(c => c.id !== id)
          if (!checkPlacement(target.typeId, target.zoneX, target.zoneZ, target.gx, target.gz, others, rotation).ok) break
          target.rotation = rotation
          broadcast('construct-rotated', { id, rotation })
          saveState()
          console.log('[sync] 旋转:', id, 'rot', rotation)
        }
        break
      }
      case 'construct-remove': {
        if (!ws.userId) break
        const { id } = msg
        const target = state.constructs.find(c => c.id === id)
        if (target && !ownsConstruct(target, ws)) break
        state.constructs = state.constructs.filter(c => c.id !== id)
        broadcast('construct-removed', { id })
        saveState()
        console.log('[sync] 删除:', id)
        break
      }
      case 'construct-restore': {
        if (!ws.userId) break
        // 恢复被删构件（撤回删除）：仅限本人删除的构件（或无主历史数据）
        const it = msg.item
        if (!validItem(it) || state.constructs.some(c => c.id === it.id)) break
        if (!ownsConstruct(it, ws)) break
        const others = state.constructs.filter(c => c.id !== it.id)
        if (!checkPlacement(it.typeId, it.zoneX, it.zoneZ, it.gx, it.gz, others, it.rotation).ok) break
        const item = makeItem(it, ws)
        state.constructs.push(item)
        broadcast('construct-added', { item })
        saveState()
        console.log('[sync] 恢复:', item.typeId, item.id)
        break
      }
      case 'leave': {
        // 只允许移除自己（防伪造别人 id 踢人）
        if (msg.id !== ws.userId) break
        state.visitors = state.visitors.filter(v => v.id !== msg.id)
        broadcast('visitor-leave', { id: msg.id, count: state.visitors.length })
        break
      }
    }
  })

  ws.on('close', () => {
    // 断开：若该用户没有其他活跃连接，才从游客列表移除
    if (ws.userId) {
      const stillActive = [...wss.clients].some(c => c !== ws && c.readyState === WebSocket.OPEN && c.userId === ws.userId)
      if (!stillActive) {
        const wasPresent = state.visitors.some(v => v.id === ws.userId)
        state.visitors = state.visitors.filter(v => v.id !== ws.userId)
        if (wasPresent) {
          broadcast('visitor-leave', { id: ws.userId, count: state.visitors.length })
          console.log('[sync] 离开:', ws.userId, '当前游客:', state.visitors.length)
        }
      }
    }
    console.log('[sync] 断开，当前连接数:', wss.clients.size)
  })
})

server.listen(PORT, () => {
  console.log('营造之间 同步服务器已启动')
  console.log(`  本机:   http://127.0.0.1:${PORT}`)
  console.log(`  局域网: http://<本机IP>:${PORT}`)
})

// ── 心跳检测：30s 无响应即断开（清理断网残留的连接/游客） ──
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue }
    ws.isAlive = false
    try { ws.ping() } catch {}
  }
}, 30000)
wss.on('close', () => clearInterval(heartbeat))

// ── 优雅退出：先落盘防抖中的状态，再退出 ──
function gracefulShutdown(signal) {
  console.log(`[server] 收到 ${signal}，保存状态并退出...`)
  flushSave()
  process.exit(0)
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
