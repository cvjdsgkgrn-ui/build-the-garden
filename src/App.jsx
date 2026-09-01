import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Login from './components/Login.jsx'
import CharacterSystem from './components/CharacterSystem.jsx'
import ToastDialogue from './components/ToastDialogue.jsx'
import { useCharacterLoop } from './hooks/useCharacterLoop.js'
import { buildWalkMap } from './store/nav.js'
import { Ground, Constructs, HoverCell, PickIndicator } from './components/GardenScene.jsx'
import { TYPES } from './store/types.js'
import { CELL, ZONE_SIZE } from './store/types.js'
import { CHARACTERS } from './store/characters.js'
import { worldToZone, inGarden, checkPlacement, canPlaceLake, toGlobalCell, fromGlobalCell } from './store/gardenState.js'
import { getStableVisitorId, initSync, send, onSync } from './store/sync.js'
import { buildPath } from './store/path.js'

// 构件 id 生成：crypto.randomUUID 仅 secure context（https/localhost）可用，
// 局域网 IP 访问（http://192.168.x.x）时回退到随机串，保证展演现场可用
const uid = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Date.now().toString(36))

const ROAD_TYPES = Object.values(TYPES).filter(t => t.tool === 'road')
const PLACE_TYPES = Object.values(TYPES).filter(t => t.tool === 'place')
const WATER_TYPES = Object.values(TYPES).filter(t => t.tool === 'water')
const BUILD_TYPES = Object.values(TYPES).filter(t => t.tool === 'build')
// 亭子系列：建筑工具下二级菜单（亭5/6/7/8）
const PAVILION_IDS = ['亭5', '亭6', '亭7', '亭8']

