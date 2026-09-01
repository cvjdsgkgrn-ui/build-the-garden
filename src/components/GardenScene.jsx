import React, { useMemo, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import * as THREE from 'three'
import { TYPES, ZONES, CELL, WORLD_W, WORLD_H } from '../store/types.js'
import { gridToWorld } from '../store/gardenState.js'

// 整个大地面（12×8区块，60×40）
export function Ground({ showGrid, onPick, onHover }) {
  const downRef = useRef(null)
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => { e.stopPropagation(); onHover && onHover(e.point.x, e.point.z) }}
        onPointerOut={() => { onHover && onHover(null, null) }}
        onPointerDown={(e) => { downRef.current = { x: e.clientX, y: e.clientY } }}
        onClick={(e) => {
          e.stopPropagation()
          // 拖拽视角（旋转/平移）会触发 click：按下后位移超过阈值则忽略
          if (downRef.current) {
            const dx = e.clientX - downRef.current.x
            const dy = e.clientY - downRef.current.y
            // e.delta 是本次事件指针移动距离，拖拽时也很大
            const moved = Math.max(Math.hypot(dx, dy), e.delta || 0)
            if (moved > 5) { downRef.current = null; return }
          }
          downRef.current = null
          onPick && onPick(e.point.x, e.point.z)
        }}>
        <planeGeometry args={[WORLD_W, WORLD_H]} />
        <meshStandardMaterial color="#b7a882" roughness={1} />
      </mesh>
      {showGrid && <ZoneGrid />}
    </group>
  )
}

// 区块边界网格（显示区块划分）
function ZoneGrid() {
  // 整园划分成区块：区块网格 = ZONES.W × ZONES.H 个大格
  return (
    <gridHelper args={[WORLD_W, ZONES.W * 4, '#6b8e7a', '#6b8e7a']} position={[0, 0.015, 0]}
      material-transparent material-opacity={0.4} />
  )
}

// 转动的倒三棱锥（选中指示，可复用）
function ConeIndicator({ color, y }) {
  const coneRef = useRef()
  useFrame((state, delta) => {
    if (coneRef.current) coneRef.current.rotation.y += delta * 2.5
  })
  return (
    <group ref={coneRef} position={[0, y ?? 0.35, 0]}>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.16, 0.3, 3]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
    </group>
  )
}

// 鼠标悬停指示（footprint 区域高亮 + 旋转倒锥，绿=可放 红=冲突）
export function HoverCell({ loc, valid, w, l }) {
  if (!loc) return null
  const { x, z } = gridToWorld(loc.zoneX, loc.zoneZ, loc.gx, loc.gz)
  const fw = w || 0.46   // footprint 宽（米）
  const fl = l || fw     // footprint 长（米）
  const col = valid ? '#5fae6a' : '#c04040'
  return (
    <group position={[x, 0.02, z]}>
      {/* 占用区域填充 */}
      <mesh>
        <planeGeometry args={[fw, fl]} />
        <meshStandardMaterial color={col} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      {/* 占用区域描边 */}
      <lineSegments position={[0, 0.005, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(fw, 0.01, fl)]} />
        <lineBasicMaterial color={valid ? '#8ae08a' : '#ff6a6a'} linewidth={2} />
      </lineSegments>
      <ConeIndicator color={col} />
    </group>
  )
}

// 铺路起点/终点的指示锥
export function PickIndicator({ loc, color }) {
  if (!loc) return null
  const { x, z } = gridToWorld(loc.zoneX, loc.zoneZ, loc.gx, loc.gz)
  return (
    <group position={[x, 0.02, z]}>
      {/* 选中格高亮 */}
      <mesh>
        <planeGeometry args={[0.46, 0.46]} />
        <meshStandardMaterial color={color} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <ConeIndicator color={color} y={0.5} />
    </group>
  )
}

