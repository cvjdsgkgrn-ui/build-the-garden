// 营造之间 · 园子状态管理 + 占位检测
import { TYPES, ZONES, CELL, ZONE_SIZE } from './types.js'

// ===== 坐标系统（多区块嵌套）=====
// 位置 = 区块坐标 (zoneX, zoneZ) + 块内细格 (gx, gz)
// 全局世界坐标 = 区块原点 + 细格偏移

// 区块原点（区块中心的世界坐标）
export function zoneOrigin(zoneX, zoneZ) {
  const zoneM = ZONE_SIZE * CELL  // 每区块米数
  return {
    x: zoneX * zoneM - (ZONES.W - 1) / 2 * zoneM,
    z: zoneZ * zoneM - (ZONES.H - 1) / 2 * zoneM,
  }
}

// 全局世界坐标 → 区块 + 细格
export function worldToZone(x, z) {
  const zoneM = ZONE_SIZE * CELL
  // 找到所在区块
  const fx = (x + (ZONES.W - 1) / 2 * zoneM) / zoneM
  const fz = (z + (ZONES.H - 1) / 2 * zoneM) / zoneM
  const zoneX = Math.floor(fx)
  const zoneZ = Math.floor(fz)
  // 块内细格（相对区块原点）
  const origin = zoneOrigin(zoneX, zoneZ)
  const gx = Math.round((x - origin.x) / CELL)
  const gz = Math.round((z - origin.z) / CELL)
  return { zoneX, zoneZ, gx, gz }
}

// 区块 + 细格 → 全局世界坐标（细格中心）
export function gridToWorld(zoneX, zoneZ, gx, gz) {
  const origin = zoneOrigin(zoneX, zoneZ)
  return { x: origin.x + gx * CELL, z: origin.z + gz * CELL }
}

// 检查区块坐标是否在整园范围内
export function inGarden(zoneX, zoneZ) {
  return zoneX >= 0 && zoneX < ZONES.W && zoneZ >= 0 && zoneZ < ZONES.H
}

// ===== 全局细格坐标（跨区块铺路用）=====
// 全局细格 = 区块坐标 + 块内细格，合成一个全局索引
export function toGlobalCell(zoneX, zoneZ, gx, gz) {
  return { gx: zoneX * ZONE_SIZE + gx, gz: zoneZ * ZONE_SIZE + gz }
}
export function fromGlobalCell(gx, gz) {
  const zx = Math.floor(gx / ZONE_SIZE)
  const zz = Math.floor(gz / ZONE_SIZE)
  return { zoneX: zx, zoneZ: zz, gx: gx - zx * ZONE_SIZE, gz: gz - zz * ZONE_SIZE }
}

// ===== 占位检测 =====
// footprint 是否因旋转（90/270°）互换宽长
function footprintSpan(type, rotation) {
  const rot = ((rotation || 0) % 360 + 360) % 360
  const swapped = rot === 90 || rot === 270
  const fw = Math.max(1, Math.round(type.footprint[0]))
  const fl = Math.max(1, Math.round(type.footprint[1]))
  return swapped ? { fw: fl, fl: fw } : { fw, fl }
}

// 判断全局细格 (cx, cz) 与拱桥 footprint 的关系：{ inside, hollow }
// hollow=true 表示落在桥的「中间虚格」（跨水部分，两端落脚格除外）。
// 虚格不参与与湖的占位冲突：桥可架在湖上、湖也可画进桥下。
function bridgeCellAt(bridge, cx, cz) {
  if (!bridge || bridge.typeId !== '拱桥') return { inside: false, hollow: false }
  const { fw, fl } = footprintSpan(TYPES['拱桥'], bridge.rotation)
  const baseGX = bridge.zoneX * ZONE_SIZE + bridge.gx
  const baseGZ = bridge.zoneZ * ZONE_SIZE + bridge.gz
  const halfW = Math.floor(fw / 2), halfL = Math.floor(fl / 2)
  const gx0 = baseGX - halfW, gx1 = baseGX + (fw - 1 - halfW)
  const gz0 = baseGZ - halfL, gz1 = baseGZ + (fl - 1 - halfL)
  if (cx < gx0 || cx > gx1 || cz < gz0 || cz > gz1) return { inside: false, hollow: false }
  // 长轴方向（>1 格）去掉两端各 1 格，即中间虚格
  const hollow = fl > 1 ? (cz > gz0 && cz < gz1) : (cx > gx0 && cx < gx1)
  return { inside: true, hollow }
}

export function isBridgeHollowCell(bridge, cx, cz) {
  return bridgeCellAt(bridge, cx, cz).hollow
}

