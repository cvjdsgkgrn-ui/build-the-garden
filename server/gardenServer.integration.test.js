import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocket } from "ws"
import { afterEach, describe, expect, it } from "vitest"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = path.join(dirname, "garden-server.mjs")
const children = new Set()

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForPort(port, child) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`garden server exited early (${child.exitCode})`)
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
          socket.end()
          resolve()
        })
        socket.once("error", reject)
      })
      return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("garden server did not become ready")
}

async function startServer() {
  const port = await reservePort()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "garden-world-test-"))
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: path.dirname(dirname),
    env: {
      ...process.env,
      PORT: String(port),
      GARDEN_STATE_FILE: path.join(tempDir, "state.json"),
      DEEPSEEK_API_KEY: "",
    },
    stdio: ["ignore", "ignore", "pipe"],
  })
  children.add(child)
  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  try {
    await waitForPort(port, child)
  } catch (error) {
    throw new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ""}`)
  }
  return { child, port, tempDir }
}

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    socket.once("open", () => resolve(socket))
    socket.once("error", reject)
  })
}

function waitForMessage(socket, predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage)
      reject(new Error("timed out waiting for WebSocket message"))
    }, timeoutMs)
    function onMessage(raw) {
      let message
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (!predicate(message)) return
      clearTimeout(timer)
      socket.off("message", onMessage)
      resolve(message)
    }
    socket.on("message", onMessage)
  })
}

function post(port, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/api/chat",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (response) => {
      response.resume()
      response.on("end", () => resolve(response.statusCode))
    })
    request.on("error", reject)
    request.end(body)
  })
}

afterEach(async () => {
  const active = [...children]
  children.clear()
  await Promise.all(active.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return }
    child.once("exit", resolve)
    child.kill("SIGTERM")
    setTimeout(resolve, 1000)
  })))
})

describe("garden server trust boundary", () => {
  it("requires join, assigns server-owned authorship, and rejects invalid movement", async () => {
    const { child, port, tempDir } = await startServer()
    const socket = await openSocket(port)
    await waitForMessage(socket, (message) => message.type === "snapshot")

    const unjoinedAdd = waitForMessage(socket, (message) => message.type === "construct-added", 150)
    socket.send(JSON.stringify({
      type: "construct-add",
      item: { id: "it-before-join", typeId: "铺地-卵石", zoneX: 0, zoneZ: 0, gx: 5, gz: 5 },
    }))
    await expect(unjoinedAdd).rejects.toThrow(/timed out/)

    const joined = waitForMessage(socket, (message) => message.type === "visitor-join")
    socket.send(JSON.stringify({ type: "join", id: "u-tester-a1b2", name: "测试者", avatar: "c1", color: "#b75c3a" }))
    await joined

    const added = waitForMessage(socket, (message) => message.type === "construct-added")
    socket.send(JSON.stringify({
      type: "construct-add",
      item: {
        id: "it-valid",
        typeId: "铺地-卵石",
        zoneX: 0,
        zoneZ: 0,
        gx: 5,
        gz: 5,
        rotation: 0,
        author: "forged-author",
        unexpected: "not persisted",
      },
    }))
    const addedMessage = await added
    expect(addedMessage.item.author).toBe("u-tester-a1b2")
    expect(addedMessage.item).not.toHaveProperty("unexpected")

    const invalidMove = waitForMessage(socket, (message) => message.type === "construct-moved", 150)
    socket.send(JSON.stringify({ type: "construct-move", id: "it-valid", zoneX: 99, zoneZ: 0, gx: 0, gz: 0 }))
    await expect(invalidMove).rejects.toThrow(/timed out/)

    socket.close()
    child.kill("SIGTERM")
    await new Promise((resolve) => child.once("exit", resolve))
    children.delete(child)
    const persisted = JSON.parse(fs.readFileSync(path.join(tempDir, "state.json"), "utf8"))
    expect(persisted.constructs).toHaveLength(1)
    expect(persisted.constructs[0].author).toBe("u-tester-a1b2")
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("rejects duplicate active visitor ids and oversized chat bodies", async () => {
    const { port, tempDir } = await startServer()
    const first = await openSocket(port)
    await waitForMessage(first, (message) => message.type === "snapshot")
    first.send(JSON.stringify({ type: "join", id: "u-same-a1b2", name: "甲", avatar: "c1", color: "#b75c3a" }))
    await waitForMessage(first, (message) => message.type === "visitor-join")

    const second = await openSocket(port)
    await waitForMessage(second, (message) => message.type === "snapshot")
    const closed = new Promise((resolve) => second.once("close", (code) => resolve(code)))
    second.send(JSON.stringify({ type: "join", id: "u-same-a1b2", name: "乙", avatar: "c2", color: "#4ecdc4" }))
    expect(await closed).toBe(4009)

    expect(await post(port, JSON.stringify({ messages: [{ role: "user", content: "x".repeat(70_000) }] })))
      .toBe(413)
    first.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})
