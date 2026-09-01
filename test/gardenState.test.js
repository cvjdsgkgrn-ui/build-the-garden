import { describe, it, expect } from 'vitest'
import { checkPlacement, canPlaceLake, isBridgeHollowCell, worldToZone, gridToWorld, zoneOrigin, inGarden, toGlobalCell, fromGlobalCell } from '../src/store/gardenState.js'
import { TYPES, ZONES, ZONE_SIZE, CELL } from '../src/store/types.js'

describe('坐标转换（多区块嵌套）', () => {
  it('gridToWorld 与 worldToZone 互逆（中心区块）', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    for (let gx = 0; gx < ZONE_SIZE; gx += 3) {
      for (let gz = 0; gz < ZONE_SIZE; gz += 3) {
        const { x, z } = gridToWorld(cz.x, cz.y, gx, gz)
        const back = worldToZone(x, z)
        expect(back.zoneX).toBe(cz.x)
        expect(back.zoneZ).toBe(cz.y)
        expect(back.gx).toBe(gx)
        expect(back.gz).toBe(gz)
      }
    }
  })

  it('不同区块坐标映射到不同世界位置', () => {
    const a = gridToWorld(0, 0, 0, 0)
    const b = gridToWorld(1, 0, 0, 0)
    // 相邻区块原点的世界间距 = ZONE_SIZE * CELL
    expect(Math.abs(b.x - a.x)).toBeCloseTo(ZONE_SIZE * CELL)
  })

  it('inGarden 判断区块范围', () => {
    expect(inGarden(0, 0)).toBe(true)
    expect(inGarden(ZONES.W - 1, ZONES.H - 1)).toBe(true)
    expect(inGarden(ZONES.W, 0)).toBe(false)
    expect(inGarden(0, -1)).toBe(false)
  })

  it('全局细格坐标：区块+细格 合成与拆分互逆', () => {
    // 区块(3,2)细格(8,7) → 全局
    const g = toGlobalCell(3, 2, 8, 7)
    expect(g.gx).toBe(3 * ZONE_SIZE + 8)
    expect(g.gz).toBe(2 * ZONE_SIZE + 7)
    // 拆回
    const back = fromGlobalCell(g.gx, g.gz)
    expect(back.zoneX).toBe(3)
    expect(back.zoneZ).toBe(2)
    expect(back.gx).toBe(8)
    expect(back.gz).toBe(7)
  })

  it('全局细格跨区块：相邻区块边界的格子正确归属', () => {
    // 区块(3,2)最后一个格子 gx=9 的全局坐标
    const g = toGlobalCell(3, 2, 9, 0)
    // 下一个全局格子应属于区块(4,2)
    const next = fromGlobalCell(g.gx + 1, g.gz)
    expect(next.zoneX).toBe(4)
    expect(next.zoneZ).toBe(2)
    expect(next.gx).toBe(0)
  })
})

