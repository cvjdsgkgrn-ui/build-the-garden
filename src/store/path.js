// 营造之间 · 铺路路径算法
// 沿网格算一条连续路。斜向移动时补桥接块，保证不角对角断开。

export function buildPath(gx0, gz0, gx1, gz1) {
  const cells = []
  let gx = gx0, gz = gz0
  const dx = Math.sign(gx1 - gx0), dz = Math.sign(gz1 - gz0)
  while (gx !== gx1 || gz !== gz1) {
    cells.push([gx, gz])
    if (gx !== gx1 && gz !== gz1) {
      cells.push([gx, gz + dz])   // 垂直桥接
      gx += dx; gz += dz
    } else if (gx !== gx1) {
      gx += dx
    } else {
      gz += dz
    }
  }
  cells.push([gx1, gz1])
  return cells
}
