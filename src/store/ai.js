// 营造之间 · AI 对话（走后端代理，Key 不暴露前端）
const CHAT_URL = '/api/chat'

// 两个角色相遇 → AI 生成对话
export async function generateDialogue(charA, charB) {
  const system = '你是苏州园林的叙事者，为一对在园中相遇的人生成一段自然简短的对话。'
  const user = `下面两个人，都在苏州园林里，他们碰巧相遇了。

${charA.name}：${charA.role}，${charA.persona}
${charB.name}：${charB.role}，${charB.persona}

请生成一段自然简短的对话（每人说1-2句，总共3-4句）。
只输出对话内容本身，每句话用「名字：内容」的格式，每句一行。
对话要符合人物身份，围绕园林景色、建筑工艺或营造技艺展开。`

  const text = await callChat([{ role: 'system', content: system }, { role: 'user', content: user }])
  return parseDialogue(text, charA, charB)
}

// 调用后端 AI 代理（20 秒超时，防止 AI 服务卡住时对话状态悬挂）
async function callChat(messages) {
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(20000),
  })
  if (!resp.ok) {
    const j = await resp.json().catch(() => ({}))
    throw new Error(j?.error || `AI 服务错误 (${resp.status})`)
  }
  const j = await resp.json()
  return j.text || ''
}

// 解析 AI 返回的对话为结构化 [{name, text}]
function parseDialogue(text, charA, charB) {
  const nameMap = {}
  nameMap[charA.name] = charA
  nameMap[charB.name] = charB
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const turns = []
  for (const line of lines) {
    const m = line.match(/^([^：:]+)[：:]\s*(.+)$/)
    if (m) {
      const who = nameMap[m[1].trim()] || { name: m[1].trim(), color: '#8a8378' }
      turns.push({ name: who.name, color: who.color, text: m[2].trim() })
    }
  }
  // 如果没解析出结构，整体当成一段话
  if (!turns.length) {
    return [{ name: charA.name, color: charA.color, text }]
  }
  return turns
}