// 渲染构件（按构件类型渲染，含湖/桥三维）
export function Constructs({ items, preview, onPick, selectedId, moveOffset }) {
  const roads = items.filter(i => TYPES[i.typeId]?.tool === 'road')
  const lakes = items.filter(i => i.typeId === '湖')
  const otherWaters = items.filter(i => TYPES[i.typeId]?.tool === 'water' && i.typeId !== '湖')
  const others = items.filter(i => TYPES[i.typeId]?.tool !== 'road' && TYPES[i.typeId]?.tool !== 'water')
  return (
    <group>
      {roads.length > 0 && <MergedRoads roads={roads} preview={preview} />}
      {lakes.length > 0 && <MergedLake lakes={lakes} preview={preview} />}
      {otherWaters.map((it) => <WaterMesh key={it.id} it={it} preview={preview} onPick={onPick} selected={it.id === selectedId} moveOffset={it.id === selectedId ? moveOffset : null} />)}
      {others.map((it) => <ConstructMesh key={it.id} it={it} preview={preview} onPick={onPick} selected={it.id === selectedId} moveOffset={it.id === selectedId ? moveOffset : null} />)}
    </group>
  )
}

// 湖：连通区域合并成完整水面（内部无缝，保留实际形状——逐格 box 合并，不用包围盒）
function MergedLake({ lakes, preview }) {
  const geo = useMemo(() => {
    // 每个湖格一个 box，整体 merge：L 形/曲线湖保持真实形状，不被外接正方形吞掉
    const list = lakes.map(r => {
      const { x, z } = gridToWorld(r.zoneX, r.zoneZ, r.gx, r.gz)
      const box = new THREE.BoxGeometry(CELL, 0.05, CELL)
      box.translate(x, 0.025, z)
      return box
    })
    if (!list.length) return null
    const merged = mergeGeometries(list, false)
    list.forEach(g => g.dispose())
    return merged
  }, [lakes])
  useEffect(() => () => { geo?.dispose() }, [geo])
  if (!geo) return null
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={preview ? '#7ab3d9' : '#3a7a9a'}
        transparent={preview} opacity={preview ? 0.6 : 1} roughness={0.15} metalness={0.25} />
    </mesh>
  )
}

function MergedRoads({ roads, preview }) {
  const geo = useMemo(() => {
    const list = roads.map(r => {
      const type = TYPES[r.typeId]
      const { x, z } = gridToWorld(r.zoneX, r.zoneZ, r.gx, r.gz)
      const box = new THREE.BoxGeometry(CELL * 0.995, 0.02, CELL * 0.995)
      box.translate(x, 0.01, z)
      return box
    })
    if (!list.length) return null
    const merged = mergeGeometries(list, false)
    list.forEach(g => g.dispose())
    return merged
  }, [roads])
  // 释放旧的合并几何体，防内存泄漏
  useEffect(() => () => { geo?.dispose() }, [geo])
  if (!geo) return null
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={preview ? '#d9a06a' : '#6b6455'}
        transparent={!!preview} opacity={preview ? 0.6 : 1} roughness={1} />
    </mesh>
  )
}

