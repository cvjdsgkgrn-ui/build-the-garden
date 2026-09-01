import { describe, expect, it } from "vitest"
import { getStableVisitorId, getWebSocketUrl } from "./sync.js"

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
  }
}

describe("stable visitor identity", () => {
  it("reuses one browser suffix across reconnects", () => {
    const storage = memoryStorage()
    const first = getStableVisitorId("山月", { storage, random: () => 0.123456 })
    const second = getStableVisitorId("山月", { storage, random: () => 0.987654 })
    expect(second).toBe(first)
    expect(first).toMatch(/^u-山月-[a-z0-9]{4}$/)
  })

  it("normalizes unsafe or empty display names without changing the stored suffix", () => {
    const storage = memoryStorage()
    const first = getStableVisitorId("  A B\nC  ", { storage, random: () => 0.5 })
    const second = getStableVisitorId("", { storage, random: () => 0.1 })
    expect(first).toMatch(/^u-ABC-[a-z0-9]{4}$/)
    expect(second).toMatch(/^u-guest-[a-z0-9]{4}$/)
    expect(first.split("-").at(-1)).toBe(second.split("-").at(-1))
  })
})

describe("WebSocket URL", () => {
  it("uses the page port in development and upgrades with HTTPS", () => {
    expect(getWebSocketUrl({ hostname: "192.168.1.8", port: "5174", protocol: "http:" }))
      .toBe("ws://192.168.1.8:5174/ws")
    expect(getWebSocketUrl({ hostname: "garden.example", port: "", protocol: "https:" }))
      .toBe("wss://garden.example/ws")
  })
})
