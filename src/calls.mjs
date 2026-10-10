// Calls (CONTEXT.md): people talk with a KB team in the KB's voice channel. The Call service
// (calls/service.mjs, its own dependencies — ADR-0007) holds the Discord voice connection; everything
// else lives here, dependency-free and testable:
//   - who is in which Call, when the bot joins, stays and leaves;
//   - utterances → speech only (src/vad.mjs) → Ogg → transcription → the KB session's inbox (it wakes up and answers);
//   - what the session says back (call_say) → speech → played in the call, or kept for when people return;
//   - the control server the session's MCP tools talk to.

import { connect } from 'node:net'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentName } from './instance.mjs'
import { FLAGS } from './discord.mjs'
import { oggFromOpus } from './ogg.mjs'
import { keepSpeech, VAD_DEFAULTS } from './vad.mjs'
import { cleanTranscript } from './voice.mjs'

export class CallError extends Error { name = 'CallError' }

// min_speech_ms: detected speech an utterance needs (less is noise). barge_ms: speech that interrupts the bot.
// vad: speech detection settings (VAD_DEFAULTS in src/vad.mjs).
export const CALL_DEFAULTS = { silence_ms: 800, merge_ms: 700, min_speech_ms: 200, barge_ms: 300, idle_minutes: 120, transcript: true, vad: {} }
const FRAME_MS = 20

// ------------------------------------------------------------------ the KB session's inbox
// Claude Code gives every session an inbox (cross-session messaging) and exports its address to hooks.
// The plugin's SessionStart hook records it; the Call service posts there, which wakes the session.

export function inboxFile(stateDir) { return join(stateDir, 'inbox.json') }

export function writeInboxAddress(stateDir, env = process.env) {
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET
  if (!socket) return false
  mkdirSync(stateDir, { recursive: true })
  const tmp = inboxFile(stateDir) + '.tmp'
  writeFileSync(tmp, JSON.stringify({ socket, token: env.CLAUDE_CODE_MESSAGING_TOKEN ?? null, at: new Date().toISOString() }), { mode: 0o600 })
  renameSync(tmp, inboxFile(stateDir))
  return true
}

/** Posts a message into a session's inbox. Resolves false when the session is not reachable. */
export function postToSession(stateDir, text, { from = 'crelio-call', timeoutMs = 5000 } = {}) {
  let addr
  try { addr = JSON.parse(readFileSync(inboxFile(stateDir), 'utf8')) } catch { return Promise.resolve(false) }
  return new Promise(resolve => {
    const socket = connect(String(addr.socket).replace(/^uds:/, ''))
    let settled = false
    const done = ok => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); resolve(ok) }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.on('connect', () => {
      if (addr.token) socket.write(JSON.stringify({ type: 'auth', token: addr.token }) + '\n')
      socket.end(JSON.stringify({ type: 'user', from, msg_id: randomUUID(), message: { content: text } }) + '\n')
    })
    socket.on('close', () => done(true))
    socket.on('error', () => done(false))
  })
}

// ------------------------------------------------------------------ text helpers