// 三维水体（拱桥等，湖走 MergedLake）
function WaterMesh({ it, preview, selected, onPick, moveOffset }) {
  const type = TYPES[it.typeId]
  let { x, z } = gridToWorld(it.zoneX, it.zoneZ, it.gx, it.gz)
  if (moveOffset) { x += moveOffset.dx * CELL; z += moveOffset.dz * CELL }
  if (it.typeId === '拱桥') {
    const span = type.span || 6
    const rise = type.height || 0.8
    const W = type.width || 1
    const n = 20  // 分段数（越密拱面越平滑）
    const pts = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      pts.push({ x: (t - 0.5) * span, y: rise * Math.sin(Math.PI * t) })  // 拱弧
    }
    const rotY = (it.rotation ?? 0) * Math.PI / 180
    const bridgeColor = preview ? '#d9a06a' : '#8a6a4a'
    const stoneColor = preview ? '#d9a06a' : '#7a5a3a'
    return (
      <group position={[x, 0, z]} rotation={[0, rotY, 0]}
        onClick={(e) => { e.stopPropagation(); onPick && onPick(it) }}>
        {selected && <mesh position={[0, 0.05, 0]} rotation={[Math.PI/2,0,0]}><ringGeometry args={[0.6,0.8,4]} /><meshBasicMaterial color="#ffe14a" transparent opacity={0.9} /></mesh>}
        {/* 桥面（平滑拱弧） */}
        {pts.slice(0, -1).map((p, i) => {
          const q = pts[i + 1]
          const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2
          const len = Math.hypot(q.x - p.x, q.y - p.y)
          const ang = Math.atan2(q.y - p.y, q.x - p.x)
          return (
            <mesh key={'d' + i} position={[cx, cy, 0]} rotation={[0, 0, ang]}>
              <boxGeometry args={[len + 0.03, 0.14, W]} />
              <meshStandardMaterial color={bridgeColor} roughness={0.9} />
            </mesh>
          )
        })}
        {/* 拱券下缘（形成券洞） */}
        {pts.slice(0, -1).map((p, i) => {
          const q = pts[i + 1]
          const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2 - 0.2
          const len = Math.hypot(q.x - p.x, q.y - p.y) * 0.92
          const ang = Math.atan2(q.y - p.y, q.x - p.x)
          return (
            <mesh key={'u' + i} position={[cx, cy, 0]} rotation={[0, 0, ang]}>
              <boxGeometry args={[len, 0.09, W - 0.2]} />
              <meshStandardMaterial color={stoneColor} roughness={0.95} />
            </mesh>
          )
        })}
        {/* 栏杆：两侧，望柱 + 栏板沿弧排列 */}
        {[-W / 2, W / 2].map(side => (
          <group key={'rail' + side}>
            {pts.filter((_, i) => i % 4 === 0).map((p, i) => (
              <group key={'post' + i} position={[p.x, p.y + 0.24, side]}>
                <mesh>
                  <cylinderGeometry args={[0.04, 0.045, 0.42, 8]} />
                  <meshStandardMaterial color={stoneColor} roughness={0.9} />
                </mesh>
                {/* 望柱头：柱顶圆球 */}
                <mesh position={[0, 0.24, 0]}>
                  <sphereGeometry args={[0.055, 8, 8]} />
                  <meshStandardMaterial color={stoneColor} roughness={0.85} />
                </mesh>
              </group>
            ))}
            {pts.slice(0, -1).map((p, i) => {
              const q = pts[i + 1]
              const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2 + 0.24
              const len = Math.hypot(q.x - p.x, q.y - p.y)
              const ang = Math.atan2(q.y - p.y, q.x - p.x)
              return (
                <mesh key={'rail' + i} position={[cx, cy, side]} rotation={[0, 0, ang]}>
                  <boxGeometry args={[len + 0.02, 0.16, 0.05]} />
                  <meshStandardMaterial color={bridgeColor} roughness={0.9} />
                </mesh>
              )
            })}
          </group>
        ))}
        {/* 券脸石：拱圈外沿一圈凸起石条（比桥面略宽、颜色深） */}
        {pts.slice(0, -1).map((p, i) => {
          const q = pts[i + 1]
          const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2 - 0.07
          const len = Math.hypot(q.x - p.x, q.y - p.y) * 1.0
          const ang = Math.atan2(q.y - p.y, q.x - p.x)
          return (
            <mesh key={'face' + i} position={[cx, cy, 0]} rotation={[0, 0, ang]}>
              <boxGeometry args={[len, 0.16, W + 0.12]} />
              <meshStandardMaterial color={stoneColor} roughness={0.95} />
            </mesh>
          )
        })}
        {/* 桥面石板缝：每隔 4 段一条横缝 */}
        {pts.filter((_, i) => i % 4 === 0 && i > 0 && i < n).map((p, i) => (
          <mesh key={'seam' + i} position={[p.x, p.y + 0.075, 0]}>
            <boxGeometry args={[0.03, 0.025, W - 0.1]} />
            <meshStandardMaterial color="#5a4632" roughness={1} />
          </mesh>
        ))}
        {/* 桥头抱鼓石：两端两侧的鼓形石 */}
        {[-1, 1].map(sx => (
          [-1, 1].map(sz => (
            <mesh key={'drum' + sx + sz} position={[sx * (span / 2 + 0.3), 0.12, sz * (W / 2 + 0.1)]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.09, 0.09, 0.14, 10]} />
              <meshStandardMaterial color={stoneColor} roughness={0.9} />
            </mesh>
          ))
        ))}
        {/* 桥墩 */}
        {[[-span / 2 + 0.3, 0], [span / 2 - 0.3, 0]].map(([px, pz], i) => (
          <mesh key={'pier' + i} position={[px, -0.4, 0]}>
            <boxGeometry args={[0.3, 0.8, W]} />
            <meshStandardMaterial color={stoneColor} roughness={0.95} />
          </mesh>
        ))}
        {/* 桥头平台（两端落地过渡） */}
        {[-span / 2 - 0.35, span / 2 + 0.35].map((px, i) => (
          <mesh key={'ap' + i} position={[px, 0.07, 0]}>
            <boxGeometry args={[0.5, 0.14, W]} />
            <meshStandardMaterial color={bridgeColor} roughness={0.9} />
          </mesh>
        ))}
      </group>
    )
  }
  return null
}

