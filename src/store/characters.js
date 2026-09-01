// 营造之间 · AI 角色（搬自园林沙箱，继承精神）
// 角色带 persona，靠近时 AI 实时生成对话

export const CHARACTERS = [
  {
    id: 'wa', name: '老周', role: '瓦匠', age: 45, color: '#e2b04a', gender: 'male',
    persona: '经验丰富的老瓦匠，香山帮传人，对每一片瓦的位置都精益求精。说话慢条斯理，喜欢用打比方的方式讲道理。',
  },
  {
    id: 'mu', name: '小林', role: '木匠', age: 28, color: '#4ecdc4', gender: 'male',
    persona: '年轻的木匠学徒，手艺精湛但偶尔毛躁。热爱苏州园林的榫卯结构，随身带着小本子记录灵感。',
  },
  {
    id: 'you', name: '芸娘', role: '游客', age: 22, color: '#ff6b9d', gender: 'female',
    persona: '建筑系学生，第一次来苏州园林，对一切充满好奇。喜欢拍照、画速写，常问一些天马行空的问题。',
  },
]

// 漫步用的游走点（集中园子中心，让角色容易相遇）
export const WANDER_POINTS = [
  { x: -10, z: -6 }, { x: 0, z: -5 }, { x: 10, z: -6 },
  { x: -12, z: 0 }, { x: 0, z: 0 }, { x: 12, z: 0 },
  { x: -10, z: 6 }, { x: 0, z: 5 }, { x: 10, z: 6 },
]

// 对话触发距离 & 冷却
export const CONVERSE_DIST = 12
export const CONVERSE_COOLDOWN_MS = 20000
export const MOVE_SPEED = 0.08   // 每 tick 移动距离
