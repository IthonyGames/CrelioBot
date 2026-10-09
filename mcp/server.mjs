#!/usr/bin/env node
// Crelio MCP server (stdio, JSON-RPC, no dependencies). One per session, started by Claude Code
// from the session's generated MCP config. Tools: see TOOLS below and src/tools.mjs.

import { liveInstance, ROUTER } from '../src/instance.mjs'
import { createTools, ToolError } from '../src/tools.mjs'

const SESSION = process.env.CRELIO_SESSION
const WORKSPACE = process.env.CRELIO_WORKSPACE

const agentProp = { type: 'string', description: 'Agent id that speaks, e.g. "manager", "kb-researcher", "coder" — always yourself' }
const chatProp = { type: 'string', description: 'Discord channel or thread ID (chat_id from the <channel> tag, or a thread_id)' }
const kbProp = { type: 'string', description: 'Router only: the KB id (a KB session administers its own team)' }
const approvalProps = {
  approval_chat_id: { type: 'string', description: 'Where the owner approved: the channel or thread id of their message — or "call" when they said it in a Call' },
  approval_message_id: { type: 'string', description: 'The owner\'s message asking for this change or agreeing to it — or the utterance id from the call event (the tool checks it is theirs and recent)' },
}

const TOOLS = [
  {
    name: 'post',
    description:
      'Post a message in Discord as an agent, through that agent\'s own bot. Use it for everything the team says in Discord — never the discord plugin\'s reply tool. ' +
      'Keep it to a few lines: people read Discord on their phone; details go in your brief to your caller or in an attached file. ' +
      'A person is notified only when the text mentions them (<@user_id>) — replying to their message does not ping; mention them only when they must act or the Task is done. Mention an agent with its role <@&role_id> or bot <@bot_user_id>. ' +
      'Long text is split automatically; link previews are suppressed. files: absolute paths (≤ 20 MiB each) to attach to the last message.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: agentProp,
        chat_id: chatProp,
        text: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        reply_to: { type: 'string', description: 'message_id to reply to (e.g. a person\'s question) — does not ping its author' },
        silent: { type: 'boolean', description: 'true = no push notification, even for mentions (progress notes)' },
      },
      required: ['agent', 'chat_id'],
    },
  },
  {
    name: 'edit',
    description: 'Edit a message an agent posted earlier (progress updates). Edits do not notify anyone — post a new message when work completes. agent defaults to "manager".',
    inputSchema: { type: 'object', properties: { agent: agentProp, chat_id: chatProp, message_id: { type: 'string' }, text: { type: 'string' } }, required: ['chat_id', 'message_id', 'text'] },
  },
  {
    name: 'react',
    description: 'Add an emoji reaction as an agent — the quiet way to say "seen" (👀), "done" (✅) or "ok" (👍) without a message. agent defaults to "manager".',
    inputSchema: { type: 'object', properties: { agent: agentProp, chat_id: chatProp, message_id: { type: 'string' }, emoji: { type: 'string' } }, required: ['chat_id', 'message_id', 'emoji'] },
  },
  {
    name: 'thread_open',
    description:
      'Open a thread. In the KB General: a Task thread (pass the request\'s message_id to open it on that message). In an Agent channel: a Side thread owned by that agent (pass parent = the Task thread id). ' +
      'If chat_id is already a thread, returns it. Returns thread_id: use it as chat_id for everything about this Task.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { ...agentProp, description: 'Agent opening the thread (Manager for Task threads, the channel\'s agent for Side threads)' },
        chat_id: { type: 'string', description: 'Channel to open the thread in (or the message\'s channel)' },
        name: { type: 'string', description: 'Short title, ≤ 100 chars (e.g. "Landing page redesign — Anthony")' },
        message_id: { type: 'string', description: 'Open the thread on this message (the request)' },
        kind: { type: 'string', enum: ['task', 'side'] },
        task_id: { type: 'string', description: 'ID of the ticket in the KB\'s task system, if any' },
        requester: { type: 'string', description: 'Discord user ID of the person who asked' },
        parent: { type: 'string', description: 'For a Side thread: the Task thread it belongs to' },
      },
      required: ['chat_id', 'name'],
    },
  },
  {
    name: 'thread_close',
    description: 'Close (archive) a thread once its final summary is posted and nobody is waiting on an answer. It stays readable and reopens if someone writes in it.',
    inputSchema: { type: 'object', properties: { chat_id: chatProp, summary: { type: 'string', description: 'One-line outcome, kept in the registry' } }, required: ['chat_id'] },
  },
  {
    name: 'thread_list',
    description: 'List this team\'s open threads (Task and Side) with their record: Task id, Requester, owning agent, Hops, who is waiting on whom. Check it before opening a new Task thread.',
    inputSchema: { type: 'object', properties: { include_closed: { type: 'boolean' } } },
  },
  {
    name: 'thread_history',
    description:
      'Read a thread (or channel): the original request and the messages, oldest first, with authors named (agents marked) and message ids. Use it whenever the conversation is not in your context (restart, new subagent, compaction). Long threads: call again with before = older_before.',
    inputSchema: { type: 'object', properties: { chat_id: chatProp, before: { type: 'string' }, limit: { type: 'number' } }, required: ['chat_id'] },
  },
  {
    name: 'thread_meta',
    description: 'Read or update a thread\'s record. patch fields: kind, name, task_id, requester, agent, parent, hops (number), status, waiting_on ({ agent, question_message_id, person }), summary, notes.',
    inputSchema: { type: 'object', properties: { chat_id: chatProp, patch: { type: 'object' } }, required: ['chat_id'] },
  },
  {
    name: 'whereami',
    description:
      'Where a message comes from: KB General / Agent channel (which agent) / Global General, Task or Side thread record, the author (person or agent) and — if it is a reply — which agent\'s message it answers. Call it first for every inbound message whose routing is not obvious.',
    inputSchema: { type: 'object', properties: { chat_id: chatProp, message_id: { type: 'string' } }, required: ['chat_id'] },
  },
  {
    name: 'transcribe',
    description: 'Text of a person\'s Voice note (or any audio attachment) in a message. Treat the text as if they had typed it; don\'t echo it back. A person who spoke gets a short Voice note back (speak) plus the full text.',
    inputSchema: { type: 'object', properties: { chat_id: chatProp, message_id: { type: 'string' } }, required: ['chat_id', 'message_id'] },
  },
  {
    name: 'speak',
    description: 'Send a Voice note (a real Discord voice message) as an agent. Keep it short and spoken — a summary, not a document (≤ 4096 characters); post the full text separately. Use it when the person spoke to you or asked for a voice reply.',
    inputSchema: { type: 'object', properties: { agent: agentProp, chat_id: chatProp, text: { type: 'string' } }, required: ['agent', 'chat_id', 'text'] },
  },
  {
    name: 'team',
    description: 'Your team: KB, language, Hop budget, owner, and every agent with its display name, bot user id, role id, channel and the mention to use. Call it once when you start working (subagents do not see the session context).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'team_learning',
    description: 'Record a Team learning — a lesson about how the agents work together (not about the KB\'s domain: those go into the KB with its own learning method).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, agents: { type: 'array', items: { type: 'string' } } }, required: ['text'] },
  },
  {
    name: 'restart_session',
    description: 'Restart a session through the CrelioBot launcher (it comes back within seconds with its open threads). Team changes do not need it (they apply live); use it when a session is stuck. A KB session restarts itself; the Router may restart any KB session ("kb") or itself.',
    inputSchema: { type: 'object', properties: { kb: { type: 'string', description: 'Router only: the KB id to restart' } } },
  },
  {
    name: 'schedules',
    description: 'List, add or remove this KB\'s Schedules (recurring work). After add, arm it with CronCreate (same cron and prompt, recurring); after remove, CronDelete the armed job. cron: 5 fields, local time (e.g. "0 8 * * 1-5" = weekdays at 8:00).',
    kbOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'remove'] },
        id: { type: 'string', description: 'Short id, e.g. "morning-brief"' },
        cron: { type: 'string' },
        prompt: { type: 'string', description: 'What to do when it fires, as an instruction to the Manager' },
      },
    },
  },
  {
    name: 'provision_agent',
    description: 'Agent creator: write a Custom agent\'s definition (markdown with frontmatter name/description/model/skills), register it, enable it and create its Agent channel and role — live, no restart. From a KB session: for this KB (definition saved in the KB). From the Router: for every KB (definition saved in the Workspace). Needs the owner\'s approval. Returns how to dispatch it and whether its bot is ready (if not: the steps for the owner, then bot_register).',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent id, lowercase-with-dashes' },
        definition: { type: 'string', description: 'Full agent definition file content (omit to only re-create the channel and role)' },
        ...approvalProps,
      },
      required: ['agent', 'approval_chat_id', 'approval_message_id'],
    },
  },
  {
    name: 'agent_enable',
    description: 'Turn an agent on for a team: it joins the roster, gets its Agent channel and role (created if needed), and the session hears that channel at once — no restart. Works for Core agents (Artist, Lawyer, Coder…) and Custom agents. Needs the owner\'s approval. Returns whether its bot is ready, and the steps when it is not.',
    inputSchema: { type: 'object', properties: { agent: { type: 'string' }, kb: kbProp, ...approvalProps }, required: ['agent', 'approval_chat_id', 'approval_message_id'] },
  },
  {
    name: 'agent_disable',
    description: 'Turn an agent off for a team. By default also deletes its Agent channel and role in this KB (irreversible — say so when you ask); remove_channel: false keeps them. Its bot stays (other teams may use it). Needs the owner\'s approval.',
    inputSchema: { type: 'object', properties: { agent: { type: 'string' }, kb: kbProp, remove_channel: { type: 'boolean' }, ...approvalProps }, required: ['agent', 'approval_chat_id', 'approval_message_id'] },
  },
  {
    name: 'discord_admin',
    description: 'Create or delete a channel or a role in this team\'s Discord category. create_channel (name; voice: true for a voice channel) — the Manager serves the new channel at once. delete_channel (id) — only channels in this category, not the General or an Agent channel (use agent_disable). create_role (name) / delete_role (id) — only roles this team created. Needs the owner\'s approval; deletions are irreversible.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create_channel', 'delete_channel', 'create_role', 'delete_role'] },
        name: { type: 'string' },
        id: { type: 'string', description: 'Channel or role id (delete_*)' },
        voice: { type: 'boolean' },
        kb: kbProp,
        ...approvalProps,
      },
      required: ['action', 'approval_chat_id', 'approval_message_id'],
    },
  },
  {
    name: 'call_say',
    description: 'Speak in the Call (the KB\'s voice channel): the text is synthesized and played to the people there. Spoken style: short sentences, no markdown, lists or links (put those in a thread). When nobody is in the call, it is kept and you give an update when someone comes back.',
    kbOnly: true,
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'call_end',
    description: 'End the Call when the person says they are done ("that\'s all for tonight"): the bot leaves the voice channel when the last person leaves (now: true leaves at once). Until then, it stays — even when everyone has left — so the work can go on.',
    kbOnly: true,
    inputSchema: { type: 'object', properties: { now: { type: 'boolean' } } },
  },
  {
    name: 'call_status',
    description: 'Who is in the Call, whether the bot is in the voice channel, whether an end was asked, and how many things were kept for people who left.',
    kbOnly: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'call_setup',
    description: 'Turn Calls on (enabled: true) or off for a team: on creates the KB\'s voice channel ("Appel"/"Call"); the bot joins it whenever someone does. Off keeps the channel unless remove_channel: true. Needs the owner\'s approval. Returns what is left to do (Call service install, OpenAI key).',
    inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' }, remove_channel: { type: 'boolean' }, kb: kbProp, ...approvalProps }, required: ['approval_chat_id', 'approval_message_id'] },
  },
  {
    name: 'bot_register',
    description: 'Activate an agent\'s Discord bot once its token is in workspace/.env (the owner puts it there on the PC — never in Discord): checks it, activates it, records it, sets its name in the server. Returns the invite link when the bot is not in the server yet. Without a token, returns the steps to give the owner. Needs the owner\'s approval. No restart needed.',
    inputSchema: { type: 'object', properties: { agent: { type: 'string' }, ...approvalProps }, required: ['agent'] },
  },
  {
    name: 'route',
    description: 'Router: post a request from the Global General into a KB\'s General (as that KB\'s Manager bot, silently, naming the author without pinging them, linking the original and copying its attachments), and mark the request with ✅. ' +
      'That ✅ is your whole confirmation: post nothing else in the Global General — the KB\'s Task thread is where the author gets pinged. Returns chat_id/message_id of the posted copy and the KB session name — then SendMessage that session so it handles it.',
    routerOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        kb: { type: 'string', description: 'KB id' },
        text: { type: 'string', description: 'The request, in the author\'s words' },
        author_id: { type: 'string' },
        author_name: { type: 'string' },
        source_message_id: { type: 'string', description: 'message_id of the request in the Global General' },
      },
      required: ['kb', 'text'],
    },
  },
  {
    name: 'instance_status',
    description: 'Router: every KB with whether its session is running and its open threads (Task id, Requester, Hops, who is waiting on whom, link).',
    routerOnly: true,
    inputSchema: { type: 'object', properties: {} },
  },
]