describe('占位检测 checkPlacement', () => {
  it('整园内的合法位置可以放置', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    const r = checkPlacement('铺地-卵石', cz.x, cz.y, 3, 3, [])
    expect(r.ok).toBe(true)
  })

  it('超出园界被拒绝', () => {
    const r = checkPlacement('铺地-卵石', ZONES.W, 0, 0, 0, [])
    expect(r.ok).toBe(false)
  })

  it('区块合一：跨区块放置允许（不再限制区块边界）', () => {
    // 中央区块放细格边界，footprint 覆盖相邻区块——区块合一后应允许
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    // 大构件（湖 8×8）放 gx=6，footprint 跨到下一个区块
    const r = checkPlacement('湖', cz.x, cz.y, 6, 5, [])
    expect(r.ok).toBe(true)
  })

  it('与已有实例冲突时被拒绝（非路构件）', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    const existing = [{ id: 'x', typeId: '盆景-松柏', zoneX: cz.x, zoneZ: cz.y, gx: 3, gz: 3 }]
    const r = checkPlacement('盆景-青竹', cz.x, cz.y, 3, 3, existing)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('占用')
  })

  it('不同区块的同位置不冲突', () => {
    const existing = [{ id: 'x', typeId: '铺地-卵石', zoneX: 0, zoneZ: 0, gx: 3, gz: 3 }]
    const r = checkPlacement('铺地-卵石', 1, 0, 3, 3, existing)
    expect(r.ok).toBe(true)
  })

  it('构件超出整园范围被拒绝', () => {
    // 最右下区块的最右下角放亭子(7×7)，footprint 会超出整园
    const r = checkPlacement('亭8', ZONES.W - 1, ZONES.H - 1, ZONE_SIZE - 1, ZONE_SIZE - 1, [])
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('园界')
  })

  it('大构件（亭）在区块中心合法', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    // 亭 7×7 放在区块中央不溢出整园
    const r = checkPlacement('亭8', cz.x, cz.y, 5, 5, [])
    expect(r.ok).toBe(true)
  })

  it('大构件 footprint 区域内的冲突被检测', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    // 亭 7×7 中心(5,5)覆盖 (2..8)，在(3,3)放一个铺地会冲突
    const existing = [{ id: 'x', typeId: '铺地-卵石', zoneX: cz.x, zoneZ: cz.y, gx: 3, gz: 3 }]
    const r = checkPlacement('亭8', cz.x, cz.y, 5, 5, existing)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('占用')
  })

  it('未知构件类型被拒绝', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    const r = checkPlacement('不存在', cz.x, cz.y, 0, 0, [])
    expect(r.ok).toBe(false)
  })

  it('两条路交叉时允许重叠（不阻止第二条路）', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    const existing = [{ id: 'road1', typeId: '铺地-卵石', zoneX: cz.x, zoneZ: cz.y, gx: 5, gz: 5 }]
    // 第二条路穿过同一格子，应允许
    const r = checkPlacement('铺地-卵石', cz.x, cz.y, 5, 5, existing)
    expect(r.ok).toBe(true)
  })

  it('路与湖冲突（路不能铺在湖上）', () => {
    const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }
    const existing = [{ id: 'lake', typeId: '湖', zoneX: cz.x, zoneZ: cz.y, gx: 5, gz: 5 }]
    const r = checkPlacement('铺地-卵石', cz.x, cz.y, 5, 5, existing)
    expect(r.ok).toBe(false)
  })
})

