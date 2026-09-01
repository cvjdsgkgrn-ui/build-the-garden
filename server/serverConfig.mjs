export const DEFAULT_SERVER_PORT = 8088

export function resolveServerPort(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_SERVER_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 必须是 1-65535 的整数，当前值：${value}`)
  }
  return port
}
