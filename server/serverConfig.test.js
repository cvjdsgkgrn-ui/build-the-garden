import { describe, expect, it } from "vitest"
import { DEFAULT_SERVER_PORT, resolveServerPort } from "./serverConfig.mjs"

describe("garden server port", () => {
  it("matches the README, Vite HTTP proxy, and WebSocket proxy by default", () => {
    expect(DEFAULT_SERVER_PORT).toBe(8088)
    expect(resolveServerPort(undefined)).toBe(8088)
    expect(resolveServerPort("")).toBe(8088)
  })

  it("accepts an explicit valid TCP port", () => {
    expect(resolveServerPort("9000")).toBe(9000)
  })

  it("rejects invalid port overrides instead of starting on a surprising value", () => {
    expect(() => resolveServerPort("0")).toThrow(/PORT/)
    expect(() => resolveServerPort("not-a-port")).toThrow(/PORT/)
    expect(() => resolveServerPort("70000")).toThrow(/PORT/)
  })
})
