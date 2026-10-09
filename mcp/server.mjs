#!/usr/bin/env node
// Crelio MCP server (stdio, JSON-RPC, no dependencies). One per session, started by Claude Code
// from the session's generated MCP config. Tools: see TOOLS below and src/tools.mjs.

import { loadInstance, ROUTER } from '../src/instance.mjs'
import { createTools, ToolError } from '../src/tools.mjs'

const SESSION = process.env.CRELIO_SESSION
const WORKSPACE = process.env.CRELIO_WORKSPACE

const agentProp = { type: 'string', description: 'Agent id that speaks, e.g. "manager", "kb-researcher", "coder" — always yourself' }
const chatProp = { type: 'string', description: 'Discord channel or thread ID (chat_id from the <channel> tag, or a thread_id)' }

const TOOLS = [
  {
    name: 'post',
    description:
      'Post a message in Discord as an agent, through that agent\'s own bot. Use it for everything the team says in Discord — never the discord plugin\'s reply tool except for one-line acknowledgements from the Manager. ' +
      'Long text is split automatically; link previews are suppressed. Mention a person with <@user_id> and an agent with its role <@&role_id> or bot <@bot_user_id>. ' +
      'files: absolute paths (≤ 20 MiB each) to attach to the last message.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: agentProp,
        chat_id: chatProp,
        text: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        reply_to: { type: 'string', description: 'message_id to reply to (e.g. a person\'s question)' },
        silent: { type: 'boolean', description: 'true = no push notification (progress updates)' },
      },
      required: ['agent', 'chat_id'],
    },
  },
  {
    name: 'edit',
    description: 'Edit a message an agent posted earlier (progress updates). Edits do not notify anyone — post a new message when work completes.',
    inputSchema: { type: 'object', properties: { agent: agentProp, chat_id: chatProp, message_id: { type: 'string' }, text: { type: 'string' } }, required: ['agent', 'chat_id', 'message_id', 'text'] },
  },
  {
    name: 'react',
    description: 'Add an emoji reaction as an agent (e.g. ✅ when done, 👀 when picked up).',
    inputSchema: { type: 'object', properties: { agent: agentProp, chat_id: chatProp, message_id: { type: 'string' }, emoji: { type: 'string' } }, required: ['agent', 'chat_id', 'message_id', 'emoji'] },
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
    description: 'Restart a session through the CrelioBot launcher (it comes back within seconds with its open threads). A KB session restarts itself (e.g. to load a new agent); the Router may restart any KB session ("kb") or itself. Post what you are doing first.',
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
    description: 'Agent creator step: register a Custom agent on this team (scope "kb") or on every team (scope "workspace"), and create its Agent channel and role in this KB\'s category. Write the agent\'s definition file first. Returns whether its bot is ready and what comes next.',
    kbOnly: true,
    inputSchema: { type: 'object', properties: { agent: { type: 'string' }, scope: { type: 'string', enum: ['kb', 'workspace'] } }, required: ['agent'] },
  },
  {
    name: 'route',
    description: 'Router: post a request from the Global General into a KB\'s General (as the Manager bot, quoting the author and linking the original). Returns chat_id/message_id of the posted copy and the KB session name — then SendMessage that session so it handles it.',
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
  const instance = loadInstance(WORKSPACE, { repoDir: process.env.CRELIO_HOME })
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
      try {
        const out = await fn(params.arguments ?? {})
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
