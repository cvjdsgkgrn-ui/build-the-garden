import { useEffect, useRef, useCallback } from 'react'
import { WANDER_POINTS, CONVERSE_DIST, CONVERSE_COOLDOWN_MS } from '../store/characters.js'
import { generateDialogue } from '../store/ai.js'
import { isWalkable } from '../store/nav.js'

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// 选一个可行走的目标点（避开障碍/水，优先选路格附近）
function pickWalkableTarget(walkMap) {
  for (let tries = 0; tries < 20; tries++) {
    const p = pickRandom(WANDER_POINTS)
    const x = p.x + (Math.random() - 0.5) * 8
    const z = p.z + (Math.random() - 0.5) * 8
    const w = isWalkable(x, z, walkMap)
    // 优先路格；无路时也接受空地（只要可走）
    if (w.walkable && (w.isRoad || tries > 10)) {
      return { x, z }
    }
  }
  // 兜底：园中心
  return { x: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }
}

// 350ms 漫步循环：选点 → 移动 → 休息 → 再走；靠近检测对话
export function useCharacterLoop({ charactersRef, onDialogue, walkMap }) {
  const onDialogueRef = useRef(onDialogue)
  onDialogueRef.current = onDialogue
  const walkMapRef = useRef(walkMap)
  walkMapRef.current = walkMap

  const tick = useCallback(async () => {
    const chars = charactersRef.current
    if (!chars || chars.length < 1) return
    const now = Date.now()

    for (const c of chars) {
      // 正在对话中，不动
      if (c.isConversing) continue

      // 有目标就继续走（移动由 CharacterMesh useFrame 处理）
      if (c.target) continue

      // 休息中
      if (c.isResting) {
        c.restTimer -= 0.5
        if (c.restTimer <= 0) {
          c.isResting = false
          // 醒来选一个可行的游走点（避开障碍/水，优先路）
          c.target = pickWalkableTarget(walkMapRef.current)
        }
        continue
      }

      // 没目标没休息 → 开始休息
      c.isResting = true
      c.restTimer = 2 + Math.random() * 5
    }

    // 靠近检测对话（两两）
    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j < chars.length; j++) {
        const a = chars[i], b = chars[j]
        if (a.isConversing || b.isConversing) continue
        if (a.isResting && b.isResting) continue
        const d = Math.hypot((a.x||0) - (b.x||0), (a.z||0) - (b.z||0))
        if (d < CONVERSE_DIST) {
          const last = Math.max(a.lastConverse?.[b.id] || 0, b.lastConverse?.[a.id] || 0)
          if (now - last > CONVERSE_COOLDOWN_MS) {
            a.isConversing = b.isConversing = true
            a.target = b.target = null
            a.lastConverse = { ...(a.lastConverse || {}), [b.id]: now }
            b.lastConverse = { ...(b.lastConverse || {}), [a.id]: now }
            // AI 实时生成对话
            try {
              const turns = await generateDialogue(a, b)
              onDialogueRef.current?.(turns)
            } catch (e) {
              console.error('[对话] AI 生成失败:', e.message)
              onDialogueRef.current?.([{ name: a.name, color: a.color, text: `（${a.name}想跟你聊聊，但AI暂时没回应）` }])
            }
            // 对话结束后解除状态
            setTimeout(() => {
              a.isConversing = b.isConversing = false
            }, 6000)
          }
        }
      }
    }
  }, [charactersRef])

  useEffect(() => {
    const iv = setInterval(tick, 350)
    return () => clearInterval(iv)
  }, [tick])
}