const visibleTools = () => TOOLS
  .filter(t => (SESSION === ROUTER ? !t.kbOnly : !t.routerOnly))
  .map(({ kbOnly, routerOnly, ...t }) => t)

let tools
let startupError
try {
  if (!SESSION || !WORKSPACE) throw new Error('CRELIO_SESSION and CRELIO_WORKSPACE must be set (the launcher sets them)')
  // Live: an administration change (from this session, the Router or the owner's editor) applies without a restart.
  const instance = liveInstance(WORKSPACE, { repoDir: process.env.CRELIO_HOME })
  tools = createTools({ instance, sessionId: SESSION })
} catch (e) {
  startupError = e.message
}

const INSTRUCTIONS = startupError
  ? `CrelioBot tools are unavailable: ${startupError}`
  : `CrelioBot team tools for ${SESSION === ROUTER ? 'the Router' : `the KB "${SESSION}"`}. Speak in Discord with post (as yourself, through your own bot), organise work in threads (thread_open / thread_list / thread_history / thread_meta / thread_close), and call whereami when an inbound message's routing is unclear. These tools only work inside this session's own channels.`

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'crelio', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      } })
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: startupError ? [] : visibleTools() } })
    if (method === 'tools/call') {
      const fn = visibleTools().some(t => t.name === params?.name) ? tools?.[params.name] : undefined
      if (!fn) throw new Error(`unknown tool: ${params?.name}`)
      const args = { ...params.arguments }
      if (args.chat_id === undefined && args.thread_id !== undefined) args.chat_id = args.thread_id // thread_open returns thread_id
      try {
        const out = await fn(args)
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } })
      } catch (e) {
        const text = e instanceof ToolError || e.name === 'DiscordError' || e.name === 'ConfigError' ? e.message : `${e.name}: ${e.message}`
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } })
      }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message ?? e) } })
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    handle(msg)
  }
})
process.stdin.on('end', () => process.exit(0))
