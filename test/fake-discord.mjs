// In-memory fake of the Discord REST API (just the routes CrelioBot uses), for process-level tests.
import { createServer } from 'node:http'
import { oggOpusSample } from './ogg-sample.mjs'

export async function startFakeDiscord({ guildId, channels = [], bots = {}, ttsFormat = 'ogg' }) {
  let next = 500000000000000000n
  const newId = () => String(next++)
  const state = {
    channels: new Map(channels.map(c => [c.id, { guild_id: guildId, type: 0, ...c }])),
    messages: new Map(), // channel id → messages, oldest first
    requests: [],
    rateLimitOnce: new Set(),
    files: new Map(), // attachment id → bytes, served at /files/:id
    roles: [{ id: guildId, name: '@everyone' }],
    notInGuild: new Set(), // bot user ids that were never invited
    avatars: new Map(), // bot user id → the avatar data URI it was given
  }
  const userFor = token => bots[token] ?? { id: '1', username: 'unknown-bot', bot: true }

  function addMessage(channelId, msg) {
    const list = state.messages.get(channelId) ?? []
    const full = { id: newId(), channel_id: channelId, type: 0, content: '', attachments: [], timestamp: new Date().toISOString(), ...msg }
    list.push(full)
    state.messages.set(channelId, list)
    const ch = state.channels.get(channelId)
    if (ch?.thread_metadata?.archived) ch.thread_metadata.archived = false
    if (ch) ch.last_message_id = full.id
    return full
  }

  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks)
    const url = new URL(req.url, 'http://x')
    const path = url.pathname.replace(/^\/api\/v10/, '')
    const token = (req.headers.authorization ?? '').replace(/^Bot /, '')
    let json, form
    const type = req.headers['content-type'] ?? ''
    if (type.startsWith('application/json')) json = JSON.parse(raw.toString() || 'null')
    if (type.startsWith('multipart/form-data')) {
      const fd = await new Response(raw, { headers: { 'content-type': type } }).formData()
      form = { payload: JSON.parse(fd.get('payload_json')), files: [...fd.entries()].filter(([k]) => k.startsWith('files[')).map(([k, f]) => ({ field: k, name: f.name, size: f.size })) }
    }
    if (!/^\/(v1|files)\//.test(url.pathname)) state.requests.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), token, json, form })

    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    const key = `${req.method} ${path}`
    // --- fake OpenAI and CDN ------------------------------------------------
    if (url.pathname === '/v1/audio/transcriptions') {
      const fd = await new Response(raw, { headers: { 'content-type': type } }).formData()
      const file = fd.get('file')
      state.requests.push({ method: 'OPENAI', path: url.pathname, model: fd.get('model'), language: fd.get('language'), filename: file.name, size: file.size, auth: req.headers.authorization })
      return reply(200, { text: state.emptyTranscription ? '' : `transcribed ${file.name} (${file.size} bytes)` })
    }
    if (url.pathname === '/v1/audio/speech') {
      const body = JSON.parse(raw.toString())
      state.requests.push({ method: 'OPENAI', path: url.pathname, body, auth: req.headers.authorization })
      res.writeHead(200, { 'Content-Type': 'audio/ogg' })
      return res.end(ttsFormat === 'ogg' ? oggOpusSample({ seconds: 2.5 }) : Buffer.from('ID3fake-mp3-bytes'))
    }
    const fileMatch = url.pathname.match(/^\/files\/(\d+)$/)
    if (fileMatch) {
      const f = state.files.get(fileMatch[1])
      res.writeHead(f ? 200 : 404)
      return res.end(f ?? '')
    }
    if (state.rateLimitOnce.has(key)) {
      state.rateLimitOnce.delete(key)
      return reply(429, { message: 'You are being rate limited.', retry_after: 0.05, global: false })
    }
    let m
    if (key === 'GET /users/@me') return reply(200, { avatar: null, ...userFor(token) })
    if (key === 'PATCH /users/@me') {
      state.avatars.set(userFor(token).id, json.avatar)
      return reply(200, { ...userFor(token), avatar: 'f00d' })
    }
    if (key === 'GET /applications/@me') return reply(200, { id: userFor(token).id, flags: 1 << 19 })
    if ((m = path.match(/^\/guilds\/(\d+)\/members\/@me$/)) && req.method === 'PATCH') {
      if (state.notInGuild.has(userFor(token).id)) return reply(404, { message: 'Unknown Guild', code: 10004 })
      return reply(200, { nick: json.nick, user: userFor(token) })
    }
    if ((m = path.match(/^\/guilds\/(\d+)\/roles\/(\d+)$/)) && req.method === 'DELETE') {
      const i = state.roles.findIndex(r => r.id === m[2])
      if (i < 0) return reply(404, { message: 'Unknown Role', code: 10011 })
      state.roles.splice(i, 1)
      return reply(204)
    }
    if ((m = path.match(/^\/channels\/(\d+)$/))) {
      const ch = state.channels.get(m[1])
      if (!ch) return reply(404, { message: 'Unknown Channel', code: 10003 })
      if (req.method === 'GET') return reply(200, ch)
      if (req.method === 'DELETE') { state.channels.delete(m[1]); return reply(200, ch) }
      if (req.method === 'PATCH') {
        if (json.archived !== undefined) ch.thread_metadata = { ...ch.thread_metadata, archived: json.archived }
        return reply(200, ch)
      }
    }
    if ((m = path.match(/^\/channels\/(\d+)\/messages$/))) {
      if (!state.channels.has(m[1])) return reply(404, { message: 'Unknown Channel', code: 10003 })
      if (req.method === 'POST') {
        const body = json ?? form.payload
        return reply(200, addMessage(m[1], {
          content: body.content ?? '',
          flags: body.flags ?? 0,
          author: userFor(token),
          type: body.message_reference ? 19 : 0,
          message_reference: body.message_reference,
          attachments: (form?.files ?? []).map((f, i) => ({ id: newId(), filename: f.name, size: f.size, ...(body.attachments?.[i] ?? {}) })),
        }))
      }
      if (req.method === 'GET') {
        const all = [...(state.messages.get(m[1]) ?? [])].reverse()
        const before = url.searchParams.get('before')
        const from = before ? all.findIndex(x => x.id === before) + 1 : 0
        return reply(200, all.slice(from, from + Number(url.searchParams.get('limit') ?? 50)))
      }
    }
    if ((m = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/))) {
      const msg = (state.messages.get(m[1]) ?? []).find(x => x.id === m[2])
      if (!msg) return reply(404, { message: 'Unknown Message', code: 10008 })
      if (req.method === 'GET') return reply(200, msg)
      if (req.method === 'PATCH') { Object.assign(msg, { content: json.content, edited: true }); return reply(200, msg) }
    }
    if ((m = path.match(/^\/channels\/(\d+)\/messages\/(\d+)\/threads$/)) && req.method === 'POST') {
      if (state.channels.has(m[2])) return reply(400, { message: 'A thread has already been created for this message', code: 160004 })
      const th = { id: m[2], type: 11, parent_id: m[1], guild_id: guildId, name: json.name, thread_metadata: { archived: false } }
      state.channels.set(th.id, th)
      return reply(201, th)
    }
    if ((m = path.match(/^\/channels\/(\d+)\/threads$/)) && req.method === 'POST') {
      const th = { id: newId(), type: json.type ?? 12, parent_id: m[1], guild_id: guildId, name: json.name, thread_metadata: { archived: false } }
      state.channels.set(th.id, th)
      return reply(201, th)
    }
    if ((m = path.match(/^\/guilds\/(\d+)\/threads\/active$/)) && req.method === 'GET') {
      return reply(200, { threads: [...state.channels.values()].filter(c => [10, 11, 12].includes(c.type) && !c.thread_metadata?.archived), members: [] })
    }
    if (path.match(/^\/channels\/\d+\/messages\/\d+\/reactions\/.+\/@me$/) && req.method === 'PUT') return reply(204)
    if ((m = path.match(/^\/guilds\/(\d+)\/channels$/))) {
      if (req.method === 'GET') return reply(200, [...state.channels.values()].filter(c => ![10, 11, 12].includes(c.type)))
      if (req.method === 'POST') {
        const ch = { id: newId(), guild_id: m[1], type: json.type ?? 0, name: json.name, parent_id: json.parent_id ?? null, topic: json.topic }
        state.channels.set(ch.id, ch)
        return reply(201, ch)
      }
    }
    if ((m = path.match(/^\/guilds\/(\d+)\/roles$/))) {
      if (req.method === 'GET') return reply(200, state.roles)
      if (req.method === 'POST') {
        const role = { id: newId(), name: json.name, mentionable: json.mentionable, permissions: json.permissions }
        state.roles.push(role)
        return reply(200, role)
      }
    }
    reply(404, { message: `fake: no route ${key}`, code: 0 })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const api = `http://127.0.0.1:${server.address().port}/api/v10`
  return {
    api,
    state,
    addMessage,
    posts: () => state.requests.filter(r => r.method === 'POST' && /\/messages$/.test(r.path)),
    close: () => new Promise(r => server.close(r)),
  }
}
