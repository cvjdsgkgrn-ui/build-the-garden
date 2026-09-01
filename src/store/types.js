// 营造之间 · 构件类型系统 + 区块规模
// 每种构件 = 独立类型定义。新增构件 = 加一个定义。

// 网格常量
export const CELL = 0.5            // 细格 0.5m
export const ZONE_SIZE = 10        // 每区块 10×10 细格
export const ZONES = { W: 12, H: 8 } // 整园 12列 × 8行 区块
export const WORLD_W = ZONES.W * ZONE_SIZE * CELL  // 60m
export const WORLD_H = ZONES.H * ZONE_SIZE * CELL  // 40m

// 构件类型库
export const TYPES = {
  // ---- 营造 · 铺地（观众可放）----
  '铺地-卵石': {
    id: '铺地-卵石', category: '营造', grid: '细', tool: 'road', footprint: [1, 1, 0.05],
    placeOn: '任意', playerCan: true, color: '#6b6455', height: 0.05,
  },
  '铺地-石板': {
    id: '铺地-石板', category: '营造', grid: '细', tool: 'road', footprint: [1, 1, 0.05],
    placeOn: '任意', playerCan: true, color: '#5a6a80', height: 0.05,
  },

  // ---- 营造 · 布景（观众可放）----
  '盆景-松柏': {
    id: '盆景-松柏', category: '营造', grid: '细', tool: 'place', footprint: [1, 1, 1.0],
    placeOn: '任意', playerCan: true, color: '#5f7a55', height: 1.0,
  },
  '盆景-青竹': {
    id: '盆景-青竹', category: '营造', grid: '细', tool: 'place', footprint: [1, 1, 3.2],
    placeOn: '任意', playerCan: true, color: '#6b8e7a', height: 3.2,
  },
  '盆景-腊梅': {
    id: '盆景-腊梅', category: '营造', grid: '细', tool: 'place', footprint: [1, 1, 0.8],
    placeOn: '任意', playerCan: true, color: '#a05a6a', height: 0.8,
  },
  '假山石': {
    id: '假山石', category: '营造', grid: '细', tool: 'place', footprint: [1, 1, 0.6],
    placeOn: '任意', playerCan: true, color: '#8a8172', height: 0.6,
  },

  // ---- 营造 · 书画（观众可放）----
  '匾额': {
    id: '匾额', category: '营造', grid: '细', tool: 'inscribe', footprint: [2, 0.5, 0.5],
    placeOn: '任意', playerCan: true, color: '#b03a2e', height: 0.5,
  },

  // ---- 营造 · 三维水体（观众可建）----
  '湖': {
    id: '湖', category: '营造', grid: '细', tool: 'water', footprint: [1, 1, 0],
    placeOn: '任意', playerCan: true, color: '#3a6a8a', height: 0, depth: 0.4,
  },
  '拱桥': {
    id: '拱桥', category: '营造', grid: '粗', tool: 'water', footprint: [6, 1, 0.8],
    placeOn: '任意', playerCan: true, color: '#8a6a4a', height: 0.8, span: 6, width: 1,
  },

  // ---- 营造 · 建筑（观众可建亭/月洞门/假山）----
  '亭8': {
    id: '亭8', category: '营造', grid: '粗', tool: 'build', footprint: [7, 7, 3],
    placeOn: '任意', playerCan: true, color: '#c4956a', height: 3,
  },
  '亭5': {
    id: '亭5', category: '营造', grid: '粗', tool: 'build', footprint: [7, 7, 3],
    placeOn: '任意', playerCan: true, color: '#c4956a', height: 3,
  },
  '亭6': {
    id: '亭6', category: '营造', grid: '粗', tool: 'build', footprint: [7, 7, 3],
    placeOn: '任意', playerCan: true, color: '#c4956a', height: 3,
  },
  '亭7': {
    id: '亭7', category: '营造', grid: '粗', tool: 'build', footprint: [7, 7, 3],
    placeOn: '任意', playerCan: true, color: '#c4956a', height: 3,
  },
  '月洞门': {
    id: '月洞门', category: '营造', grid: '细', tool: 'build', footprint: [1, 1, 1.8],
    placeOn: '任意', playerCan: true, color: '#8a8378', height: 1.8,
  },
  '假山': {
    id: '假山', category: '营造', grid: '粗', tool: 'build', footprint: [2, 2, 2.0],
    placeOn: '任意', playerCan: true, color: '#7a7260', height: 2.0,
  },
  // 两种墙（高度与月洞门一致 1.8m）
  // ⚠️ footprint 匹配 GLB 模型实际尺寸（高度优先缩放后）：
  //   墙1 模型 8.09m 宽 → 16 格；墙2 模型 7.58m 宽 → 15 格
  '墙1': {
    id: '墙1', category: '营造', grid: '细', tool: 'build', footprint: [16, 1, 1.8],
    placeOn: '任意', playerCan: true, color: '#a0936f', height: 1.8,
  },
  '墙2': {
    id: '墙2', category: '营造', grid: '细', tool: 'build', footprint: [15, 1, 1.8],
    placeOn: '任意', playerCan: true, color: '#a0936f', height: 1.8,
  },
}