// 判断某位置是否可放。检查整个 footprint 区域（全局细格，不受区块边界限制）
// rotation: 放置时构件的旋转角（0/90/180/270），90/270 时 footprint 宽长互换
export function checkPlacement(typeId, zoneX, zoneZ, gx, gz, existing, rotation) {
  const type = TYPES[typeId]
  if (!type) return { ok: false, reason: '未知构件' }

  // 全局细格坐标（区块合一，跨区块连续）
  const baseGX = zoneX * ZONE_SIZE + gx
  const baseGZ = zoneZ * ZONE_SIZE + gz

  // footprint 占用的格子范围（footprint = [宽, 长, 高]，按格；旋转时互换）
  const { fw, fl } = footprintSpan(type, rotation)
  const halfW = Math.floor(fw / 2), halfL = Math.floor(fl / 2)
  const gx0 = baseGX - halfW, gx1 = baseGX + (fw - 1 - halfW)
  const gz0 = baseGZ - halfL, gz1 = baseGZ + (fl - 1 - halfL)

  // 整园全局范围
  const totalW = ZONES.W * ZONE_SIZE
  const totalH = ZONES.H * ZONE_SIZE

  const isRoad = type.tool === 'road'
  const isBridge = typeId === '拱桥'
  const isLake = typeId === '湖'
  // 新构件若为桥，先算出自身虚格范围（供「湖落在桥虚格内放行」判断）
  const newBridge = isBridge ? { typeId: '拱桥', zoneX, zoneZ, gx, gz, rotation } : null

  // 已有构件 footprint 范围缓存（大构件按 footprint 参与冲突检测，防互相重叠）
  const spanCache = new Map()
  const inSpan = (e, cx, cz) => {
    let sp = spanCache.get(e.id)
    if (sp === undefined) {
      const t = TYPES[e.typeId]
      if (!t) { spanCache.set(e.id, null); return false }
      const { fw, fl } = footprintSpan(t, e.rotation)
      const halfW = Math.floor(fw / 2), halfL = Math.floor(fl / 2)
      sp = {
        gx0: e.zoneX * ZONE_SIZE + e.gx - halfW,
        gx1: e.zoneX * ZONE_SIZE + e.gx + (fw - 1 - halfW),
        gz0: e.zoneZ * ZONE_SIZE + e.gz - halfL,
        gz1: e.zoneZ * ZONE_SIZE + e.gz + (fl - 1 - halfL),
      }
      spanCache.set(e.id, sp)
    }
    return !!sp && cx >= sp.gx0 && cx <= sp.gx1 && cz >= sp.gz0 && cz <= sp.gz1
  }

  // 遍历 footprint 覆盖的所有全局细格
  for (let cx = gx0; cx <= gx1; cx++) {
    for (let cz = gz0; cz <= gz1; cz++) {
      // 超出整园范围
      if (cx < 0 || cz < 0 || cx >= totalW || cz >= totalH) {
        return { ok: false, reason: '构件超出园界' }
      }
      // 与已有实例冲突（按全局坐标 + footprint，跨区块也算）
      if (existing) {
        const clash = existing.some(e => {
          // ── 已有拱桥：按 footprint 判断（湖/桥可进虚格，实格冲突） ──
          if (e.typeId === '拱桥') {
            const cell = bridgeCellAt(e, cx, cz)
            if (!cell.inside) return false
            // 虚格：允许与湖/桥共存（桥跨水）
            if (cell.hollow && (isBridge || isLake)) return false
            return true
          }
          // 已有其他构件：按自身 footprint 判断是否覆盖当前格
          if (!inSpan(e, cx, cz)) return false
          // 新的是路：只与"非路"构件冲突；与已存在的路不冲突（可交叉）
          if (isRoad) return TYPES[e.typeId]?.tool !== 'road'
          // 新的是桥：已有湖若落在桥的虚格内 → 放行（桥跨水）
          if (isBridge && e.typeId === '湖' && isBridgeHollowCell(newBridge, cx, cz)) return false
          // 其余一律冲突
          return true
        })
        if (clash) return { ok: false, reason: '这里已被占用' }
      }
    }
  }
  return { ok: true }
}

// 湖画笔单格检测：是否可在此格画水
// 规则：已有湖 → 跳过；拱桥中间虚格（含 footprint 内其他格）→ 可画；其他构件占用的格 → 不可
export function canPlaceLake(existing, zoneX, zoneZ, gx, gz) {
  const cx = zoneX * ZONE_SIZE + gx
  const cz = zoneZ * ZONE_SIZE + gz
  for (const e of existing || []) {
    // 拱桥：按 footprint 判断虚格
    if (e.typeId === '拱桥') {
      const cell = bridgeCellAt(e, cx, cz)
      if (cell.inside && cell.hollow) continue   // 桥下虚格 → 可画水
      if (cell.inside) return { ok: false, reason: '这里已被占用' }  // 桥端实格 → 不可
      continue
    }
    if (e.zoneX * ZONE_SIZE + e.gx !== cx || e.zoneZ * ZONE_SIZE + e.gz !== cz) continue
    if (e.typeId === '湖') return { ok: false, reason: '这里已是水面' }
    return { ok: false, reason: '这里已被占用' }
  }
  return { ok: true }
}