/** Text the way it should be spoken: no markdown, links, mentions or emoji. */
export function speakable(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[@#][&!]?\d+>/g, ' ')
    .replace(/[*_`~>#|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/** Sentences grouped into chunks of at most `max` characters, so the first one plays sooner. */
export function speechChunks(text, max = 280) {
  const sentences = text.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [text]
  const chunks = []
  let cur = ''
  for (const s of sentences) {
    if (cur && (cur + s).length > max) { chunks.push(cur.trim()); cur = '' }
    cur += s
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

// ------------------------------------------------------------------ the Call controller

/**
 * adapter (the voice connection, implemented by calls/service.mjs):
 *   join(guildId, channelId), leave(guildId), play(guildId, oggBuffer) → resolves when played or stopped,
 *   stop(guildId), connectedChannel(guildId) → channel id or null
 */
export function createCalls({
  instance,
  adapter,
  voice,
  clientFor,
  deliver = (kbId, text) => postToSession(instance.stateDir(kbId), text),
  owns = () => true, // the KBs this controller serves (the service runs one per Manager bot)
  now = Date.now,
  log = () => {},
  timers = { setTimeout, clearTimeout },
}) {
  const calls = new Map() // kb id → Call
  const pending = new Map() // `${kb}:${user}` → { name, parts: Promise[], timer } — words waiting for the end of a sentence
  const queues = new Map() // guild id → promise chain of speech

  const enabledKbs = () => [...instance.kbs.values()].filter(k => k.call?.enabled && k.discord?.call_id && owns(k.id))
  const kbOfChannel = channelId => enabledKbs().find(k => k.discord.call_id === channelId)?.id ?? null
  const config = kbId => ({ ...CALL_DEFAULTS, ...instance.kb(kbId).call })

  function call(kbId) {
    let c = calls.get(kbId)
    if (!c) {
      c = { kb: kbId, channelId: instance.kb(kbId).discord.call_id, humans: new Map(), active: false, endRequested: false, held: [], outbox: [], since: null, leftAt: null, lastActivity: now(), epoch: 0, interrupted: false, seq: 0 }
      calls.set(kbId, c)
    }
    c.channelId = instance.kb(kbId).discord.call_id
    return c
  }

  function persist(c) {
    const dir = join(instance.stateDir(c.kb), 'call')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      active: c.active, channel_id: c.channelId, people: [...c.humans.values()], end_requested: c.endRequested,
      held: c.held.length, since: c.since, updated: new Date(now()).toISOString(),
    }, null, 2))
  }

  async function tell(c, text) {
    const ok = await deliver(c.kb, text).catch(() => false)
    if (!ok) {
      log(`[${c.kb}] session unreachable — could not deliver: ${text.slice(0, 80)}`)
      await chat(c, `⚠️ The ${instance.kb(c.kb).name ?? c.kb} session is not reachable right now (restarting?). Say it again in a minute, or write in #general.`)
    }
    return ok
  }

  /** A silent line in the voice channel's text chat — the call's transcript. */
  async function chat(c, text) {
    if (!config(c.kb).transcript) return
    try {
      await clientFor(instance.requireToken(c.kb, 'manager')).post(`/channels/${c.channelId}/messages`, {
        content: text.slice(0, 2000), flags: FLAGS.SUPPRESS_EMBEDS | FLAGS.SUPPRESS_NOTIFICATIONS, allowed_mentions: { parse: [] },
      })
    } catch (e) { log(`[${c.kb}] transcript post failed: ${e.message}`) }
  }

  const people = c => [...c.humans.values()].join(', ') || 'nobody'
  const minutes = ms => Math.max(1, Math.round(ms / 60000))

  async function humanJoined(kbId, guildId, userId, name) {
    const c = call(kbId)
    const wasEmpty = c.humans.size === 0
    c.humans.set(userId, name)
    c.lastActivity = now()
    const where = adapter.connectedChannel(guildId)
    if (where !== c.channelId) {
      const otherKb = where ? kbOfChannel(where) : null
      const other = otherKb ? calls.get(otherKb) : null
      if (other?.humans.size) {
        c.waiting = true
        persist(c)
        await chat(c, `📞 I'm in the ${instance.kb(otherKb).name ?? otherKb} call right now — I'll come here as soon as it frees up.`)
        return
      }
      await adapter.join(guildId, c.channelId)
      c.waiting = false
    }
    if (!c.active) {
      Object.assign(c, { active: true, endRequested: false, held: [], since: new Date(now()).toISOString(), leftAt: null })
      persist(c)
      await tell(c, `📞 [Call] ${name} joined the voice channel <#${c.channelId}> — a Call has started. Greet them in one short sentence with call_say, then listen.`)
    } else if (wasEmpty) {
      const held = c.held.splice(0)
      const away = c.leftAt ? ` (away ${minutes(now() - c.leftAt)} min)` : ''
      c.leftAt = null
      persist(c)
      await tell(c, `📞 [Call] ${name} is back in the call${away}.${held.length ? ` While nobody was there you wanted to say: ${held.map(h => `« ${h} »`).join(' ')}` : ''} Give them a short spoken update of where the work stands (call_say).`)
    } else {
      persist(c)
      await tell(c, `📞 [Call] ${name} joined the call (now: ${people(c)}).`)
    }
  }

  /** `to`: the KB whose call they went to, when they moved straight to another Call channel. */
  async function humanLeft(kbId, guildId, userId, name, { to = null } = {}) {
    const c = calls.get(kbId)
    if (!c?.humans.has(userId)) return
    c.humans.delete(userId)
    dropSpeech(kbId, userId)
    if (c.humans.size) {
      persist(c)
      await tell(c, `📞 [Call] ${name} left the call (still there: ${people(c)}).`)
    } else if (c.endRequested) {
      await endCall(c, guildId, `📞 [Call] ${name} left and the Call is over — I left the voice channel.`)
    } else {
      const cut = silence(c, guildId, { keep: true }) // nobody hears the rest: it waits with what is held
      c.leftAt = now()
      c.lastActivity = now()
      persist(c)
      const where = to
        ? `went to the ${instance.kb(to).name ?? to} call — the bot follows them there (one bot, one voice channel per server). This Call stays open`
        : 'left — nobody is in the call now. I stay in the channel'
      await tell(c, `📞 [Call] ${name} ${where}.${cut ? ' You were cut off mid-reply; the rest is kept.' : ''} Keep working: what you call_say now is kept and you'll give them an update when they come back.`)
    }
    await serveWaiting(guildId)
  }

  /** Stops what the bot says (and was about to say) in this Call; keep = hold it for when people are back. */
  function silence(c, guildId, { keep = false } = {}) {
    const rest = c.outbox.splice(0).map(o => o.chunks.slice(o.i).join(' ')).filter(Boolean)
    if (keep) c.held.push(...rest)
    c.epoch++
    if (c.speaking) {
      c.speaking = false
      adapter.stop(guildId)
    }
    return rest.length
  }

  /** A call that waited for the bot (busy elsewhere) gets it once the other call is empty. */
  async function serveWaiting(guildId) {
    const where = adapter.connectedChannel(guildId)
    const busy = where && calls.get(kbOfChannel(where))?.humans.size
    if (busy) return
    for (const c of calls.values()) {
      if (c.waiting && c.humans.size) {
        const [[userId, name]] = c.humans
        c.humans.delete(userId)
        await humanJoined(c.kb, guildId, userId, name)
        return
      }
    }
  }

  async function endCall(c, guildId, text) {
    silence(c, guildId)
    if (adapter.connectedChannel(guildId) === c.channelId) await adapter.leave(guildId)
    const unsaid = c.held.splice(0)
    Object.assign(c, { active: false, endRequested: false, leftAt: null, since: null })
    persist(c)
    await tell(c, `${text}${unsaid.length ? ` Not said (nobody was there): ${unsaid.map(h => `« ${h} »`).join(' ')} — post what matters in the Task thread.` : ''}`)
  }

  function dropSpeech(kbId, userId) {
    const s = pending.get(`${kbId}:${userId}`)
    if (s) { timers.clearTimeout(s.timer); pending.delete(`${kbId}:${userId}`) }
  }

  function vocabulary(kbId) {
    const kb = instance.kb(kbId)
    const words = [kb.name ?? kbId, ...[...instance.kbs.values()].map(k => k.name ?? k.id), 'CrelioBot', ...instance.agentsFor(kbId).map(agentName), ...(kb.call?.vocabulary ?? [])]
    return [...new Set(words)].join(', ')
  }

  async function transcribe(kbId, packets) {
    try {
      // The language is what people speak (voice.language), not the KB's: unset, the model detects it.
      const text = await voice(kbId).transcribe(oggFromOpus(packets), { filename: 'utterance.ogg', contentType: 'audio/ogg', prompt: vocabulary(kbId) })
      return cleanTranscript(text) || null
    } catch (e) {
      if (!/empty/.test(e.message)) log(`[${kbId}] transcription failed: ${e.message}`)
      return null
    }
  }

  /**
   * One segment of someone's audio (the service cuts segments at `silence_ms` without packets). `speech`:
   * one flag per packet from the speech detector — only the speech is transcribed, and a segment without
   * enough of it (breathing, a keyboard, noise) is dropped before speech-to-text can invent words from it.
   */
  function utterance({ channelId, userId, name, packets, speech }) {
    const kbId = kbOfChannel(channelId)
    if (!kbId) return
    const c = call(kbId)
    if (!c.active || !c.humans.has(userId)) return
    const cfg = config(kbId)
    const key = `${kbId}:${userId}`
    const s = pending.get(key) ?? { name: name ?? c.humans.get(userId), parts: [] }
    const heard = speech ? keepSpeech(speech, { ...VAD_DEFAULTS, ...cfg.vad }) : { speech_ms: packets.length * FRAME_MS, keep: null }
    const enough = heard.speech_ms >= cfg.min_speech_ms
    log(`[${kbId}] ${s.name}: ${packets.length * FRAME_MS} ms of audio, ${heard.speech_ms} ms of speech${enough ? '' : ' — ignored'}`)
    if (enough) s.parts.push(transcribe(kbId, heard.keep ? heard.keep.map(i => packets[i]) : packets))
    if (!s.parts.length) return
    timers.clearTimeout(s.timer) // words already waiting go out even when this segment was noise
    s.timer = timers.setTimeout(() => flush(kbId, userId), cfg.merge_ms)
    pending.set(key, s)
  }

  /** Someone's audio started: hold their waiting words, more may be coming. */
  function speakingStart({ channelId, userId }) {
    const kbId = kbOfChannel(channelId)
    if (!kbId) return
    const s = pending.get(`${kbId}:${userId}`)
    if (s) timers.clearTimeout(s.timer)
  }

  /** Someone talks over the bot (the service calls this once it hears `barge_ms` of speech): it stops. */
  function bargeIn({ guildId, channelId, userId }) {
    const kbId = kbOfChannel(channelId)
    const c = kbId ? calls.get(kbId) : null
    if (!c?.speaking || !c.humans.has(userId)) return
    silence(c, guildId)
    c.interrupted = true
  }

  async function flush(kbId, userId) {
    const key = `${kbId}:${userId}`
    const s = pending.get(key)
    if (!s) return
    pending.delete(key)
    const text = (await Promise.all(s.parts)).filter(Boolean).join(' ').trim()
    const c = calls.get(kbId)
    if (!text || !c?.active) return
    c.lastActivity = now()
    const id = `u${++c.seq}-${Date.now().toString(36)}`
    const dir = join(instance.stateDir(kbId), 'call')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'utterances.jsonl'), JSON.stringify({ id, user_id: userId, name: s.name, text, ts: new Date(now()).toISOString() }) + '\n')
    const interrupted = c.interrupted
    c.interrupted = false
    await chat(c, `🎙️ **${s.name}**: ${text}`)
    await tell(c, `🎙️ [Call] ${s.name} (user ${userId}, utterance ${id}): « ${text} »${interrupted ? ' — they interrupted your reply' : ''}`)
  }

  /** The session speaks: synthesized chunk by chunk (the next one is prepared while one plays). */
  function play(c, guildId, text) {
    const epoch = c.epoch
    const item = { chunks: speechChunks(text), i: 0 } // i: the chunk being said — a cut-off keeps the rest
    const { chunks } = item
    c.outbox.push(item)
    const run = async () => {
      if (c.epoch !== epoch) return
      c.speaking = true
      let next = voice(c.kb).speak(chunks[0])
      for (; item.i < chunks.length && c.epoch === epoch; item.i++) {
        let audio
        try { audio = await next } catch (e) { log(`[${c.kb}] speech failed: ${e.message}`); break }
        next = item.i + 1 < chunks.length ? voice(c.kb).speak(chunks[item.i + 1]) : null
        next?.catch(() => {})
        if (c.epoch !== epoch) break
        await adapter.play(guildId, audio)
      }
      if (c.epoch === epoch) {
        c.speaking = false
        c.outbox.splice(c.outbox.indexOf(item), 1)
      }
    }
    const queued = (queues.get(guildId) ?? Promise.resolve()).then(run, run)
    queues.set(guildId, queued)
    return queued
  }

  // ---------------------------------------------------------------- what the session can do
  async function say(kbId, text) {
    const c = calls.get(kbId)
    if (!c?.active) throw new CallError('no Call in progress in this KB — nobody is in its voice channel')
    const clean = speakable(text)
    if (!clean) throw new CallError('nothing to say once markdown, links and emoji are removed')
    c.lastActivity = now()
    const guildId = instance.guildId
    if (!c.humans.size || adapter.connectedChannel(guildId) !== c.channelId) {
      c.held.push(clean)
      persist(c)
      return { spoken: false, held: c.held.length, note: 'Nobody is listening right now — kept; you will give an update when someone comes back.' }
    }
    await chat(c, `🔊 ${clean}`)
    play(c, guildId, clean)
    return { spoken: true, listeners: [...c.humans.values()] }
  }

  async function end(kbId, { now: immediately = false } = {}) {
    const c = calls.get(kbId)
    if (!c?.active) return { active: false, note: 'no Call in progress' }
    if (immediately || !c.humans.size) {
      await endCall(c, instance.guildId, '📞 [Call] The Call is over — I left the voice channel.')
      return { left: true }
    }
    c.endRequested = true
    persist(c)
    return { left: false, note: `I'll leave when the last person leaves (now: ${people(c)}).` }
  }

  function status(kbId) {
    const c = calls.get(kbId)
    return {
      active: !!c?.active,
      channel_id: instance.kb(kbId).discord?.call_id ?? null,
      people: c ? [...c.humans.values()] : [],
      bot_in_channel: !!c && adapter.connectedChannel(instance.guildId) === c.channelId,
      end_requested: !!c?.endRequested,
      held: c?.held.length ?? 0,
      waiting_for_bot: !!c?.waiting,
    }
  }

  // ---------------------------------------------------------------- voice state + housekeeping
  async function voiceState({ guildId, userId, name, bot, before, after }) {
    if (bot || before === after) return
    const left = before ? kbOfChannel(before) : null
    const joined = after ? kbOfChannel(after) : null
    if (left) await humanLeft(left, guildId, userId, name, { to: joined })
    if (joined) await humanJoined(joined, guildId, userId, name)
  }

  /** The bot was disconnected (kicked, network): rejoin if people are there, otherwise the Call ends. */
  async function disconnected(guildId, channelId) {
    const kbId = kbOfChannel(channelId)
    const c = kbId ? calls.get(kbId) : null
    if (!c?.active) return
    if (c.humans.size) { await adapter.join(guildId, c.channelId).catch(e => log(`[${kbId}] rejoin failed: ${e.message}`)); return }
    await endCall(c, guildId, '📞 [Call] I was disconnected from the empty voice channel — the Call is over.')
  }

  /** Every minute: leave a Call nobody has been in, and that nobody has spoken to, for idle_minutes. */
  async function tick() {
    for (const c of calls.values()) {
      if (c.active && !c.humans.size && now() - c.lastActivity > config(c.kb).idle_minutes * 60000) {
        await endCall(c, instance.guildId, `📞 [Call] Nobody came back for ${config(c.kb).idle_minutes} min — I left the voice channel.`)
      }
    }
  }

  return { voiceState, utterance, speakingStart, bargeIn, disconnected, tick, say, end, status, kbOfChannel, enabledKbs, config, _calls: calls }
}