// 普通构件（布景/书画/建筑）
function ConstructMesh({ it, preview, onPick, selected, moveOffset }) {
  const type = TYPES[it.typeId]
  if (!type) return null
  let { x, z } = gridToWorld(it.zoneX, it.zoneZ, it.gx, it.gz)
  // 移动预览：选中构件跟随偏移（仅渲染，不改数据）
  if (moveOffset) {
    x += moveOffset.dx * CELL
    z += moveOffset.dz * CELL
  }
  const color = preview ? '#d9a06a' : type.color
  const h = type.height || 0.5
  const onClick = onPick ? (e) => { e.stopPropagation(); onPick(it) } : undefined
  const groupProps = { position: [x, 0, z], onClick }
  // 选中高亮：底面描边框
  const selBox = selected ? (
    <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.3, 0.5, 4]} />
      <meshBasicMaterial color="#ffe14a" transparent opacity={0.9} depthWrite={false} />
    </mesh>
  ) : null

  // hover 状态（提示可点击/点得准）
  const [hovered, setHovered] = React.useState(false)
  const hoverProps = onPick ? {
    onPointerOver: () => setHovered(true),
    onPointerOut: () => setHovered(false),
  } : {}
  const hoverRing = hovered ? (
    <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.5, 0.65, 24]} />
      <meshBasicMaterial color="#ffe14a" transparent opacity={0.6} depthWrite={false} />
    </mesh>
  ) : null

  if (it.typeId === '假山') {
    return (
      <group {...groupProps} {...hoverProps}>
        {selBox}
        {hoverRing}
        <mesh position={[0, 0.8, 0]}>
          <dodecahedronGeometry args={[0.9, 0]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
        <mesh position={[0.3, 1.5, 0.2]}>
          <dodecahedronGeometry args={[0.4, 0]} />
          <meshStandardMaterial color={preview ? '#d9a06a' : '#8a8378'} roughness={0.9} />
        </mesh>
      </group>
    )
  }

  // 匾额：立牌 + 观众题字（书画工具）
  if (it.typeId === '匾额') {
    const txt = (it.text || '清风徐来').trim()
    return (
      <group {...groupProps} {...hoverProps}>
        {selBox}
        {hoverRing}
        {/* 底座 */}
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[0.9, 0.16, 0.3]} />
          <meshStandardMaterial color={preview ? '#d9a06a' : '#8a8172'} roughness={0.8} />
        </mesh>
        {/* 立牌 */}
        <mesh position={[0, 0.55, 0]}>
          <boxGeometry args={[1.1, 0.7, 0.08]} />
          <meshStandardMaterial color={preview ? '#d9a06a' : '#5a3620'} roughness={0.6} />
        </mesh>
        {/* 题字 */}
        <Text position={[0, 0.55, 0.06]} fontSize={0.16} color="#f0e6d0"
          anchorX="center" anchorY="middle" maxWidth={1.0}>
          {txt}
        </Text>
        {preview && (
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.4, 0.6]} />
            <meshStandardMaterial color="#d9a06a" transparent opacity={0.3} depthWrite={false} />
          </mesh>
        )}
      </group>
    )
  }

  // 通用（布景/书画）
  return (
    <group {...groupProps} {...hoverProps}>
      {selBox}
      {hoverRing}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[type.footprint[0] * CELL, h, type.footprint[1] * CELL]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}
