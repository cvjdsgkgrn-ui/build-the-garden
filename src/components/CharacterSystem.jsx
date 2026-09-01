import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MOVE_SPEED } from '../store/characters.js'
import { steerAvoid } from '../store/nav.js'

// 角色缩放：0.5 = 缩小一倍（让亭子/墙的相对比例更大）
const CHARACTER_SCALE = 0.5

// 单个角色 mesh（陶俑风格：球头 + 圆柱身 + 斗笠）
function CharacterMesh({ char, walkMap }) {
  const groupRef = useRef()
  // 角色移动：向 target 平滑移动，前方障碍/水时绕开
  useFrame(() => {
    if (!groupRef.current || !char.target) return
    const pos = groupRef.current.position
    const dx = char.target.x - pos.x
    const dz = char.target.z - pos.z
    const d = Math.hypot(dx, dz)
    if (d < 0.1) {
      char.target = null
      return
    }
    // 避障：若当前位置被堵（异常情况）或前方被挡，绕行
    const move = steerAvoid({ x: pos.x, z: pos.z }, { dx, dz }, walkMap, 0.35)
    if (!move) {
      // 完全被堵：换个目标
      char.target = null
      return
    }
    const step = Math.min(MOVE_SPEED, Math.hypot(move.dx, move.dz))
    const md = Math.hypot(move.dx, move.dz) || 1
    pos.x += (move.dx / md) * step
    pos.z += (move.dz / md) * step
    // 面朝移动方向
    groupRef.current.rotation.y = Math.atan2(move.dx, move.dz)
    // 行走时轻微起伏
    char._walkPhase = (char._walkPhase || 0) + 0.3
    pos.y = Math.abs(Math.sin(char._walkPhase)) * 0.06 * CHARACTER_SCALE
  })

  return (
    <group ref={groupRef} position={[char.x || 0, 0, char.z || 0]} scale={CHARACTER_SCALE}>
      {/* 底座 */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.25, 0.32, 0.12, 12]} />
        <meshStandardMaterial color="#6b6455" />
      </mesh>
      {/* 身体（圆柱） */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.6, 12]} />
        <meshStandardMaterial color={char.color} />
      </mesh>
      {/* 头（球） */}
      <mesh position={[0, 0.82, 0]}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshStandardMaterial color={char.color} />
      </mesh>
      {/* 斗笠 */}
      <mesh position={[0, 0.98, 0]}>
        <coneGeometry args={[0.28, 0.14, 8]} />
        <meshStandardMaterial color="#8a6a3a" />
      </mesh>
    </group>
  )
}

// 角色系统：渲染所有角色
export default function CharacterSystem({ characters, walkMap }) {
  return (
    <group>
      {characters.map(c => <CharacterMesh key={c.id} char={c} walkMap={walkMap} />)}
    </group>
  )
}