// ------------------------------------------------------------------ control server (Call service side)

export function serviceFile(instance) { return join(instance.workspaceDir, 'state', 'calls', 'service.json') }

/** Local HTTP control for the session's tools: POST /say, POST /end, GET /status. */
export async function startControlServer({ instance, calls, port = 0 }) {
  const token = randomBytes(16).toString('hex')
  const server = createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers['x-crelio-token'] !== token) return reply(401, { error: 'bad token' })
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body = {}
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {} } catch { return reply(400, { error: 'bad json' }) }
    const url = new URL(req.url, 'http://x')
    const kb = body.kb ?? url.searchParams.get('kb')
    try {
      instance.kb(kb)
      if (req.method === 'POST' && url.pathname === '/say') return reply(200, await calls.say(kb, body.text))
      if (req.method === 'POST' && url.pathname === '/end') return reply(200, await calls.end(kb, { now: !!body.now }))
      if (req.method === 'GET' && url.pathname === '/status') return reply(200, calls.status(kb))
      return reply(404, { error: 'unknown route' })
    } catch (e) {
      return reply(e.name === 'CallError' || e.name === 'ConfigError' ? 409 : 500, { error: e.message })
    }
  })
  await new Promise(r => server.listen(port, '127.0.0.1', r))
  const file = serviceFile(instance)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify({ port: server.address().port, token, pid: process.pid, started: new Date().toISOString() }), { mode: 0o600 })
  return { server, port: server.address().port, close: () => new Promise(r => server.close(r)) }
}

/** Session side (MCP tools): talk to the running Call service. */
export async function callService(instance, method, path, body, { fetchImpl = fetch } = {}) {
  let svc
  try { svc = JSON.parse(readFileSync(serviceFile(instance), 'utf8')) } catch {
    throw new CallError('the Call service is not running — the owner installs it once (node bin/crelio.mjs calls install) and restarts CrelioBot')
  }
  let res
  try {
    res = await fetchImpl(`http://127.0.0.1:${svc.port}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-crelio-token': svc.token }, body: body ? JSON.stringify(body) : undefined })
  } catch {
    throw new CallError('the Call service is not responding — is the "CrelioBot - Calls" window running?')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new CallError(data.error ?? `Call service error (HTTP ${res.status})`)
  return data
}
