// The team's tools, served to each session by the Crelio MCP server (mcp/server.mjs).
// Every tool acts only inside its session's scope: a KB session's category (KB General, Agent
// channels and their threads); the Router's Global General.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { agentName, loadInstance, ROUTER, updateKbProfile, updateSettings, CORE_AGENTS } from './instance.mjs'
import { isSessionProcess, killSessionProcess } from './launcher.mjs'
import { provisioner } from './provision.mjs'
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

  // ---------------------------------------------------------------- tools
  async function post({ agent, chat_id, text, files, reply_to, silent }) {
    need(agent, 'agent')
    const t = await target(chat_id)
    const client = botClient(agent)
    const attachments = readFiles(files)
    const chunks = splitMessage(text ?? '')
    if (!chunks.length && !attachments.length) throw new ToolError('text or files is required')
    if (!chunks.length) chunks.push('')
    const flags = FLAGS.SUPPRESS_EMBEDS | (silent ? FLAGS.SUPPRESS_NOTIFICATIONS : 0)
    const ids = []
    for (const [i, content] of chunks.entries()) {
      const body = { content, flags, allowed_mentions: { parse: ['users', 'roles'], replied_user: true } }
      if (i === 0 && reply_to) body.message_reference = { message_id: snowflake(reply_to, 'reply_to'), fail_if_not_exists: false }
      const last = i === chunks.length - 1
      let msg
      if (last && attachments.length) {
        const form = new FormData()
        form.append('payload_json', JSON.stringify({ ...body, attachments: attachments.map((f, n) => ({ id: n, filename: f.name })) }))
        attachments.forEach((f, n) => form.append(`files[${n}]`, new Blob([f.data]), f.name))
        msg = await client.postForm(`/channels/${t.id}/messages`, form)
      } else {
        msg = await client.post(`/channels/${t.id}/messages`, body)
      }
      ids.push(msg.id)
    }
    return { chat_id: t.id, message_ids: ids }
  }

  async function edit({ agent, chat_id, message_id, text }) {
    const t = await target(chat_id)
    const [content, ...overflow] = splitMessage(need(text, 'text'))
    if (overflow.length) throw new ToolError('edited text must fit in one message (2000 characters)')
    await botClient(need(agent, 'agent')).patch(`/channels/${t.id}/messages/${snowflake(message_id, 'message_id')}`, { content, flags: FLAGS.SUPPRESS_EMBEDS, allowed_mentions: { parse: ['users', 'roles'] } })
    return { edited: true }
  }

  async function react({ agent, chat_id, message_id, emoji }) {
    const t = await target(chat_id)
    await botClient(need(agent, 'agent')).put(`/channels/${t.id}/messages/${snowflake(message_id, 'message_id')}/reactions/${encodeURIComponent(need(emoji, 'emoji'))}/@me`)
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
      rows.push({ thread_id: id, name: th.name, channel: where.role === 'general' ? 'general' : `#${where.agent}`, ...registry.get(id), status: 'open', last_message_id: th.last_message_id })
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
    const language = isRouter ? instance.language : (instance.kb(kbId).language ?? instance.language)
    const text = await voice().transcribe(audio, { filename: att.filename, contentType: att.content_type ?? 'audio/ogg', language })
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

  async function route({ kb, text, author_id, author_name, source_message_id }) {
    routerOnly('route')
    const profile = instance.kb(need(kb, 'kb'))
    const general = profile.discord?.general_id
    if (!general) throw new ToolError(`KB "${profile.id}" has no General channel yet — the owner runs "crelio discord provision"`)
    const who = author_id ? `<@${snowflake(author_id, 'author_id')}>` : (author_name ?? 'someone')
    const source = source_message_id ? ` · [original](${link(instance.globalGeneralId, snowflake(source_message_id, 'source_message_id'))})` : ''
    const quoted = String(need(text, 'text')).split('\n').map(l => `> ${l}`).join('\n')
    const client = clientFor(instance.requireToken(profile.id, 'manager'))
    const ids = []
    for (const content of splitMessage(`📨 **From the Global General** — ${who}${source}\n${quoted}`)) {
      ids.push((await client.post(`/channels/${general}/messages`, { content, flags: FLAGS.SUPPRESS_EMBEDS, allowed_mentions: { parse: [] } })).id)
    }
    return { kb: profile.id, chat_id: general, message_id: ids[0], session_name: `crelio-${profile.id}`, link: link(general, ids[0]) }
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
  function freshKb() {
    return loadInstance(instance.workspaceDir, { repoDir: instance.repoDir }).kb(kbId)
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

  async function provision_agent({ agent, scope = 'kb' }) {
    if (isRouter) throw new ToolError('Agents belong to KB teams')
    const id = String(need(agent, 'agent')).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === 'manager' || id === ROUTER) throw new ToolError('agent must be a lowercase id with letters, digits and dashes (not manager/router)')
    if (!CORE_AGENTS.includes(id)) {
      const add = list => [...new Set([...(list ?? []), id])]
      if (scope === 'workspace') updateSettings(instance.workspaceDir, s => { s.agents = { ...s.agents, custom: add(s.agents?.custom) } })
      else updateKbProfile(instance.workspaceDir, kbId, k => { k.agents = { ...k.agents, custom: add(k.agents?.custom) } })
    }
    const fresh = loadInstance(instance.workspaceDir, { repoDir: instance.repoDir })
    const kb = fresh.kb(kbId)
    const d = kb.discord ?? {}
    if (!d.category_id) throw new ToolError('this KB has no Discord category yet — the owner runs "crelio discord provision"')
    const r = await provisioner({ client: manager(), guildId: instance.guildId }).agentChannelAndRole({
      kbName: kb.name ?? kb.id, categoryId: d.category_id, agent: id, channelId: d.agents?.[id], roleId: d.roles?.[id],
    })
    updateKbProfile(instance.workspaceDir, kbId, k => {
      k.discord = { ...k.discord, agents: { ...k.discord?.agents, [id]: r.channel_id }, roles: { ...k.discord?.roles, [id]: r.role_id } }
    })
    const ready = !!fresh.botFor(kbId, id)?.token
    return {
      agent: id,
      channel_id: r.channel_id,
      role_id: r.role_id,
      bot_ready: ready,
      next: ready
        ? 'Call restart_session so the session loads the agent and listens to its channel.'
        : `The agent needs its own bot application: the owner creates it in the Discord Developer Portal and runs "crelio bot add ${id}" on the PC. Then call restart_session.`,
    }
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
        bot_user_id: instance.botFor(kbId, a)?.user_id ?? null,
        role_id: d.roles?.[a] ?? null,
        channel_id: a === 'manager' ? (d.general_id ?? null) : (d.agents?.[a] ?? null),
        mention: d.roles?.[a] ? `<@&${d.roles[a]}>` : instance.botFor(kbId, a)?.user_id ? `<@${instance.botFor(kbId, a).user_id}>` : agentName(a),
      })),
      ...(isRouter ? { kbs: [...instance.kbs.values()].map(k => ({ id: k.id, name: k.name ?? k.id, language: k.language, general_id: k.discord?.general_id, session_name: `crelio-${k.id}` })) } : {}),
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
    route, instance_status,
    _target: target, _botClient: botClient,
  }
}
