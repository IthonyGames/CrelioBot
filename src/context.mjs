// Session context injected at session start (and after /clear or compaction) by the plugin's
// SessionStart hook: identity, team roster, channels, task system, Schedules to arm, open threads
// with their last messages, recent Team learnings. Kept under ~9 000 characters, beyond which
// Claude Code moves hook output to a file instead of the context.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROUTER } from './instance.mjs'
import { agentName } from './tools.mjs'

const BUDGET = 9000
const MAX_THREADS = 8
const LAST_MESSAGES = 5

export async function sessionContext({ instance, sessionId, tools }) {
  const isRouter = sessionId === ROUTER
  const team = await tools.team()
  const out = []

  if (isRouter) {
    out.push(
      '# CrelioBot — Router session',
      `You are the Router of this Instance. Global General: ${instance.globalGeneralId}. Owner: <@${team.owner_id}>. Default language: ${team.language}.`,
      '', '## KB teams (route with mcp__crelio__route, then SendMessage to the session name)',
      ...team.kbs.map(k => `- **${k.name}** (id \`${k.id}\`, ${k.language ?? team.language}) — General ${k.general_id} — session \`${k.session_name}\` — agents: ${k.agents.join(', ')}`),
    )
  } else {
    const kb = team.kb
    out.push(
      `# CrelioBot — ${kb.name} team (KB \`${kb.id}\`)`,
      `You are the Manager of this team. Write to people in the language they use with you; when nobody has written yet, in **${team.language}**. Hop budget per Task: ${team.hop_budget}. Owner: <@${team.owner_id}>. KB folder: ${kb.path}`,
      `Task system adapter: \`${kb.tasks?.adapter ?? 'none'}\`${kb.tasks?.notes ? ` — ${kb.tasks.notes}` : ''}`,
      '', '## Channels and team (agent — bot — role — channel)',
      `- KB General: ${team.kb_general_id}`,
      ...team.agents.map(a => `- ${a.name} (\`${a.id}\`) — bot ${a.bot_user_id ?? '—'} — mention ${a.mention} — channel ${a.channel_id ?? '—'}${a.id === 'manager' || a.bot_user_id ? '' : ' — ⚠ no bot yet'}`),
      ...Object.entries(team.channels ?? {}).map(([name, id]) => `- #${name}: ${id} (you serve it)`),
      `Off, can be enabled on request (agent_enable): ${team.available.length ? team.available.map(a => `\`${a}\``).join(', ') : 'none'}. This roster is from the session start — after a team change, \`team\` is the truth.`,
    )
    const kbProfile = instance.kb(sessionId)
    if (kbProfile.call?.enabled && kbProfile.discord?.call_id) {
      let state = null
      try { state = JSON.parse(readFileSync(join(instance.stateDir(sessionId), 'call', 'state.json'), 'utf8')) } catch {}
      out.push('', `## Calls — voice channel <#${kbProfile.discord.call_id}>`,
        'People talk to you there: their words arrive as `[Call]` messages from crelio-call; you answer out loud with call_say (see "Calls" in your instructions).',
        state?.active ? `**A Call is in progress** (since ${state.since}): ${state.people.length ? `in it now: ${state.people.join(', ')}` : 'nobody in it right now'}${state.held ? `, ${state.held} thing(s) kept to say` : ''}${state.end_requested ? ', ending when the last person leaves' : ''}.` : 'No Call in progress.')
    }
    const schedules = instance.kb(sessionId).schedules ?? []
    if (schedules.length) {
      out.push('', '## Schedules — arm each with CronCreate if CronList does not show it',
        ...schedules.map(s => `- \`${s.id}\` — cron \`${s.cron}\` — ${s.prompt}`))
    }
  }

  // Open threads, most recent first, with their last messages.
  let threads = []
  try { threads = (await tools.thread_list({})).threads } catch (e) { out.push('', `## Open threads\nCould not read them at start (${e.message}). Use thread_list.`) }
  out.push('', '## After a restart',
    'This session just (re)started: subagents that were running are gone. Do not resume anything on your own.',
    '- When the next message continues an unfinished Task (same thread, or clearly the same subject), read its full history with thread_history and continue it from where it stopped — re-dispatch the agent that was working.',
    '- When it is a new request, ignore the unfinished ones and handle it as new.')

  // Last messages of the General channel (KB General, or the Global General for the Router).
  const generalId = isRouter ? instance.globalGeneralId : team.kb_general_id
  if (generalId) {
    try {
      const h = await tools.thread_history({ chat_id: generalId, limit: LAST_MESSAGES })
      out.push('', `## ${isRouter ? 'Global' : 'KB'} General — last ${LAST_MESSAGES} messages`, ...(h.messages.length ? h.messages.map(m => (m.length > 280 ? m.slice(0, 280) + '…' : m)) : ['(none)']))
    } catch {}
  }

  if (threads.length) {
    threads.sort((a, b) => (BigInt(b.last_message_id ?? b.thread_id) > BigInt(a.last_message_id ?? a.thread_id) ? 1 : -1))
    out.push('', `## Open threads — last ${LAST_MESSAGES} messages each (full history: thread_history)`)
    for (const t of threads.slice(0, MAX_THREADS)) {
      const meta = [t.kind, t.channel, t.task_id && `task ${t.task_id}`, t.requester && `requester <@${t.requester}>`, t.hops !== undefined && `hops ${t.hops}`, t.waiting_on && `waiting on ${JSON.stringify(t.waiting_on)}`].filter(Boolean).join(' · ')
      out.push(`### «${t.name}» — chat_id ${t.thread_id}`, meta)
      try {
        const h = await tools.thread_history({ chat_id: t.thread_id, limit: LAST_MESSAGES })
        if (h.request) out.push(`Request: ${h.request.slice(0, 300)}`)
        out.push(...h.messages.map(m => (m.length > 280 ? m.slice(0, 280) + '…' : m)))
      } catch {}
    }
    if (threads.length > MAX_THREADS) out.push(`(${threads.length - MAX_THREADS} more open threads — thread_list)`)
  } else if (!out.some(l => l.startsWith('## Open threads'))) {
    out.push('', '## Open threads', 'None.')
  }

  const learnings = join(instance.workspaceDir, 'learnings', 'team.md')
  if (existsSync(learnings)) {
    const lines = readFileSync(learnings, 'utf8').split('\n').filter(l => l.startsWith('- ')).slice(-12)
    if (lines.length) out.push('', '## Recent Team learnings', ...lines)
  }

  let text = out.join('\n')
  if (text.length > BUDGET) text = text.slice(0, BUDGET - 80) + '\n…(truncated — use thread_list / thread_history for the rest)'
  return text
}

export { agentName }
