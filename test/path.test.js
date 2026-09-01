import { describe, it, expect } from 'vitest'
import { buildPath } from '../src/store/path.js'

describe('铺路路径算法 buildPath', () => {
  it('水平路：只走一格宽，起点终点正确', () => {
    const cells = buildPath(1, 1, 5, 1)
    expect(cells[0]).toEqual([1, 1])
    expect(cells[cells.length - 1]).toEqual([5, 1])
    // 水平路所有格子 gz 相同
    expect(cells.every(([, gz]) => gz === 1)).toBe(true)
    // 覆盖 1..5
    expect(new Set(cells.map(([gx]) => gx))).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  it('垂直路：所有格子 gx 相同', () => {
    const cells = buildPath(3, 2, 3, 7)
    expect(cells.every(([gx]) => gx === 3)).toBe(true)
    expect(cells[cells.length - 1]).toEqual([3, 7])
  })

  it('斜向路：补桥接块，保证连续（无角对角断开）', () => {
    const cells = buildPath(1, 1, 4, 4)
    // 每两个相邻格子必须共享一条边（非仅角相邻）
    for (let i = 0; i < cells.length - 1; i++) {
      const [gx1, gz1] = cells[i]
      const [gx2, gz2] = cells[i + 1]
      const d = Math.abs(gx1 - gx2) + Math.abs(gz1 - gz2)
      expect(d).toBe(1)  // 曼哈顿距离必须为1，否则是角对角（d=2）
    }
    // 起点终点正确
    expect(cells[0]).toEqual([1, 1])
    expect(cells[cells.length - 1]).toEqual([4, 4])
  })

  it('同一点：只有一格', () => {
    const cells = buildPath(2, 2, 2, 2)
    expect(cells).toEqual([[2, 2]])
  })

  it('斜向路径每步曼哈顿距离为1（连续）', () => {
    const cells = buildPath(1, 5, 6, 1)
    for (let i = 0; i < cells.length - 1; i++) {
      const [a, b] = cells[i]
      const [c, d] = cells[i + 1]
      expect(Math.abs(a - c) + Math.abs(b - d)).toBe(1)
    }
    expect(cells[0]).toEqual([1, 5])
    expect(cells[cells.length - 1]).toEqual([6, 1])
  })
})