export default function App() {
  // 登录态持久化：刷新/热更新后自动恢复，不回登录页（展演现场观众刷新不掉线）
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('garden-user')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  const authorId = useMemo(() => user ? getStableVisitorId(user.name) : '', [user])
  const [tool, setTool] = useState('road')
  const [items, setItems] = useState([])
  // 标记点击构件的时刻（用于 Ground.onPick 判断是否跳过放置）
  const clickedConstruct = useRef(0)
  const [road, setRoad] = useState({ start: null, end: null })
  const [roadType, setRoadType] = useState(ROAD_TYPES[0].id)
  const [placeSel, setPlaceSel] = useState(null)
  const [waterSel, setWaterSel] = useState(null)
  const [buildSel, setBuildSel] = useState(null)
  const [pavilionOpen, setPavilionOpen] = useState(false)  // 亭子二级菜单展开
  const [rotation, setRotation] = useState(0)   // 放置前构件旋转（0/90度）
  const [brushSize, setBrushSize] = useState(1) // 湖画笔大小（1/3/5）
  const [plaqueText, setPlaqueText] = useState('') // 书画工具：观众题的匾额文字
  const [selectedId, setSelectedId] = useState(null)  // 选中的构件
  const [editing, setEditing] = useState(null)  // null | 'move' | 'rotate' | 'remove'
  const [moveOffset, setMoveOffset] = useState({ dx: 0, dz: 0 })  // 移动预览偏移（格）
  const [clipboard, setClipboard] = useState(null)  // 复制的构件
  const [history, setHistory] = useState([])    // 撤回栈（自己的操作）
  const [hover, setHover] = useState(null)
  const [online, setOnline] = useState(0)
  const [connState, setConnState] = useState('idle')
  const [notice, setNotice] = useState('')
  // AI 角色 & 实时对话
  const [characters] = useState(() => {
    const pts = [[-4,-3],[3,-2],[0,4]]
    return CHARACTERS.map((c, i) => ({
      ...c, x: pts[i][0], z: pts[i][1], target: null, isResting: false, restTimer: 0,
      isConversing: false, lastConverse: {},
    }))
  })
  const charactersRef = useRef(characters)
  charactersRef.current = characters
  // 可行走地图（路/水/障碍），随 items 更新，供角色寻路
  const walkMap = useMemo(() => buildWalkMap(items), [items])
  const [toasts, setToasts] = useState([])

  // AI 漫步 + 对话
  const handleDialogue = useCallback((turns) => {
    const newToasts = turns.map(t => ({ id: 't-' + Date.now() + '-' + Math.random().toString(36).slice(2,6), ...t }))
    setToasts(prev => [...prev, ...newToasts])
    // 每条对话 5 秒后自动消失
    newToasts.forEach(t => setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== t.id))
    }, 5000))
  }, [])
  useCharacterLoop({ charactersRef, onDialogue: handleDialogue, walkMap })

  // R 键旋转当前构件（仅水景/建筑工具）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' || e.key === 'R') {
        if (tool === 'water' && waterSel) setRotation(r => (r + 90) % 360)
        if (tool === 'build' && buildSel) setRotation(r => (r + 90) % 360)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, waterSel, buildSel])

  // WS 同步
  useEffect(() => {
    if (!user) return
    const off = initSync({ name: user.name, avatar: user.avatar, color: user.color })
    const unsub = onSync((type, msg) => {
      if (type === 'conn') setConnState(msg.state)
      else if (type === 'snapshot') { setItems(msg.constructs || []); setOnline((msg.visitors || []).length) }
      else if (type === 'construct-added') {
        setItems(prev => prev.some(i => i.id === msg.item.id) ? prev : [...prev, msg.item])
      } else if (type === 'construct-added-batch') {
        setItems(prev => {
          const ids = new Set(prev.map(i => i.id))
          const fresh = (msg.items || []).filter(i => !ids.has(i.id))
          return fresh.length ? [...prev, ...fresh] : prev
        })
      } else if (type === 'construct-moved') {
        setItems(prev => prev.map(i => i.id === msg.id ? { ...i, zoneX: msg.zoneX, zoneZ: msg.zoneZ, gx: msg.gx, gz: msg.gz } : i))
      } else if (type === 'construct-rotated') {
        setItems(prev => prev.map(i => i.id === msg.id ? { ...i, rotation: msg.rotation } : i))
      } else if (type === 'construct-removed') {
        setItems(prev => prev.filter(i => i.id !== msg.id))
      } else if (type === 'visitor-join' || type === 'visitor-leave') setOnline(msg.count)
    })
    return () => { unsub(); off?.() }
  }, [user])

  // 引导提示
  useEffect(() => {
    if (!user) return
    const msgs = {
      browse: '园子等着你。选一件工具，开始营造。',
      road: road.start ? '再点一处，作为路的终点。' : '点一处，作为路的起点。',
      place: placeSel ? '点一个格子，放这景。' : '选一样想布下的景。',
      water: waterSel ? '点一个格子，建这座水景。' : '选一座水景来建。',
      build: buildSel ? `已选「${buildSel.id}」，点一个格子建。` : '选一座建筑来建。',
      select: '点一个构件选中它，可移动 / 旋转 / 删除。',
      inscribe: '点一个格子，题上你的字。',
    }
    setNotice(msgs[tool])
  }, [user, tool, road.start, placeSel, waterSel, buildSel])

  const handleHover = useCallback((x, z) => {
    if (x === null || z === null) { setHover(null); return }
    const loc = worldToZone(x, z)
    if (!inGarden(loc.zoneX, loc.zoneZ)) { setHover(null); return }
    setHover(loc)
  }, [])

  // 判断 hover 格子是否可放（所有区块均可改）
  const hoverValid = useCallback((loc) => {
    if (!loc) return false
    if (tool === 'place' && placeSel) return checkPlacement(placeSel.id, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, rotation).ok
    if (tool === 'water' && waterSel) {
      // 湖：画笔逐格，用湖专用检测（桥下虚格可画）
      if (waterSel.id === '湖') return canPlaceLake(items, loc.zoneX, loc.zoneZ, loc.gx, loc.gz).ok
      return checkPlacement(waterSel.id, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, rotation).ok
    }
    if (tool === 'build' && buildSel) return checkPlacement(buildSel.id, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, rotation).ok
    if (tool === 'inscribe') return checkPlacement('匾额', loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, 0).ok
    if (tool === 'road') return checkPlacement(roadType, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, 0).ok
    return false
  }, [tool, placeSel, waterSel, buildSel, roadType, items, rotation])

  // 当前 hover 的 footprint 尺寸（米）：根据工具/选中构件，考虑旋转
  const hoverFootprint = useMemo(() => {
    const sel = (tool === 'place' && placeSel) || (tool === 'water' && waterSel) || (tool === 'build' && buildSel) || null
    if (sel) {
      // 湖：预览显示画笔大小
      if (sel.id === '湖') {
        const bs = brushSize * CELL
        return { w: bs, l: bs }
      }
      const w = sel.footprint[0] * CELL
      const l = sel.footprint[1] * CELL
      // 旋转 90/270 度时宽长互换
      const swapped = rotation === 90 || rotation === 270
      return { w: swapped ? l : w, l: swapped ? w : l }
    }
    return { w: CELL * 0.9, l: CELL * 0.9 }   // 单格（路/书画）
  }, [tool, placeSel, waterSel, buildSel, rotation, brushSize])

  // 当前选中待放置的构件（用于模型预览）
  const previewSel = useMemo(() => {
    if (tool === 'place' && placeSel) return placeSel
    if (tool === 'build' && buildSel) return buildSel
    if (tool === 'water' && waterSel && waterSel.id !== '湖') return waterSel
    if (tool === 'inscribe') return TYPES['匾额']
    return null
  }, [tool, placeSel, buildSel, waterSel])

  const handlePick = useCallback((x, z) => {
    if (!user) return
    // 本次点击刚命中过构件（100ms 内）：Ground 不处理放置，避免干扰选中
    if (clickedConstruct.current && Date.now() - clickedConstruct.current < 100) {
      clickedConstruct.current = 0
      return
    }
    const loc = worldToZone(x, z)
    if (!inGarden(loc.zoneX, loc.zoneZ)) return

    // 点击地面：取消选中（若已选中且不在移动模式）
    if (selectedId && editing !== 'move') {
      setSelectedId(null)
    }

    if (tool === 'road') {
      if (!road.start) setRoad(r => ({ ...r, start: loc }))
      else if (!road.end) setRoad(r => ({ ...r, end: loc }))
    } else if (tool === 'place' && placeSel) {
      const check = checkPlacement(placeSel.id, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, rotation)
      if (!check.ok) { flash(check.reason); return }
      const item = { id: 'it-' + uid(), typeId: placeSel.id, zoneX: loc.zoneX, zoneZ: loc.zoneZ, gx: loc.gx, gz: loc.gz, rotation, author: authorId, ts: Date.now() }
      setHistory(h => [...h.slice(-49), { type: 'add', id: item.id }])
      setItems(prev => [...prev, item]); send({ type: 'construct-add', item })
    } else if (tool === 'water' && waterSel) {
      if (waterSel.id === '湖') {
        // 湖：画笔逐格绘制。以点击格为中心覆盖 brushSize×brushSize，
        // 已有水/被其他构件占用的格子跳过（拱桥中间虚格除外，桥下可画水）
        const half = Math.floor(brushSize / 2)
        const newItems = []
        for (let dx = -half; dx <= half; dx++) {
          for (let dz = -half; dz <= half; dz++) {
            const gx = loc.gx + dx
            const gz = loc.gz + dz
            const zx = loc.zoneX + Math.floor(gx / ZONE_SIZE)
            const zz = loc.zoneZ + Math.floor(gz / ZONE_SIZE)
            const lgx = ((gx % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
            const lgz = ((gz % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
            if (!inGarden(zx, zz)) continue
            const lakeCheck = canPlaceLake(items, zx, zz, lgx, lgz)
            if (!lakeCheck.ok) continue
            newItems.push({ id: 'it-' + uid(), typeId: '湖', zoneX: zx, zoneZ: zz, gx: lgx, gz: lgz, author: authorId, ts: Date.now() })
          }
        }
        if (newItems.length) {
          setHistory(h => [...h.slice(-49), { type: 'add', id: newItems.map(i => i.id) }])
          setItems(prev => [...prev, ...newItems])
          send({ type: 'construct-add-batch', items: newItems })
          setNotice(`画了 ${newItems.length} 格水。`)
        }
      } else {
        // 拱桥等其他水景：单块放置（拱桥中间虚格可跨水）
        const check = checkPlacement(waterSel.id, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, rotation)
        if (!check.ok) { flash(check.reason); return }
        const item = { id: 'it-' + uid(), typeId: waterSel.id, zoneX: loc.zoneX, zoneZ: loc.zoneZ, gx: loc.gx, gz: loc.gz, rotation, author: authorId, ts: Date.now() }
        setItems(prev => [...prev, item]); send({ type: 'construct-add', item })
      }
    } else if (tool === 'build' && buildSel) {
      const check = checkPlacement(buildSel.id, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, rotation)
      if (!check.ok) { flash(check.reason); return }
      const item = { id: 'it-' + uid(), typeId: buildSel.id, zoneX: loc.zoneX, zoneZ: loc.zoneZ, gx: loc.gx, gz: loc.gz, rotation, author: authorId, ts: Date.now() }
      setItems(prev => [...prev, item]); send({ type: 'construct-add', item })
    } else if (tool === 'inscribe') {
      const check = checkPlacement('匾额', loc.zoneX, loc.zoneZ, loc.gx, loc.gz, items, 0)
      if (!check.ok) { flash(check.reason); return }
      const item = { id: 'it-' + uid(), typeId: '匾额', zoneX: loc.zoneX, zoneZ: loc.zoneZ, gx: loc.gx, gz: loc.gz, text: plaqueText.trim() || '清风徐来', author: authorId, ts: Date.now() }
      setItems(prev => [...prev, item]); send({ type: 'construct-add', item })
    }
  }, [user, authorId, tool, road.start, placeSel, waterSel, buildSel, rotation, brushSize, plaqueText, items, editing, selectedId])

  const flash = (msg) => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 1800)
  }

  // 点击构件：选中它（若在编辑模式，点击构件本身不触发）
  const handleSelect = useCallback((it) => {
    if (editing) return
    clickedConstruct.current = Date.now()
    // 总是选中（点击地面取消），避免 toggle 被双重事件翻转
    setSelectedId(it.id)
  }, [editing])

  // 复制选中构件（存到剪贴板）
  const doCopy = useCallback(() => {
    if (!selectedId) return
    const target = items.find(i => i.id === selectedId)
    if (!target) return
    setClipboard({ ...target })
    flash('已复制')
  }, [selectedId, items])

  // 粘贴复制的构件（在复制位置旁边偏移放置）
  const doPaste = useCallback(() => {
    if (!clipboard) { flash('没有复制的内容'); return }
    const c = clipboard
    // 找一个空位（从原位置向右偏移，直到无冲突）
    let gx = c.gx, gz = c.gz, zoneX = c.zoneX, zoneZ = c.zoneZ
    for (let i = 1; i <= 8; i++) {
      let ngx = c.gx + i, ngz = c.gz
      let nzx = c.zoneX + Math.floor(ngx / ZONE_SIZE)
      let nzz = c.zoneZ + Math.floor(ngz / ZONE_SIZE)
      ngx = ((ngx % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
      ngz = ((ngz % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
      if (!inGarden(nzx, nzz)) continue
      const check = checkPlacement(c.typeId, nzx, nzz, ngx, ngz, items, c.rotation)
      if (check.ok) { gx = ngx; gz = ngz; zoneX = nzx; zoneZ = nzz; break }
    }
    const newItem = { id: 'it-' + uid(), typeId: c.typeId, zoneX, zoneZ, gx, gz,
      rotation: c.rotation || 0, author: authorId, ts: Date.now(), text: c.text }
    setHistory(h => [...h.slice(-49), { type: 'add', id: newItem.id }])
    setItems(prev => [...prev, newItem])
    send({ type: 'construct-add', item: newItem })
    setSelectedId(newItem.id)
    flash('已粘贴')
  }, [clipboard, items, authorId])

  const doDelete = useCallback(() => {
    if (!selectedId) return
    const target = items.find(i => i.id === selectedId)
    if (!target) return
    setHistory(h => [...h.slice(-49), { type: 'remove', id: selectedId, item: { ...target } }])
    setItems(prev => prev.filter(i => i.id !== selectedId))
    send({ type: 'construct-remove', id: selectedId })
    setSelectedId(null); setEditing(null)
    flash('已删除')
  }, [selectedId, items])

  // 旋转选中构件（+90°）
  const doRotate = useCallback(() => {
    if (!selectedId) return
    const it = items.find(i => i.id === selectedId)
    if (!it) return
    const newRot = ((it.rotation || 0) + 90) % 360
    setHistory(h => [...h.slice(-49), { type: 'rotate', id: selectedId, rotation: it.rotation || 0 }])
    setItems(prev => prev.map(i => i.id === selectedId ? { ...i, rotation: newRot } : i))
    send({ type: 'construct-rotate', id: selectedId, rotation: newRot })
    flash(`旋转至 ${newRot}°`)
  }, [selectedId, items])

  // 进入移动模式：方向键微调 + 确定
  const doMove = useCallback(() => {
    if (!selectedId) return
    clickedConstruct.current = 0
    setEditing('move'); setHover(null)
    setMoveOffset({ dx: 0, dz: 0 })
    flash('用方向键调整，确定后定位')
  }, [selectedId])

  // 方向键微调（预览偏移）
  const moveDir = useCallback((dx, dz) => {
    if (editing !== 'move') return
    setMoveOffset(o => ({ dx: o.dx + dx, dz: o.dz + dz }))
  }, [editing])

  // 确定移动：应用新位置
  const confirmMove = useCallback(() => {
    if (!selectedId) return
    if (moveOffset.dx === 0 && moveOffset.dz === 0) {
      setSelectedId(null); setEditing(null)
      flash('位置未变化')
      return
    }
    const target = items.find(i => i.id === selectedId)
    if (!target) { setSelectedId(null); setEditing(null); return }
    // 计算新格子（跨区块）
    let gx = target.gx + moveOffset.dx
    let gz = target.gz + moveOffset.dz
    let zoneX = target.zoneX + Math.floor(gx / ZONE_SIZE)
    let zoneZ = target.zoneZ + Math.floor(gz / ZONE_SIZE)
    gx = ((gx % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
    gz = ((gz % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
    if (!inGarden(zoneX, zoneZ)) { flash('超出园界'); return }
    // 冲突检测：footprint 级检测（排除自身），支持旋转后的占位区域
    const others = items.filter(e => e.id !== selectedId)
    const check = checkPlacement(target.typeId, zoneX, zoneZ, gx, gz, others, target.rotation)
    if (!check.ok) { flash(check.reason); return }
    setHistory(h => [...h.slice(-49), { type: 'move', id: selectedId, zoneX: target.zoneX, zoneZ: target.zoneZ, gx: target.gx, gz: target.gz }])
    setItems(prev => prev.map(i => i.id === selectedId ? { ...i, zoneX, zoneZ, gx, gz } : i))
    send({ type: 'construct-move', id: selectedId, zoneX, zoneZ, gx, gz })
    setSelectedId(null); setEditing(null); setMoveOffset({ dx: 0, dz: 0 })
    flash('已移动')
  }, [selectedId, moveOffset, items])

  // 撤回：撤销自己最近一次操作（副作用在 updater 外执行）
  const doUndo = useCallback(() => {
    if (!history.length) { flash('没有可撤回的操作'); return }
    const op = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    if (op.type === 'remove') {
      // 恢复被删构件（通过服务器重新加回）
      if (op.item) {
        setItems(prev => prev.some(i => i.id === op.item.id) ? prev : [...prev, op.item])
        send({ type: 'construct-restore', item: op.item })
        flash('已恢复删除的构件')
      }
    } else if (op.type === 'rotate') {
      setItems(prev => prev.map(i => i.id === op.id ? { ...i, rotation: op.rotation } : i))
      send({ type: 'construct-rotate', id: op.id, rotation: op.rotation })
    } else if (op.type === 'move') {
      // 恢复移动前位置
      setItems(prev => prev.map(i => i.id === op.id ? { ...i, zoneX: op.zoneX, zoneZ: op.zoneZ, gx: op.gx, gz: op.gz } : i))
      send({ type: 'construct-move', id: op.id, zoneX: op.zoneX, zoneZ: op.zoneZ, gx: op.gx, gz: op.gz })
      flash('已撤回移动')
    } else if (op.type === 'add') {
      // id 可能是单值或数组（湖画笔一次多格）
      const ids = Array.isArray(op.id) ? op.id : [op.id]
      ids.forEach(id => {
        setItems(prev => prev.filter(i => i.id !== id))
        send({ type: 'construct-remove', id })
      })
    }
  }, [history])

  // 铺路确认（在全局细格坐标下算路径，支持跨区块）
  const confirmRoad = () => {
    if (!road.start || !road.end) return
    const sG = toGlobalCell(road.start.zoneX, road.start.zoneZ, road.start.gx, road.start.gz)
    const eG = toGlobalCell(road.end.zoneX, road.end.zoneZ, road.end.gx, road.end.gz)
    const path = buildPath(sG.gx, sG.gz, eG.gx, eG.gz)
    const newItems = []
    let blocked = null
    for (const [gx, gz] of path) {
      const loc = fromGlobalCell(gx, gz)
      if (!inGarden(loc.zoneX, loc.zoneZ)) { blocked = { reason: '超出园界' }; break }
      const check = checkPlacement(roadType, loc.zoneX, loc.zoneZ, loc.gx, loc.gz, [...items, ...newItems])
      if (!check.ok) { blocked = { gx, gz, reason: check.reason }; break }
      newItems.push({ id: 'it-' + crypto.randomUUID(), typeId: roadType,
        zoneX: loc.zoneX, zoneZ: loc.zoneZ, gx: loc.gx, gz: loc.gz, author: authorId, ts: Date.now() })
    }
    if (blocked) { setNotice(`路到这里被挡住了：${blocked.reason}`) }
    else if (newItems.length) {
      setItems(prev => [...prev, ...newItems])
      newItems.forEach(it => send({ type: 'construct-add', item: it }))
      setNotice(`铺好了 ${newItems.length} 块铺地。`)
    }
    setRoad({ start: null, end: null })
  }

  // 铺路预览（全局细格坐标）
  const roadPreview = (() => {
    if (!road.start || !road.end) return null
    const sG = toGlobalCell(road.start.zoneX, road.start.zoneZ, road.start.gx, road.start.gz)
    const eG = toGlobalCell(road.end.zoneX, road.end.zoneZ, road.end.gx, road.end.gz)
    const path = buildPath(sG.gx, sG.gz, eG.gx, eG.gz)
    return path.map(([gx, gz], i) => {
      const loc = fromGlobalCell(gx, gz)
      return { id: 'prev-' + i, typeId: roadType, zoneX: loc.zoneX, zoneZ: loc.zoneZ, gx: loc.gx, gz: loc.gz }
    })
  })()

  // 右键单击旋转（电脑端快捷旋转）：mouseup 判断短按（位移<6px 且 <400ms），右键拖拽平移不受影响
  const rightDownRef = useRef(null)
  useEffect(() => {
    const down = (e) => { if (e.button === 2) rightDownRef.current = { x: e.clientX, y: e.clientY, t: Date.now() } }
    const up = (e) => {
      if (e.button !== 2 || !rightDownRef.current) return
      const d = rightDownRef.current
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y)
      const dur = Date.now() - d.t
      rightDownRef.current = null
      if (moved < 6 && dur < 400 && previewSel) setRotation(r => (r + 90) % 360)
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('mouseup', up) }
  }, [previewSel])
  const handleContextMenu = useCallback((e) => {
    e.preventDefault()  // 只阻止浏览器右键菜单
  }, [])

  const onEnter = (u) => {
    try { localStorage.setItem('garden-user', JSON.stringify(u)) } catch { /* 隐私模式等场景忽略 */ }
    setUser(u); setConnState('connecting')
  }

  if (!user) return <Login onEnter={onEnter} />

  return (
    <div className="app">
      <div className="conn">
        <span className={'dot ' + connState}></span>
        <span>{connState === 'connected' ? `共享世界 · 在线 ${online} 人` :
          connState === 'connecting' ? '连接共享世界…' : '已断开，重连中…'}</span>
      </div>

      <div className="bubble"><small>瓦匠 · 老周</small>{notice}</div>
      <ToastDialogue dialogues={toasts} />

      <Canvas camera={{ position: [55, 50, 55], fov: 40 }} onContextMenu={handleContextMenu}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[15, 20, 15]} intensity={0.9} />
        <Ground showGrid={tool !== 'browse'} onPick={handlePick} onHover={handleHover} />
        <Constructs items={items} onPick={handleSelect} selectedId={selectedId} />
        {/* 移动预览：方向键/拖拽偏移后，目标位置显示绿格 + 半透明模型 ghost */}
        {editing === 'move' && selectedId && (() => {
          const t = items.find(i => i.id === selectedId)
          if (!t) return null
          let gx = t.gx + moveOffset.dx
          let gz = t.gz + moveOffset.dz
          const zx = t.zoneX + Math.floor(gx / ZONE_SIZE)
          const zz = t.zoneZ + Math.floor(gz / ZONE_SIZE)
          gx = ((gx % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
          gz = ((gz % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE
          if (!inGarden(zx, zz)) return null
          const mtype = TYPES[t.typeId]
          const mw = mtype ? (mtype.footprint ? mtype.footprint[0] : 1) * CELL : CELL
          const ml = mtype ? (mtype.footprint ? mtype.footprint[1] : 1) * CELL : CELL
          return (
            <>
              <HoverCell loc={{ zoneX: zx, zoneZ: zz, gx, gz }} valid
                w={mw} l={ml} />
              <Constructs items={[{
                id: t.id + '-ghost', typeId: t.typeId,
                zoneX: zx, zoneZ: zz, gx, gz, rotation: t.rotation || 0,
              }]} preview />
            </>
          )
        })()}
        <CharacterSystem characters={characters} walkMap={walkMap} />
        {/* 铺路预览 */}
        {roadPreview && road.start && (
          <Constructs items={roadPreview} preview />
        )}
        {/* 铺路起点/终点指示 */}
        {tool === 'road' && <PickIndicator loc={road.start} color="#e0a040" />}
        {tool === 'road' && <PickIndicator loc={road.end} color="#c04040" />}
        {tool !== 'select' && <HoverCell loc={hover} valid={hoverValid(hover)}
          w={hoverFootprint.w} l={hoverFootprint.l} />}
        {/* 放置预览：hover 时显示选中构件的半透明模型（湖/路用色块预览，无模型） */}
        {hover && previewSel && (previewSel.model || previewSel.id === '匾额') && (
          <Constructs items={[{
            id: 'preview', typeId: previewSel.id,
            zoneX: hover.zoneX, zoneZ: hover.zoneZ, gx: hover.gx, gz: hover.gz,
            rotation,
          }]} preview />
        )}
        <OrbitControls makeDefault />
      </Canvas>

      <div className="toolbar">
        <ToolBtn active={tool === 'road'} label="铺路" onClick={() => { setTool('road'); setPlaceSel(null); setWaterSel(null); setBuildSel(null); setSelectedId(null); setEditing(null) }} />
        <ToolBtn active={tool === 'place'} label="布景" onClick={() => { setTool('place'); setWaterSel(null); setBuildSel(null); setSelectedId(null); setEditing(null) }} />
        <ToolBtn active={tool === 'water'} label="水景" onClick={() => { setTool('water'); setPlaceSel(null); setBuildSel(null); setSelectedId(null); setEditing(null) }} />
        <ToolBtn active={tool === 'build'} label="建筑" onClick={() => { setTool('build'); setPlaceSel(null); setWaterSel(null); setSelectedId(null); setEditing(null) }} />
        <ToolBtn active={tool === 'inscribe'} label="书画" onClick={() => { setTool('inscribe'); setPlaceSel(null); setWaterSel(null); setBuildSel(null); setSelectedId(null); setEditing(null) }} />
        <ToolBtn active={tool === 'browse'} label="游览" onClick={() => setTool('browse')} />
        <ToolBtn active={tool === 'select'} icon="↖" label="选择" onClick={() => { setTool('select'); setPlaceSel(null); setWaterSel(null); setBuildSel(null); setSelectedId(null); setEditing(null) }} />
        <ToolBtn label="粘贴" onClick={doPaste} />
        <ToolBtn label="撤回" onClick={doUndo} />
      </div>

      {/* 选择面板：选中构件时的操作 */}
      {selectedId && !editing && (
        <div className="edit-panel">
          <div className="ep-title">选 择</div>
          <div className="ep-grid">
            <button className="act" onClick={doMove}>移动</button>
            <button className="act" onClick={doRotate}>旋转</button>
            <button className="act" onClick={doCopy}>复制</button>
            <button className="act danger" onClick={doDelete}>删除</button>
          </div>
          <button className="act" style={{ width: '100%' }} onClick={() => { setSelectedId(null); setEditing(null) }}>取消</button>
        </div>
      )}

      {/* 移动面板：方向键微调 + 确定/取消 */}
      {editing === 'move' && (
        <div className="move-panel">
          <div className="move-grid">
            <button className="mv up" onClick={() => moveDir(0, -1)}>↑</button>
            <button className="mv left" onClick={() => moveDir(-1, 0)}>←</button>
            <div className="mv-label">格 {moveOffset.dx}, {moveOffset.dz}</div>
            <button className="mv right" onClick={() => moveDir(1, 0)}>→</button>
            <button className="mv down" onClick={() => moveDir(0, 1)}>↓</button>
          </div>
          <div className="move-actions">
            <button className="act" onClick={confirmMove}>确定</button>
            <button className="act" onClick={() => { setSelectedId(null); setEditing(null); setMoveOffset({ dx: 0, dz: 0 }) }}>取消</button>
          </div>
        </div>
      )}

      {/* 放置旋转：常驻悬浮按钮（无选中构件时点击给提示） */}
      <button className="act rot-float" onClick={() => {
        if (!previewSel) { flash('先选一个构件，再旋转方向'); return }
        setRotation(r => (r + 90) % 360)
      }}>
        ↻ 旋转 {rotation}°
      </button>
      {/* 选择模式：常驻箭头按钮，点击后点构件即可选中（移动/旋转/删除），不会误放置 */}
      <button className={'act sel-float' + (tool === 'select' ? ' active' : '')}
        title="选择构件" onClick={() => setTool('select')}>↖</button>

      {tool === 'place' && (
        <div className="palette">
          {PLACE_TYPES.map(t => (
            <button key={t.id} className={'pal-item' + (placeSel?.id === t.id ? ' active' : '')}
              onClick={() => setPlaceSel(t)}>
              <span className="pal-swatch" style={{ background: t.color }}></span>{t.id}
            </button>
          ))}
        </div>
      )}

      {tool === 'build' && (
        <div className="palette">
          {!pavilionOpen ? (
            <>
              {BUILD_TYPES.filter(t => !PAVILION_IDS.includes(t.id)).map(t => (
                <button key={t.id} className={'pal-item' + (buildSel?.id === t.id ? ' active' : '')}
                  onClick={() => setBuildSel(t)}>
                  <span className="pal-swatch" style={{ background: t.color }}></span>{t.id}
                </button>
              ))}
              <button className={'pal-item pav-btn' + (buildSel && PAVILION_IDS.includes(buildSel.id) ? ' active' : '')}
                onClick={() => setPavilionOpen(true)}>亭子 ▸{buildSel && PAVILION_IDS.includes(buildSel.id) ? ` ${buildSel.id}` : ''}</button>
            </>
          ) : (
            <>
              {PAVILION_IDS.map(id => {
                const t = TYPES[id]
                return (
                  <button key={id} className={'pal-item' + (buildSel?.id === id ? ' active' : '')}
                    onClick={() => { setBuildSel(t); setPavilionOpen(false) }}>
                    <span className="pal-swatch" style={{ background: t.color }}></span>{id}
                  </button>
                )
              })}
              <button className="pal-item back-btn" onClick={() => setPavilionOpen(false)}>← 返回</button>
            </>
          )}
          <button className="pal-item rot-btn" onClick={() => setRotation(r => (r + 90) % 360)}>↻ 旋转 {rotation}°</button>
        </div>
      )}

      {tool === 'water' && (
        <div className="palette">
          {WATER_TYPES.map(t => (
            <button key={t.id} className={'pal-item' + (waterSel?.id === t.id ? ' active' : '')}
              onClick={() => setWaterSel(t)}>
              <span className="pal-swatch" style={{ background: t.color }}></span>{t.id}
            </button>
          ))}
          <button className="pal-item rot-btn" onClick={() => setRotation(r => (r + 90) % 360)}>↻ 旋转 {rotation}°</button>
          {/* 湖画笔大小 */}
          {waterSel?.id === '湖' && [1, 3, 5].map(s => (
            <button key={s} className={'pal-item brush-btn' + (brushSize === s ? ' active' : '')}
              onClick={() => setBrushSize(s)}>{s}×{s}</button>
          ))}
        </div>
      )}

      {tool === 'road' && (
        <div className="palette">
          {ROAD_TYPES.map(t => (
            <button key={t.id} className={'pal-item' + (roadType === t.id ? ' active' : '')}
              onClick={() => setRoadType(t.id)}>
              <span className="pal-swatch" style={{ background: t.color }}></span>{t.id}
            </button>
          ))}
        </div>
      )}

      {tool === 'inscribe' && (
        <div className="palette">
          <input
            className="plaque-input"
            type="text"
            maxLength={12}
            placeholder="题字（12字内）"
            value={plaqueText}
            onChange={e => setPlaqueText(e.target.value)}
          />
          {plaqueText.trim() && (
            <button className="pal-item" onClick={() => setPlaqueText('')}>清空</button>
          )}
        </div>
      )}

      {tool === 'road' && road.start && road.end && (
        <div className="actions">
          <button className="act confirm" onClick={confirmRoad}>确认铺设</button>
          <button className="act cancel" onClick={() => setRoad({ start: null, end: null })}>取消</button>
        </div>
      )}
    </div>
  )
}

function ToolBtn({ label, icon, active, onClick }) {
  return <button className={'tool' + (active ? ' active' : '')} onClick={onClick}>{icon && <span className="ic">{icon}</span>}{label}</button>
}