describe('占位检测 — 旋转与桥跨水', () => {
  const cz = { x: Math.floor(ZONES.W / 2), y: Math.floor(ZONES.H / 2) }

  it('旋转 90° 时 footprint 宽长互换（已有大构件按 footprint 参与冲突）', () => {
    // 墙1 footprint=[16,1]：横放占 x 向 16 格；旋转 90° 后应占 z 向 16 格
    // 已有旋转墙（x=65 列，z 57..72）
    const wall90 = { id: 'w', typeId: '墙1', zoneX: cz.x, zoneZ: cz.y, gx: 5, gz: 5, rotation: 90 }
    // (9,5) 也旋转 90°（不同列 x=69）→ 允许
    expect(checkPlacement('墙1', cz.x, cz.y, 9, 5, [wall90], 90).ok).toBe(true)
    // (5,9) 旋转 90°（同列重叠）→ 冲突
    expect(checkPlacement('墙1', cz.x, cz.y, 5, 9, [wall90], 90).ok).toBe(false)
    // (5,9) 横放穿过 x=65 列 → 冲突（大构件 footprint 级检测）
    expect(checkPlacement('墙1', cz.x, cz.y, 5, 9, [wall90], 0).ok).toBe(false)
    // (9,5) 横放覆盖 (65,65) → 冲突
    expect(checkPlacement('墙1', cz.x, cz.y, 9, 5, [wall90], 0).ok).toBe(false)
    // 横放墙 (5,5)：同行 (9,5) 冲突、(5,9) 允许
    const wall0 = { ...wall90, rotation: 0 }
    expect(checkPlacement('墙1', cz.x, cz.y, 9, 5, [wall0], 0).ok).toBe(false)
    expect(checkPlacement('墙1', cz.x, cz.y, 5, 9, [wall0], 0).ok).toBe(true)
  })

  it('拱桥中间虚格：先放湖后架桥（桥跨水）', () => {
    // 湖只在桥中段虚格下方（gx 3..6），桥两端 gx=2/8 落地 → 允许架桥
    const lakes = []
    for (const gx of [3, 4, 5, 6]) {
      lakes.push({ id: 'l' + gx, typeId: '湖', zoneX: cz.x, zoneZ: cz.y, gx, gz: 5 })
    }
    const r = checkPlacement('拱桥', cz.x, cz.y, 5, 5, lakes, 0)
    expect(r.ok).toBe(true)
  })

  it('拱桥两端落地格压湖 → 冲突', () => {
    // 桥两端格（gx=2 或 8）放湖 → 架桥被拒
    const lakes = [
      { id: 'l1', typeId: '湖', zoneX: cz.x, zoneZ: cz.y, gx: 2, gz: 5 },
      { id: 'l2', typeId: '湖', zoneX: cz.x, zoneZ: cz.y, gx: 4, gz: 5 },
    ]
    const r = checkPlacement('拱桥', cz.x, cz.y, 5, 5, lakes, 0)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('占用')
  })

  it('先放桥后画湖：湖可画进桥下虚格，不可画进两端格', () => {
    const bridge = { id: 'b', typeId: '拱桥', zoneX: cz.x, zoneZ: cz.y, gx: 5, gz: 5, rotation: 0 }
    // 中间虚格（gx=3 / gx=6）：可画
    expect(canPlaceLake([bridge], cz.x, cz.y, 3, 5).ok).toBe(true)
    expect(canPlaceLake([bridge], cz.x, cz.y, 6, 5).ok).toBe(true)
    // 两端格（gx=2 / gx=7）：不可画
    expect(canPlaceLake([bridge], cz.x, cz.y, 2, 5).ok).toBe(false)
    expect(canPlaceLake([bridge], cz.x, cz.y, 7, 5).ok).toBe(false)
    // 桥外空地（gx=8）：可画
    expect(canPlaceLake([bridge], cz.x, cz.y, 8, 5).ok).toBe(true)
  })

  it('湖画笔：已有湖/其他构件不可画，空地可画', () => {
    const existing = [
      { id: 'l1', typeId: '湖', zoneX: cz.x, zoneZ: cz.y, gx: 3, gz: 3 },
      { id: 'p1', typeId: '盆景-松柏', zoneX: cz.x, zoneZ: cz.y, gx: 5, gz: 5 },
    ]
    expect(canPlaceLake(existing, cz.x, cz.y, 3, 3).ok).toBe(false)  // 已有湖
    expect(canPlaceLake(existing, cz.x, cz.y, 5, 5).ok).toBe(false)  // 盆景占位
    expect(canPlaceLake(existing, cz.x, cz.y, 4, 4).ok).toBe(true)   // 空地
  })

  it('旋转 90° 的桥：虚格方向跟随旋转', () => {
    const bridge = { id: 'b', typeId: '拱桥', zoneX: cz.x, zoneZ: cz.y, gx: 5, gz: 5, rotation: 90 }
    // 旋转后桥沿 z 向 6 格：中间虚格在 z 向中间，x=5
    expect(isBridgeHollowCell(bridge, cz.x * ZONE_SIZE + 5, cz.y * ZONE_SIZE + 6)).toBe(true)
    expect(isBridgeHollowCell(bridge, cz.x * ZONE_SIZE + 6, cz.y * ZONE_SIZE + 5)).toBe(false)
  })
})

describe('类型系统完整性', () => {
  it('所有类型都有必要字段', () => {
    for (const [id, t] of Object.entries(TYPES)) {
      expect(t.id).toBe(id)
      expect(['骨架', '营造'].includes(t.category)).toBe(true)
      expect(Array.isArray(t.footprint) && t.footprint.length === 3).toBe(true)
      expect(typeof t.playerCan).toBe('boolean')
    }
  })

  it('区块规模定义正确', () => {
    expect(ZONES.W).toBe(12)
    expect(ZONES.H).toBe(8)
    expect(ZONE_SIZE).toBe(10)
    expect(CELL).toBe(0.5)
  })
})
