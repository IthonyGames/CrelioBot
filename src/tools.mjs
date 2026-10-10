// The team's tools, served to each session by the Crelio MCP server (mcp/server.mjs).
// Every tool acts only inside its session's scope: a KB session's category (KB General, Agent
// channels and their threads); the Router's Global General.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { agentName, loadInstance, ROUTER, updateKbProfile, updateSettings, CORE_AGENTS } from './instance.mjs'
import { isSessionProcess, killSessionProcess } from './launcher.mjs'
import { channelName, provisioner } from './provision.mjs'
import { writeAccess } from './runtime.mjs'
import { PORTAL_STEPS, registerBot, tokenEnvFor } from './bots.mjs'
import { callService, serviceFile } from './calls.mjs'
import { discordClient, FLAGS, MAX_FILE_BYTES, SNOWFLAKE, THREAD_TYPES } from './discord.mjs'
import { openRegistry, THREAD_FIELDS } from './registry.mjs'
import { splitMessage } from './split.mjs'
import { isOggOpus, oggVoiceInfo } from './ogg.mjs'
import { MAX_STT_BYTES, MAX_TTS_CHARS, voiceProvider } from './voice.mjs'

const AUDIO_FILE = /\.(ogg|oga|opus|mp3|wav|m4a|webm|mp4|mpga|mpeg|flac)$/i

export { agentName }
export class ToolError extends Error { name = 'ToolError' }

const MESSAGE_TYPES = new Set([0, 19]) // default and reply; skip system messages
const HISTORY_BUDGET = 60_000
// Beyond this, a chat post is a document: the post result tells the agent so (team protocol §2).
export const LONG_POST = 900

function need(value, name) {
  if (value === undefined || value === null || value === '') throw new ToolError(`${name} is required`)
  return value
}
function snowflake(value, name) {
  if (!SNOWFLAKE.test(String(value ?? ''))) throw new ToolError(`${name} must be a Discord ID`)
  return String(value)
}

