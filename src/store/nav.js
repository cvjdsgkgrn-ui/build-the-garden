// 营造之间 · 角色导航
// 为 AI 角色提供可行走地图 + 寻路 + 避障
// 规则：路优先沿路走，水/障碍不可走，无路自由走
import { CELL, WORLD_W, WORLD_H, TYPES } from './types.js'
import { gridToWorld } from './gardenState.js'

const GRID = CELL          // 导航网格大小 = 细格 0.5m
const GW = Math.ceil(WORLD_W / GRID)   // 网格列数
const GH = Math.ceil(WORLD_H / GRID)   // 网格行数

// 世界坐标 → 导航网格下标
function toGrid(x, z) {
  const gx = Math.round((x + WORLD_W / 2) / GRID)
  const gz = Math.round((z + WORLD_H / 2) / GRID)
  return { gx: Math.max(0, Math.min(GW - 1, gx)), gz: Math.max(0, Math.min(GH - 1, gz)) }
}

// 构件的 world 坐标（通过 zone + 细格换算）
function itemWorld(it) {
  const { x, z } = gridToWorld(it.zoneX, it.zoneZ, it.gx, it.gz)
  return { x, z }
}

// 构建可行走地图
// items: 所有构件（路/水/障碍物）
// 返回 { blocked:Set, roadCells:Set }
export function buildWalkMap(items) {
  const blocked = new Set()   // 不可走格（水/建筑障碍）
  const roadCells = new Set() // 路格（优先走）
  for (const it of items || []) {
    const t = it.typeId
    if (!t) continue
    const { x, z } = itemWorld(it)
    // 湖：占多个细格，全标不可走
    if (t === '湖') {
      const { gx, gz } = toGrid(x, z)
      blocked.add(gx + ',' + gz)
      // 湖的 footprint 可能是多格，标记周围（1×1 湖格即一格）
      // 湖本身就是逐格放的，一格一个 item，所以当前格标记即可
      continue
    }
    // 路：标记为路格（可走，优先）
    if (TYPES[t]?.tool === 'road') {
      const { gx, gz } = toGrid(x, z)
      roadCells.add(gx + ',' + gz)
      continue
    }
    // 障碍物：墙/假山/盆景等实心障碍标记不可走
    // 月洞门（门洞可穿）、拱桥（桥面通路）、亭子（内部可站）不封死
    const isSolidObstacle = ['墙1', '墙2', '假山', '假山石', '盆景-松柏', '盆景-青竹', '盆景-腊梅'].includes(t)
    if (isSolidObstacle) {
      const { gx, gz } = toGrid(x, z)
      // 障碍尺寸直接读 TYPES footprint（与占位检测/3D 渲染一致），避免尺寸漂移
      const type = TYPES[t]
      const fpRaw = (type && type.footprint)
        ? [Math.max(1, Math.round(type.footprint[0])), Math.max(1, Math.round(type.footprint[1]))]
        : [1, 1]
      // 可旋转构件：90/270° 时长宽互换
      const rot = it.rotation || 0
      const swapped = (rot === 90 || rot === 270)
      const w = swapped ? fpRaw[1] : fpRaw[0]
      const l = swapped ? fpRaw[0] : fpRaw[1]
      // 半宽：中心格 ± 覆盖 footprint（+1 格 padding 确保墙身全挡）
      const hx = Math.floor(w / 2) + 1
      const hz = Math.floor(l / 2) + 1
      for (let i=-hx;i<=hx;i++) for (let j=-hz;j<=hz;j++) {
        const ngx = Math.max(0, Math.min(GW-1, gx+i))
        const ngz = Math.max(0, Math.min(GH-1, gz+j))
        blocked.add(ngx + ',' + ngz)
      }
    }
    // 亭子：内部留空（可站人），只堵外围一圈柱脚（footprint 边界）
    if (t === '亭8') {
      const { gx, gz } = toGrid(x, z)
      const hx = 3, hz = 3  // footprint 7×7 半宽
      for (let i=-hx;i<=hx;i++) for (let j=-hz;j<=hz;j++) {
        // 只堵最外圈（亭子柱脚），内部留空
        if (Math.abs(i) === hx || Math.abs(j) === hz) {
          const ngx = Math.max(0, Math.min(GW-1, gx+i))
          const ngz = Math.max(0, Math.min(GH-1, gz+j))
          blocked.add(ngx + ',' + ngz)
        }
      }
    }
  }
  return { blocked, roadCells }
}

// 判断某世界点是否可行走
export function isWalkable(x, z, walkMap) {
  if (!walkMap) return { walkable: true, isRoad: false }
  const { gx, gz } = toGrid(x, z)
  const key = gx + ',' + gz
  if (walkMap.blocked.has(key)) return { walkable: false, isRoad: false }
  return { walkable: true, isRoad: walkMap.roadCells.has(key) }
}

// 是否在不可走区域（水/障碍）内
export function inBlocked(x, z, walkMap) {
  return !isWalkable(x, z, walkMap).walkable
}

// 移动避障：从 pos 向 desired 走一步，若前方被挡则偏移方向绕开
// 返回新的移动方向 {dx, dz}（未归一化），或 null 表示完全被堵
// 角色碰撞半径 + 简单绕行（尝试左右偏移）
export function steerAvoid(pos, desired, walkMap, radius = 0.35) {
  if (!walkMap) return { dx: desired.dx, dz: desired.dz }
  const d = Math.hypot(desired.dx, desired.dz)
  if (d < 0.0001) return { dx: 0, dz: 0 }
  const nx = desired.dx / d, nz = desired.dz / d
  // 前方采样点
  const ahead = { x: pos.x + nx * radius, z: pos.z + nz * radius }
  if (!inBlocked(ahead.x, ahead.z, walkMap)) {
    return { dx: desired.dx, dz: desired.dz }
  }
  // 被挡：尝试左/右偏 90° 绕行，选可行的方向
  for (const [sx, sz] of [[nz, -nx], [-nz, nx], [nx*0.7+nz*0.7, nz*0.7-nx*0.7], [nx*0.7-nz*0.7, nz*0.7+nx*0.7]]) {
    const tryP = { x: pos.x + sx * radius, z: pos.z + sz * radius }
    if (!inBlocked(tryP.x, tryP.z, walkMap)) {
      return { dx: sx * d, dz: sz * d }
    }
  }
  return null  // 完全被堵
}