export function createTools({
  instance,
  sessionId,
  clientFor = token => discordClient(token),
  registry = openRegistry(instance.stateDir(sessionId)),
  fetchImpl = fetch,
  voice = () => voiceProvider(instance, { fetchImpl }),
}) {
  const isRouter = sessionId === ROUTER
  const kbId = isRouter ? null : sessionId
  const channelCache = new Map()
  // What Claude Code loaded at session start (this runs when the session's MCP server starts).
  const kbAgentsWatched = !!kbId && existsSync(join(instance.kb(kbId).path, '.claude', 'agents'))
  const wsAgentsDir = join(instance.workspaceDir, 'plugin', 'agents')
  const wsAgentsAtStart = new Set(existsSync(join(instance.workspaceDir, 'plugin', '.claude-plugin', 'plugin.json')) && existsSync(wsAgentsDir) ? readdirSync(wsAgentsDir) : [])

  const agents = () => (isRouter ? ['manager'] : instance.agentsFor(kbId))
  function botClient(agent) {
    if (!agents().includes(agent)) throw new ToolError(`unknown agent "${agent}" — this team has: ${agents().join(', ')}`)
    const bot = instance.botFor(kbId, agent)
    if (!bot?.token) throw new ToolError(`the ${agent} agent has no bot token yet — the owner adds it with "crelio bot add ${agent}"`)
    return clientFor(bot.token)
  }
  const manager = () => botClient('manager')

  /** user id → agent id, for naming authors in history and finding who asked a question. */
  function agentByUserId() {
    const map = new Map()
    for (const a of agents()) {
      const id = instance.botFor(kbId, a)?.user_id
      if (id) map.set(id, a)
    }
    return map
  }

  async function channel(id) {
    const hit = channelCache.get(id)
    if (hit && Date.now() - hit.at < 60_000) return hit.data
    const data = await manager().get(`/channels/${id}`)
    channelCache.set(id, { at: Date.now(), data })
    return data
  }

  /** Resolves a channel or thread and refuses anything outside this session's scope. */
  async function target(chatId) {
    const id = snowflake(chatId, 'chat_id')
    const ch = await channel(id)
    const isThread = THREAD_TYPES.has(ch.type)
    const parentId = isThread ? ch.parent_id : id
    const where = instance.locate(parentId)
    if (!where || where.session !== sessionId) {
      throw new ToolError(`chat_id ${id} is outside this ${isRouter ? 'Router' : `KB (${kbId})`} — a session may only act in its own channels and their threads`)
    }
    return { id, isThread, parentId, channel: ch, ...where }
  }

  function readFiles(files) {
    return (files ?? []).map(p => {
      if (!existsSync(p)) throw new ToolError(`file not found: ${p}`)
      const size = statSync(p).size
      if (size > MAX_FILE_BYTES) throw new ToolError(`file too large for Discord (${(size / 1048576).toFixed(1)} MiB > 20 MiB): ${p}`)
      return { name: basename(p), data: readFileSync(p) }
    })
  }

  /** Sends text (split in ≤ 2000-character messages) with the attachments on the last one; returns the message ids. */
  async function send(client, channelId, text, { attachments = [], flags = FLAGS.SUPPRESS_EMBEDS, allowedMentions, replyTo } = {}) {
    const chunks = splitMessage(text ?? '')
    if (!chunks.length && !attachments.length) throw new ToolError('text or files is required')
    if (!chunks.length) chunks.push('')
    const ids = []
    for (const [i, content] of chunks.entries()) {
      const body = { content, flags, allowed_mentions: allowedMentions }
      if (i === 0 && replyTo) body.message_reference = { message_id: replyTo, fail_if_not_exists: false }
      let msg
      if (i === chunks.length - 1 && attachments.length) {
        const form = new FormData()
        form.append('payload_json', JSON.stringify({ ...body, attachments: attachments.map((f, n) => ({ id: n, filename: f.name })) }))
        attachments.forEach((f, n) => form.append(`files[${n}]`, new Blob([f.data]), f.name))
        msg = await client.postForm(`/channels/${channelId}/messages`, form)
      } else {
        msg = await client.post(`/channels/${channelId}/messages`, body)
      }
      ids.push(msg.id)
    }
    return ids
  }

  // ---------------------------------------------------------------- tools
  async function post({ agent, chat_id, text, files, reply_to, silent }) {
    need(agent, 'agent')
    const t = await target(chat_id)
    const client = botClient(agent)
    const ids = await send(client, t.id, text, {
      attachments: readFiles(files),
      flags: FLAGS.SUPPRESS_EMBEDS | (silent ? FLAGS.SUPPRESS_NOTIFICATIONS : 0),
      // A person is notified only when the text mentions them: replying to their message does not ping.
      allowedMentions: { parse: ['users', 'roles'], replied_user: false },
      replyTo: reply_to ? snowflake(reply_to, 'reply_to') : undefined,
    })
    const length = String(text ?? '').length
    return {
      chat_id: t.id,
      message_ids: ids,
      ...(length > LONG_POST ? { note: `${length} characters — too long for a chat post. Write it like a text: a few plain sentences with what the person needs; details go in your brief to the agent that called you, or in an attached file.` } : {}),
    }
  }

  async function edit({ agent = 'manager', chat_id, message_id, text }) {
    const t = await target(chat_id)
    const [content, ...overflow] = splitMessage(need(text, 'text'))
    if (overflow.length) throw new ToolError('edited text must fit in one message (2000 characters)')
    await botClient(agent).patch(`/channels/${t.id}/messages/${snowflake(message_id, 'message_id')}`, { content, flags: FLAGS.SUPPRESS_EMBEDS, allowed_mentions: { parse: ['users', 'roles'] } })
    return { edited: true }
  }

  async function react({ agent = 'manager', chat_id, message_id, emoji }) {
    const t = await target(chat_id)
    await botClient(agent).put(`/channels/${t.id}/messages/${snowflake(message_id, 'message_id')}/reactions/${encodeURIComponent(need(emoji, 'emoji'))}/@me`)
    return { reacted: true }
  }

  async function thread_open({ agent = 'manager', chat_id, name, message_id, kind, task_id, requester, parent }) {
    const t = await target(chat_id)
    if (t.isThread) return { thread_id: t.id, created: false, ...registry.get(t.id) }
    const title = String(need(name, 'name')).replace(/\s+/g, ' ').trim().slice(0, 100)
    const client = botClient(agent)
    let threadId
    let created = true
    if (message_id) {
      try {
        threadId = (await client.post(`/channels/${t.id}/messages/${snowflake(message_id, 'message_id')}/threads`, { name: title, auto_archive_duration: 10080 })).id
      } catch (e) {
        if (e.code !== 160004) throw e // a thread already exists on that message: same ID as the message
        threadId = message_id
        created = false
      }
    } else {
      threadId = (await client.post(`/channels/${t.id}/threads`, { name: title, type: 11, auto_archive_duration: 10080 })).id
    }
    const entry = registry.upsert(threadId, {
      kind: kind ?? (t.role === 'agent' ? 'side' : 'task'),
      name: title,
      agent: t.role === 'agent' ? t.agent : agent,
      status: 'open',
      hops: registry.get(threadId)?.hops ?? 0,
      task_id, requester, parent,
    })
    return { created, ...entry }
  }

  async function thread_close({ chat_id, summary }) {
    const t = await target(chat_id)
    if (!t.isThread) throw new ToolError('chat_id is not a thread')
    if (!t.channel.thread_metadata?.archived) await manager().patch(`/channels/${t.id}`, { archived: true })
    channelCache.delete(t.id)
    return registry.upsert(t.id, { status: 'closed', summary })
  }

  async function thread_list({ include_closed } = {}) {
    const guild = instance.guildId
    const scope = new Set(instance.channelsOf(sessionId))
    const active = (await manager().get(`/guilds/${guild}/threads/active`))?.threads ?? []
    const live = new Map(active.filter(th => scope.has(th.parent_id)).map(th => [th.id, th]))
    const rows = []
    for (const [id, th] of live) {
      const where = instance.locate(th.parent_id)
      const channel = where.role === 'general' ? 'general' : `#${where.role === 'agent' ? where.agent : where.name}`
      rows.push({ thread_id: id, name: th.name, channel, ...registry.get(id), status: 'open', last_message_id: th.last_message_id })
    }
    if (include_closed) {
      for (const r of registry.list()) if (!live.has(r.thread_id)) rows.push({ ...r, status: r.status === 'open' ? 'archived' : r.status })
    }
    return { threads: rows }
  }

  async function thread_history({ chat_id, before, limit }) {
    const t = await target(chat_id)
    const max = Math.min(Math.max(Number(limit) || 200, 1), 2000)
    const names = agentByUserId()
    const who = m => (names.has(m.author?.id) ? `${names.get(m.author.id)} (agent)` : (m.author?.global_name ?? m.author?.username ?? '?'))
    const line = m => {
      const atts = m.attachments?.length ? ` [attachments: ${m.attachments.map(a => a.filename).join(', ')} — message_id ${m.id}]` : ''
      const ref = m.message_reference?.message_id ? ` (reply to ${m.message_reference.message_id})` : ''
      return `- [${m.timestamp?.slice(0, 16).replace('T', ' ')}] ${who(m)} <${m.id}>${ref}: ${String(m.content ?? '').trim() || '(no text)'}${atts}`
    }
    const messages = []
    let cursor = before ? snowflake(before, 'before') : undefined
    while (messages.length < max) {
      const page = await manager().get(`/channels/${t.id}/messages?limit=${Math.min(100, max - messages.length)}${cursor ? `&before=${cursor}` : ''}`)
      messages.push(...page)
      if (page.length < 100) break
      cursor = page.at(-1).id
    }
    const lines = []
    let size = 0
    let oldest
    for (const m of messages) {
      if (!MESSAGE_TYPES.has(m.type)) continue
      const l = line(m)
      if (size + l.length > HISTORY_BUDGET && lines.length) break
      lines.push(l)
      size += l.length
      oldest = m.id
    }
    let request = null
    if (t.isThread) {
      try { request = line(await manager().get(`/channels/${t.parentId}/messages/${t.id}`)) } catch {}
    }
    const complete = lines.length === messages.filter(m => MESSAGE_TYPES.has(m.type)).length && messages.length < max
    return {
      chat_id: t.id,
      name: t.channel.name,
      archived: !!t.channel.thread_metadata?.archived,
      record: t.isThread ? registry.get(t.id) : null,
      request,
      messages: lines.reverse(),
      ...(complete ? {} : { older_before: oldest, note: 'Older messages not included: call again with before = older_before.' }),
    }
  }

  async function thread_meta({ chat_id, patch }) {
    const t = await target(chat_id)
    if (!t.isThread) throw new ToolError('chat_id is not a thread')
    if (!patch) return registry.get(t.id) ?? { thread_id: t.id, note: 'no record yet' }
    const unknown = Object.keys(patch).filter(k => !THREAD_FIELDS.includes(k))
    if (unknown.length) throw new ToolError(`unknown fields: ${unknown.join(', ')} — allowed: ${THREAD_FIELDS.join(', ')}`)
    return registry.upsert(t.id, patch)
  }

  async function whereami({ chat_id, message_id }) {
    const t = await target(chat_id)
    const out = {
      session: sessionId,
      kb: kbId,
      role: t.role,
      channel_agent: t.agent,
      is_thread: t.isThread,
      parent_channel_id: t.parentId,
      thread: t.isThread ? (registry.get(t.id) ?? { note: 'no record yet' }) : null,
    }
    if (message_id) {
      const msg = await manager().get(`/channels/${t.id}/messages/${snowflake(message_id, 'message_id')}`)
      out.author = { user_id: msg.author?.id, name: msg.author?.global_name ?? msg.author?.username, agent: agentByUserId().get(msg.author?.id) ?? null }
      const refId = msg.message_reference?.message_id
      if (refId) {
        try {
          const ref = await manager().get(`/channels/${msg.message_reference.channel_id ?? t.id}/messages/${refId}`)
          out.replied_to = { message_id: refId, agent: agentByUserId().get(ref.author?.id) ?? null, user_id: ref.author?.id, excerpt: String(ref.content ?? '').slice(0, 300) }
        } catch {}
      }
    }
    return out
  }

  async function transcribe({ chat_id, message_id }) {
    const t = await target(chat_id)
    const msg = await manager().get(`/channels/${t.id}/messages/${snowflake(message_id, 'message_id')}`)
    const isVoice = ((msg.flags ?? 0) & FLAGS.IS_VOICE_MESSAGE) !== 0
    const att = (msg.attachments ?? []).find(a => isVoice || /^audio\//.test(a.content_type ?? '') || AUDIO_FILE.test(a.filename ?? ''))
    if (!att) throw new ToolError('that message has no audio attachment')
    if (att.size > MAX_STT_BYTES) throw new ToolError(`audio too large to transcribe (${(att.size / 1048576).toFixed(1)} MiB > 25 MiB)`)
    const file = await fetchImpl(att.url)
    if (!file.ok) throw new ToolError(`could not download the audio (HTTP ${file.status})`)
    const audio = Buffer.from(await file.arrayBuffer())
    // Discord's waveform (0-255 per point) tells a near-silent recording apart from a provider failure.
    const wave = att.waveform ? Buffer.from(att.waveform, 'base64') : null
    const quiet = wave?.length ? wave.reduce((s, x) => s + x, 0) / wave.length < 35 : false
    let text
    try {
      const names = [...instance.kbs.values()].map(k => k.name ?? k.id).concat('CrelioBot', ...agents().map(agentName))
      text = await voice().transcribe(audio, { filename: att.filename, contentType: att.content_type ?? 'audio/ogg', prompt: [...new Set(names)].join(', ') })
    } catch (e) {
      if (quiet && /empty/.test(e.message)) throw new ToolError('the recording is almost silent — no speech detected; ask the person to record again (microphone muted or too far?)')
      throw e
    }
    return { text, voice_message: isVoice, duration_secs: att.duration_secs ?? null, author: msg.author?.global_name ?? msg.author?.username }
  }

  async function speak({ agent, chat_id, text }) {
    const t = await target(chat_id)
    const client = botClient(need(agent, 'agent'))
    const input = String(need(text, 'text')).trim()
    if (input.length > MAX_TTS_CHARS) throw new ToolError(`text too long to speak (${input.length} > ${MAX_TTS_CHARS} characters) — speak a short summary and post the full text`)
    const audio = await voice().speak(input)
    const form = new FormData()
    if (isOggOpus(audio)) {
      const info = oggVoiceInfo(audio)
      form.append('payload_json', JSON.stringify({ flags: FLAGS.IS_VOICE_MESSAGE, attachments: [{ id: 0, filename: 'voice-message.ogg', duration_secs: info.duration_secs, waveform: info.waveform }] }))
      form.append('files[0]', new Blob([audio], { type: 'audio/ogg' }), 'voice-message.ogg')
      const msg = await client.postForm(`/channels/${t.id}/messages`, form)
      return { message_id: msg.id, voice_message: true, duration_secs: info.duration_secs }
    }
    // Provider didn't return Ogg Opus: send a plain audio attachment instead of a voice bubble.
    form.append('payload_json', JSON.stringify({ flags: FLAGS.SUPPRESS_EMBEDS, attachments: [{ id: 0, filename: 'voice-reply.mp3' }] }))
    form.append('files[0]', new Blob([audio], { type: 'audio/mpeg' }), 'voice-reply.mp3')
    const msg = await client.postForm(`/channels/${t.id}/messages`, form)
    return { message_id: msg.id, voice_message: false }
  }

  // ------------------------------------------------------------ Router
  function routerOnly(name) {
    if (!isRouter) throw new ToolError(`${name} is a Router tool`)
  }
  const link = (channelId, messageId) => `https://discord.com/channels/${instance.guildId}/${channelId}${messageId ? `/${messageId}` : ''}`

  /**
   * One notification per routed request: the copy in the KB General is silent and names the author without
   * mentioning them, nothing is posted or added in the Global General, and the KB's Task thread is where the
   * author is pinged. The request's attachments travel with it (the KB session can't read the Global General).
   */
  async function route({ kb, text, author_id, author_name, source_message_id }) {
    routerOnly('route')
    const profile = instance.kb(need(kb, 'kb'))
    const general = profile.discord?.general_id
    if (!general) throw new ToolError(`KB "${profile.id}" has no General channel yet — the owner runs "crelio discord provision"`)
    if (author_id) snowflake(author_id, 'author_id')
    const sourceId = source_message_id ? snowflake(source_message_id, 'source_message_id') : null
    let source = null
    if (sourceId) {
      try { source = await manager().get(`/channels/${instance.globalGeneralId}/messages/${sourceId}`) } catch {}
    }
    const attachments = []
    const skipped = []
    for (const a of source?.attachments ?? []) {
      if (a.size > MAX_FILE_BYTES) { skipped.push(a.filename); continue }
      const res = await fetchImpl(a.url).catch(() => null)
      if (res?.ok) attachments.push({ name: a.filename, data: Buffer.from(await res.arrayBuffer()) })
      else skipped.push(a.filename)
    }
    const who = author_name ?? source?.author?.global_name ?? source?.author?.username ?? 'someone'
    const origin = sourceId ? ` · [Global General](${link(instance.globalGeneralId, sourceId)})` : ''
    const quoted = String(need(text, 'text')).split('\n').map(l => `> ${l}`).join('\n')
    const client = clientFor(instance.requireToken(profile.id, 'manager'))
    const ids = await send(client, general, `📨 **${who}**${origin}\n${quoted}`, {
      attachments,
      flags: FLAGS.SUPPRESS_EMBEDS | FLAGS.SUPPRESS_NOTIFICATIONS,
      allowedMentions: { parse: [] },
    })
    return {
      kb: profile.id,
      chat_id: general,
      message_id: ids[0],
      session_name: `crelio-${profile.id}`,
      link: link(general, ids[0]),
      attachments: attachments.map(f => f.name),
      ...(skipped.length ? { attachments_not_copied: skipped } : {}),
      note: 'post nothing in the Global General: the Task thread in the KB pings the author',
    }
  }

  async function instance_status() {
    routerOnly('instance_status')
    const active = (await manager().get(`/guilds/${instance.guildId}/threads/active`))?.threads ?? []
    return {
      kbs: [...instance.kbs.values()].map(k => {
        const scope = new Set(instance.channelsOf(k.id))
        const reg = openRegistry(instance.stateDir(k.id))
        const pidFile = join(instance.stateDir(k.id), 'claude.pid')
        const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null
        const threads = active.filter(t => scope.has(t.parent_id)).map(t => {
          const r = reg.get(t.id) ?? {}
          return { name: t.name, thread_id: t.id, link: link(t.id), kind: r.kind, task_id: r.task_id, requester: r.requester, hops: r.hops, waiting_on: r.waiting_on, agent: r.agent }
        })
        return { id: k.id, name: k.name ?? k.id, session: `crelio-${k.id}`, running: !!pid && isSessionProcess(pid), open_threads: threads.length, threads }
      }),
    }
  }

  async function restart_session({ kb } = {}) {
    if (!isRouter && kb && kb !== sessionId) throw new ToolError('a KB session can only restart itself')
    const id = isRouter ? (kb ?? ROUTER) : sessionId
    if (id !== ROUTER) instance.kb(id)
    const pidFile = join(instance.stateDir(id), 'claude.pid')
    if (!existsSync(pidFile)) throw new ToolError(`session "${id}" is not running under the CrelioBot launcher`)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    if (!isSessionProcess(pid)) throw new ToolError(`session "${id}" is not running`)
    // Answer first: when a session restarts itself, this very server is one of the processes ended.
    setTimeout(() => killSessionProcess(pid), 1500)
    return { restarting: id, note: 'The launcher starts it again within seconds; open threads come back in its context.' }
  }

  // ------------------------------------------------------------ KB administration
  /** The Workspace as it is now on disk — after this process (or another session) changed it. */
  function fresh() {
    return instance.reload?.() ?? loadInstance(instance.workspaceDir, { repoDir: instance.repoDir })
  }
  function freshKb() {
    return fresh().kb(kbId)
  }

  async function schedules({ action = 'list', id, cron, prompt }) {
    if (isRouter) throw new ToolError('Schedules belong to KB sessions')
    if (action === 'list') return { schedules: freshKb().schedules ?? [] }
    const sid = String(need(id, 'id')).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(sid)) throw new ToolError('id must be lowercase letters, digits and dashes')
    if (action === 'add') {
      if (!/^\s*(\S+\s+){4}\S+\s*$/.test(String(need(cron, 'cron')))) throw new ToolError('cron must have 5 fields: minute hour day-of-month month day-of-week (local time)')
      const entry = { id: sid, cron: cron.trim(), prompt: String(need(prompt, 'prompt')).trim() }
      updateKbProfile(instance.workspaceDir, kbId, k => { k.schedules = [...(k.schedules ?? []).filter(s => s.id !== sid), entry] })
      return { saved: entry, next: 'Arm it now with CronCreate (recurring, same cron and prompt); it is re-armed at every session start.' }
    }
    if (action === 'remove') {
      let found = false
      updateKbProfile(instance.workspaceDir, kbId, k => { found = (k.schedules ?? []).some(s => s.id === sid); k.schedules = (k.schedules ?? []).filter(s => s.id !== sid) })
      if (!found) throw new ToolError(`no Schedule "${sid}"`)
      return { removed: sid, next: 'Also remove the armed job with CronDelete (CronList shows it).' }
    }
    throw new ToolError('action must be list, add or remove')
  }

  /**
   * Agent creator: write a Custom agent's definition, register it, and create its channel and role.
   * A KB session creates agents for its own KB (definition in <KB>/.claude/agents/); the Router creates
   * agents for every KB (definition in <Workspace>/plugin/agents/, channel + role in every category).
   * The tool writes the definition itself: .claude/ edits are protected in guarded sessions.
   */
  async function provision_agent({ agent, definition, approval_chat_id, approval_message_id }) {
    const id = String(need(agent, 'agent')).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === 'manager' || id === ROUTER) throw new ToolError('agent must be a lowercase id with letters, digits and dashes (not manager/router)')
    const isCore = CORE_AGENTS.includes(id)
    if (isCore && definition !== undefined) throw new ToolError(`"${id}" is a Core agent — pick another id for a Custom agent (a Core agent is turned on with agent_enable)`)
    const by = await approved({ approval_chat_id, approval_message_id }, 'provision_agent')

    if (definition !== undefined) {
      const text = String(definition)
      const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!front || !new RegExp(`^name:\\s*${id}\\s*$`, 'm').test(front[1]) || !/^description:\s*\S/m.test(front[1])) {
        throw new ToolError(`definition must start with a frontmatter block containing "name: ${id}" and a description`)
      }
      const file = isRouter
        ? join(instance.workspaceDir, 'plugin', 'agents', `${id}.md`)
        : join(instance.kb(kbId).path, '.claude', 'agents', `${id}.md`)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text.endsWith('\n') ? text : text + '\n')
      if (isRouter) {
        const manifest = join(instance.workspaceDir, 'plugin', '.claude-plugin', 'plugin.json')
        if (!existsSync(manifest)) {
          mkdirSync(dirname(manifest), { recursive: true })
          writeFileSync(manifest, JSON.stringify({ name: 'crelio-workspace', version: '0.1.0', description: 'Custom agents shared by every CrelioBot team' }, null, 2) + '\n')
        }
      }
    }
    if (!isCore) {
      const add = list => [...new Set([...(list ?? []), id])]
      if (isRouter) updateSettings(instance.workspaceDir, s => { s.agents = { ...s.agents, custom: add(s.agents?.custom) } })
      else updateKbProfile(instance.workspaceDir, kbId, k => { k.agents = { ...k.agents, custom: add(k.agents?.custom) } })
    }
    // A team that lists its agents gets the new one enabled (from the Router: every team).
    for (const kb of fresh().kbs.values()) {
      if (!isCore && (isRouter || kb.id === kbId) && Array.isArray(kb.agents?.enabled)) {
        updateKbProfile(instance.workspaceDir, kb.id, k => { k.agents.enabled = [...new Set([...k.agents.enabled, id])] })
      }
    }

    const channels = {}
    for (const kb of isRouter ? [...fresh().kbs.values()] : [fresh().kb(kbId)]) {
      const r = await agentChannel(kb.id, id)
      channels[kb.id] = r.error ?? { channel_id: r.channel_id, role_id: r.role_id }
      if (!r.error) writeAccess(fresh(), kb.id)
    }
    const bot = botStatus(kbId, id)
    return {
      agent: id,
      ...(isRouter ? { channels } : channels[kbId]),
      bot_ready: bot.ready,
      ...subagentType(kbId, id),
      approved_by: by,
      next: bot.ready
        ? 'Ready now — no restart needed. Dispatch it once to introduce itself in its channel.'
        : bot.next,
    }
  }

  // ------------------------------------------------------------ Team administration
  // Every change needs the owner's approval: a message from the owner (or a listed admin) in this
  // session's channels, at most a day old — usually the request itself ("enable the Artist"), or the
  // owner's answer to a yes/no question. The tool checks it, so no agent administers on its own.
  const APPROVAL_MAX_AGE_MS = 24 * 3600_000

  async function approved({ approval_chat_id, approval_message_id }, action) {
    if (!approval_chat_id || !approval_message_id) {
      throw new ToolError(`${action} needs the owner's approval: pass approval_chat_id and approval_message_id — the owner's message asking for it or agreeing to it`)
    }
    if (!instance.owners.length) throw new ToolError('no owner is recorded for this Instance (crelio.json → server.owner_id) — the owner sets it with "crelio discord use"')
    if (approval_chat_id === 'call') return approvedInCall(approval_message_id)
    const t = await target(approval_chat_id)
    const msg = await manager().get(`/channels/${t.id}/messages/${snowflake(approval_message_id, 'approval_message_id')}`)
    if (!instance.owners.includes(msg.author?.id)) throw new ToolError(`message ${msg.id} is not from the owner — only the owner${instance.settings.admins?.length ? ' or an admin' : ''} can approve team changes; ask them`)
    if (Date.now() - Date.parse(msg.timestamp) > APPROVAL_MAX_AGE_MS) throw new ToolError('that approval is more than a day old — ask the owner again')
    return msg.author.id
  }

  /** In a Call, the owner approves out loud: approval_message_id is the utterance id from the call event. */
  function approvedInCall(utteranceId) {
    if (isRouter) throw new ToolError('approvals from a Call exist only in a KB session')
    const file = join(instance.stateDir(kbId), 'call', 'utterances.jsonl')
    const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : []
    const u = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).find(x => x?.id === utteranceId)
    if (!u) throw new ToolError(`no utterance "${utteranceId}" in this KB's Calls — pass the utterance id from the call event`)
    if (!instance.owners.includes(u.user_id)) throw new ToolError(`utterance ${utteranceId} was said by ${u.name}, not the owner — only the owner can approve team changes`)
    if (Date.now() - Date.parse(u.ts) > APPROVAL_MAX_AGE_MS) throw new ToolError('that approval is more than a day old — ask the owner again')
    return u.user_id
  }

  /** The KB an administration tool acts on: a KB session's own team; the Router names it. */
  function adminKb(kb) {
    if (isRouter) return instance.kb(need(kb, 'kb')).id
    if (kb && kb !== kbId) throw new ToolError(`a KB session administers only its own team (${kbId}) — ask the Router in the Global General for another KB`)
    return kbId
  }
  const kbManager = id => clientFor(instance.requireToken(id, 'manager'))
  const agentId = agent => {
    const id = String(need(agent, 'agent')).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === ROUTER) throw new ToolError('agent must be a lowercase id with letters, digits and dashes')
    return id
  }
  /** Enabled Specialists of a KB as an explicit list (migrates an older "disabled" profile). */
  const enabledList = (inst, id) => inst.agentsFor(id).filter(a => a !== 'manager')

  /** Creates (or finds) an agent's channel and role in a KB category and records them. */
  async function agentChannel(id, agent) {
    const kb = fresh().kb(id)
    const d = kb.discord ?? {}
    if (!d.category_id) return { error: 'no Discord category yet — the owner runs "crelio discord provision"' }
    const p = provisioner({ client: kbManager(id), guildId: instance.guildId })
    const r = await p.agentChannelAndRole({ kbName: kb.name ?? kb.id, categoryId: d.category_id, agent, channelId: d.agents?.[agent], roleId: d.roles?.[agent] })
    updateKbProfile(instance.workspaceDir, id, k => {
      k.discord = { ...k.discord, agents: { ...k.discord?.agents, [agent]: r.channel_id }, roles: { ...k.discord?.roles, [agent]: r.role_id } }
    })
    return r
  }

  /** Whether an agent can post, and what the owner does next when it can't. */
  function botStatus(id, agent) {
    const inst = fresh()
    const bot = inst.botFor(id, agent)
    const tokenEnv = bot?.token_env ?? tokenEnvFor(agent)
    if (bot?.token && bot.user_id) return { ready: true }
    if (inst.secret(tokenEnv)) return { ready: false, next: `Its token is in workspace/.env: call bot_register(agent: "${agent}") to activate it.` }
    return {
      ready: false,
      next: `It needs its own Discord bot. Give the owner these steps (Developer Portal):${PORTAL_STEPS(agent)}\nThe token goes into workspace/.env on the PC (${tokenEnv}=…), never into Discord. When the owner says it is done, call bot_register(agent: "${agent}").`,
    }
  }

  async function agent_enable({ agent, kb, approval_chat_id, approval_message_id }) {
    const id = adminKb(kb)
    const a = agentId(agent)
    if (a === 'manager') throw new ToolError('the Manager is always on')
    const inst = fresh()
    if (!inst.availableAgents(id).includes(a)) {
      throw new ToolError(`"${a}" is not an agent of this Instance — available: ${inst.availableAgents(id).join(', ')}. A new kind of agent is made with the agent-creator skill (provision_agent).`)
    }
    const by = await approved({ approval_chat_id, approval_message_id }, 'agent_enable')
    const was = inst.agentsFor(id).includes(a)
    updateKbProfile(instance.workspaceDir, id, k => {
      k.agents = { ...k.agents, enabled: [...new Set([...enabledList(inst, id), a])] }
      delete k.agents.disabled
    })
    const r = await agentChannel(id, a)
    if (r.error) throw new ToolError(r.error)
    writeAccess(fresh(), id)
    channelCache.clear()
    const bot = botStatus(id, a)
    return {
      kb: id, agent: a, enabled: true, already_enabled: was, channel_id: r.channel_id, role_id: r.role_id, approved_by: by,
      bot_ready: bot.ready,
      next: bot.ready ? 'Active now — no restart. The session already hears its channel.' : bot.next,
    }
  }

  async function agent_disable({ agent, kb, remove_channel = true, approval_chat_id, approval_message_id }) {
    const id = adminKb(kb)
    const a = agentId(agent)
    if (a === 'manager') throw new ToolError('the Manager cannot be disabled')
    const inst = fresh()
    if (!inst.agentsFor(id).includes(a)) return { kb: id, agent: a, enabled: false, note: 'already off' }
    const by = await approved({ approval_chat_id, approval_message_id }, 'agent_disable')
    updateKbProfile(instance.workspaceDir, id, k => {
      k.agents = { ...k.agents, enabled: enabledList(inst, id).filter(x => x !== a) }
      delete k.agents.disabled
    })
    const removed = {}
    if (remove_channel) {
      const d = inst.kb(id).discord ?? {}
      const client = kbManager(id)
      const reason = { reason: `CrelioBot: ${agentName(a)} disabled in ${inst.kb(id).name ?? id}` }
      const gone = e => e.status === 404 || e.code === 10003 || e.code === 10011
      if (d.agents?.[a]) { await client.delete(`/channels/${d.agents[a]}`, reason).catch(e => { if (!gone(e)) throw e }); removed.channel_id = d.agents[a] }
      if (d.roles?.[a]) { await client.delete(`/guilds/${instance.guildId}/roles/${d.roles[a]}`, reason).catch(e => { if (!gone(e)) throw e }); removed.role_id = d.roles[a] }
      updateKbProfile(instance.workspaceDir, id, k => {
        if (k.discord?.agents) delete k.discord.agents[a]
        if (k.discord?.roles) delete k.discord.roles[a]
      })
    }
    writeAccess(fresh(), id)
    channelCache.clear()
    return { kb: id, agent: a, enabled: false, removed, kept: 'its bot (other teams may use it) — agent_enable brings it back', approved_by: by }
  }

  async function discord_admin({ action, kb, name, id: objectId, voice, approval_chat_id, approval_message_id }) {
    const k = adminKb(kb)
    const inst = fresh()
    const profile = inst.kb(k)
    const d = profile.discord ?? {}
    if (!d.category_id) throw new ToolError('this KB has no Discord category yet — the owner runs "crelio discord provision"')
    const client = kbManager(k)
    const reason = { reason: `CrelioBot (${profile.name ?? k})` }
    const p = provisioner({ client, guildId: instance.guildId })
    const approval = () => approved({ approval_chat_id, approval_message_id }, `discord_admin ${action}`)

    if (action === 'create_channel') {
      const chName = channelName(need(name, 'name'))
      const by = await approval()
      const ch = await p.ensureChannel({ name: chName, type: voice ? 2 : 0, parent_id: d.category_id })
      if (ch.id === d.general_id || Object.values(d.agents ?? {}).includes(ch.id)) throw new ToolError(`#${chName} already exists as this team's ${ch.id === d.general_id ? 'General' : 'Agent channel'} — pick another name`)
      updateKbProfile(instance.workspaceDir, k, x => { x.discord = { ...x.discord, channels: { ...x.discord?.channels, [chName]: ch.id } } })
      writeAccess(fresh(), k)
      return { kb: k, created: ch.created, channel_id: ch.id, name: chName, voice: !!voice, approved_by: by, note: 'The Manager serves it (it hears messages there now).' }
    }
    if (action === 'delete_channel') {
      const cid = snowflake(objectId, 'id')
      if (cid === d.general_id) throw new ToolError('the KB General cannot be deleted')
      const agentOf = Object.entries(d.agents ?? {}).find(([, c]) => c === cid)?.[0]
      if (agentOf) throw new ToolError(`that is the ${agentName(agentOf)}'s channel — use agent_disable(agent: "${agentOf}")`)
      const ch = await client.get(`/channels/${cid}`)
      if (ch.parent_id !== d.category_id) throw new ToolError(`channel ${cid} is not in this KB's category — a team only deletes its own channels`)
      const by = await approval()
      await client.delete(`/channels/${cid}`, reason)
      updateKbProfile(instance.workspaceDir, k, x => {
        for (const [n, c] of Object.entries(x.discord?.channels ?? {})) if (c === cid) delete x.discord.channels[n]
      })
      writeAccess(fresh(), k)
      channelCache.delete(cid)
      return { kb: k, deleted_channel: cid, name: ch.name, approved_by: by }
    }
    if (action === 'create_role') {
      const roleName = String(need(name, 'name')).trim().slice(0, 100)
      const by = await approval()
      const role = await p.ensureRole({ name: roleName })
      updateKbProfile(instance.workspaceDir, k, x => { x.discord = { ...x.discord, extra_roles: { ...x.discord?.extra_roles, [roleName]: role.id } } })
      return { kb: k, created: role.created, role_id: role.id, name: roleName, approved_by: by }
    }
    if (action === 'delete_role') {
      const rid = snowflake(objectId, 'id')
      const agentOf = Object.entries(d.roles ?? {}).find(([, r]) => r === rid)?.[0]
      if (agentOf) throw new ToolError(agentOf === 'manager' ? 'the Manager\'s role stays' : `that is the ${agentName(agentOf)}'s role — use agent_disable(agent: "${agentOf}")`)
      const own = Object.entries(d.extra_roles ?? {}).find(([, r]) => r === rid)
      if (!own) throw new ToolError('a team only deletes roles it created (discord_admin create_role) — other server roles are the owner\'s to manage')
      const by = await approval()
      await client.delete(`/guilds/${instance.guildId}/roles/${rid}`, reason).catch(e => { if (e.status !== 404) throw e })
      updateKbProfile(instance.workspaceDir, k, x => { delete x.discord.extra_roles[own[0]] })
      return { kb: k, deleted_role: rid, name: own[0], approved_by: by }
    }
    throw new ToolError('action must be create_channel, delete_channel, create_role or delete_role')
  }

  async function bot_register({ agent, approval_chat_id, approval_message_id }) {
    const a = agentId(agent)
    if (!isRouter && a !== 'manager' && !instance.availableAgents(kbId).includes(a)) throw new ToolError(`"${a}" is not an agent of this team`)
    const inst = fresh()
    const tokenEnv = inst.settings.bots?.[a]?.token_env ?? tokenEnvFor(a)
    const token = inst.secret(tokenEnv)
    if (!token) return { agent: a, registered: false, next: botStatus(kbId, a).next }
    const by = await approved({ approval_chat_id, approval_message_id }, 'bot_register')
    let r
    try {
      r = await registerBot({ instance: inst, agent: a, token, clientFor })
    } catch (e) {
      if (e.status === 401) throw new ToolError(`Discord refused the ${tokenEnv} token in workspace/.env — the owner resets it in the Developer Portal (Bot → Reset Token) and replaces it in the file`)
      throw e
    }
    return {
      agent: a, registered: true, bot: r.username, activated: r.activated, in_server: r.in_server, approved_by: by,
      ...(r.invite_url ? { invite_url: r.invite_url, next: 'Give the owner the invite_url to add it to the server (Authorize), then remind them to lock the app down: Installation → Install Link: None, then Bot → Public Bot OFF.' } : { next: 'Ready now — no restart needed.' }),
      ...(r.warnings.length ? { warnings: r.warnings } : {}),
    }
  }

  // ------------------------------------------------------------ Calls (the KB's voice channel)
  const callTool = name => { if (isRouter) throw new ToolError(`${name} is for KB sessions — Calls happen in a KB's voice channel`) }
  const viaService = (...args) => callService(instance, ...args).catch(e => { throw e.name === 'CallError' ? new ToolError(e.message) : e })

  async function call_say({ text }) {
    callTool('call_say')
    return viaService('POST', '/say', { kb: kbId, text: String(need(text, 'text')) })
  }

  async function call_end({ now } = {}) {
    callTool('call_end')
    return viaService('POST', '/end', { kb: kbId, now: !!now })
  }

  async function call_status() {
    callTool('call_status')
    return viaService('GET', `/status?kb=${encodeURIComponent(kbId)}`)
  }

  function callServiceRunning() {
    try { return isSessionProcess(JSON.parse(readFileSync(serviceFile(instance), 'utf8')).pid) } catch { return false }
  }

  /** Turns Calls on for a team: a voice channel in its category the bot joins when someone does. */
  async function call_setup({ enabled = true, kb, remove_channel = false, approval_chat_id, approval_message_id }) {
    const k = adminKb(kb)
    const inst = fresh()
    const profile = inst.kb(k)
    const d = profile.discord ?? {}
    if (!d.category_id) throw new ToolError('this KB has no Discord category yet — the owner runs "crelio discord provision"')
    const by = await approved({ approval_chat_id, approval_message_id }, 'call_setup')
    if (enabled) {
      const name = (profile.language ?? inst.language) === 'fr' ? 'Appel' : 'Call'
      const ch = await provisioner({ client: kbManager(k), guildId: instance.guildId }).ensureChannel({ id: d.call_id, name, type: 2, parent_id: d.category_id })
      updateKbProfile(instance.workspaceDir, k, x => {
        x.discord = { ...x.discord, call_id: ch.id }
        x.call = { ...x.call, enabled: true }
      })
      writeAccess(fresh(), k)
      const installed = existsSync(join(instance.repoDir, 'calls', 'node_modules', '@discordjs', 'voice'))
      const hasKey = !!inst.secret(inst.settings.voice?.api_key_env ?? 'OPENAI_API_KEY')
      return {
        kb: k, calls: 'on', channel_id: ch.id, name, approved_by: by,
        next: !hasKey ? 'Calls need an OpenAI key for speech: OPENAI_API_KEY in workspace/.env on the PC.'
          : !installed ? 'One step left for the owner, on the PC: "node bin/crelio.mjs calls install" in the CrelioBot folder, then restart CrelioBot (stop-crelio.bat, start-crelio.bat).'
          : callServiceRunning() ? `Ready: join <#${ch.id}> and talk — the bot joins within seconds.`
          : 'The Call service is installed but not running: restart CrelioBot (stop-crelio.bat, start-crelio.bat) so its window opens.',
      }
    }
    updateKbProfile(instance.workspaceDir, k, x => {
      x.call = { ...x.call, enabled: false }
      if (remove_channel && x.discord) delete x.discord.call_id
    })
    if (remove_channel && d.call_id) await kbManager(k).delete(`/channels/${d.call_id}`).catch(e => { if (e.status !== 404) throw e })
    writeAccess(fresh(), k)
    return { kb: k, calls: 'off', removed_channel: remove_channel ? (d.call_id ?? null) : null, approved_by: by }
  }

  /**
   * How to dispatch an agent. Claude Code loads agent definitions when the session starts; afterwards it
   * only picks up new files in a KB's .claude/agents/ when that folder already existed. An agent created
   * later is dispatched as general-purpose with its definition file — no restart needed.
   */
  function subagentType(kb, a) {
    if (CORE_AGENTS.includes(a)) return { subagent_type: `creliobot:${a}` }
    if (kb && (instance.kb(kb).agents?.custom ?? []).includes(a)) {
      return kbAgentsWatched ? { subagent_type: a } : { subagent_type: 'general-purpose', definition: join(instance.kb(kb).path, '.claude', 'agents', `${a}.md`) }
    }
    return wsAgentsAtStart.has(`${a}.md`) ? { subagent_type: `crelio-workspace:${a}` } : { subagent_type: 'general-purpose', definition: join(wsAgentsDir, `${a}.md`) }
  }

  /** Who is on this team and how to reach them — for subagents, which don't see the session context. */
  async function team() {
    const kb = isRouter ? null : instance.kb(kbId)
    const d = kb?.discord ?? {}
    return {
      session: sessionId,
      kb: kb ? { id: kb.id, name: kb.name ?? kb.id, path: kb.path, language: kb.language ?? instance.language, tasks: kb.tasks ?? { adapter: 'none' } } : null,
      language: kb?.language ?? instance.language,
      hop_budget: instance.hopBudget,
      owner_id: instance.settings.server?.owner_id,
      kb_general_id: d.general_id ?? null,
      global_general_id: instance.globalGeneralId ?? null,
      agents: agents().map(a => ({
        id: a,
        name: agentName(a),
        ...subagentType(kbId, a),
        bot_user_id: instance.botFor(kbId, a)?.user_id ?? null,
        role_id: d.roles?.[a] ?? null,
        channel_id: a === 'manager' ? (d.general_id ?? null) : (d.agents?.[a] ?? null),
        mention: d.roles?.[a] ? `<@&${d.roles[a]}>` : instance.botFor(kbId, a)?.user_id ? `<@${instance.botFor(kbId, a).user_id}>` : agentName(a),
      })),
      ...(isRouter
        ? { kbs: [...instance.kbs.values()].map(k => ({ id: k.id, name: k.name ?? k.id, language: k.language, general_id: k.discord?.general_id, session_name: `crelio-${k.id}`, agents: instance.agentsFor(k.id) })) }
        : { available: instance.availableAgents(kbId).filter(a => !agents().includes(a)), channels: d.channels ?? {} }),
    }
  }

  async function team_learning({ text, agents: who }) {
    const lesson = String(need(text, 'text')).replace(/\s+/g, ' ').trim()
    const file = join(instance.workspaceDir, 'learnings', 'team.md')
    mkdirSync(dirname(file), { recursive: true })
    if (!existsSync(file)) appendFileSync(file, '# Team learnings\n\nHow the agents work together — recorded by the agents, read at every session start.\n\n')
    const line = `- ${new Date().toISOString().slice(0, 10)} [${kbId ?? 'router'}]${who?.length ? ` (${who.join(', ')})` : ''} ${lesson}\n`
    appendFileSync(file, line)
    return { recorded: line.trim() }
  }

  return {
    post, edit, react, thread_open, thread_close, thread_list, thread_history, thread_meta, whereami,
    transcribe, speak, team, team_learning, schedules, provision_agent, restart_session,
    agent_enable, agent_disable, discord_admin, bot_register,
    call_say, call_end, call_status, call_setup,
    route, instance_status,
    _target: target, _botClient: botClient,
  }
}
