// crelio doctor — checks the environment and the Instance end to end, with the fix for each problem.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentName, loadInstance } from '../instance.mjs'
import { discordClient } from '../discord.mjs'
import { buildSession } from '../runtime.mjs'
import { callsInstalled, findExecutable } from '../launcher.mjs'
import { hasMessageContentIntent, inviteUrl } from '../permissions.mjs'
import { localChanges, staleLock } from '../git.mjs'

export async function runDoctor({ workspace, repoDir, clientFor = t => discordClient(t), env = process.env }) {
  const results = []
  const ok = m => results.push({ level: 'ok', m })
  const warn = (m, fix) => results.push({ level: 'warn', m, fix })
  const fail = (m, fix) => results.push({ level: 'fail', m, fix })

  // --- environment
  const major = Number(process.versions.node.split('.')[0])
  major >= 22 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old`, 'Install Node 22 or later: https://nodejs.org')
  const claude = findExecutable('claude', env)
  if (claude) {
    const v = spawnSync(claude, ['--version'], { encoding: 'utf8', shell: /\.(cmd|bat)$/i.test(claude) }).stdout?.trim()
    ok(`Claude Code ${v ?? ''}`.trim())
  } else fail('Claude Code (claude) not found', 'Install it: https://code.claude.com/docs/en/quickstart')
  findExecutable('bun', env) ? ok('Bun (needed by the official Discord plugin)') : fail('Bun not found — the official Discord plugin runs on Bun', 'Install Bun: https://bun.sh')
  const pluginsFile = join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'plugins', 'installed_plugins.json')
  const hasPlugin = existsSync(pluginsFile) && readFileSync(pluginsFile, 'utf8').includes('discord@claude-plugins-official')
  hasPlugin ? ok('Discord channel plugin installed') : fail('Discord channel plugin not installed', 'In Claude Code: /plugin install discord@claude-plugins-official (user scope)')

  // --- instance
  let instance
  try { instance = loadInstance(workspace, { repoDir }) } catch (e) { fail(e.message, 'Run setup.bat'); return results }
  ok(`Workspace ${instance.workspaceDir}`)
  if (!instance.guildId) fail('No Discord server chosen', 'crelio discord servers → crelio discord use <id>')
  if (!instance.settings.server?.owner_id) warn('No owner user id', 'Set server.owner_id in crelio.json (crelio discord use sets it to the server owner)')
  if (!instance.kbs.size) warn('No KB yet', 'crelio kb add <path>')
  instance.secret(instance.settings.voice?.api_key_env ?? 'OPENAI_API_KEY') ? ok('Voice key present') : warn('No OPENAI_API_KEY — Voice notes are disabled', 'Add OPENAI_API_KEY to workspace/.env')

  // --- bots
  const managerToken = instance.botFor(null, 'manager')?.token
  let guildChannels = null
  for (const [agent, bot] of Object.entries(instance.settings.bots ?? {})) {
    const token = instance.secret(bot.token_env)
    if (!token) { (agent === 'manager' ? fail : warn)(`${agentName(agent)}: no token`, `crelio bot add ${agent}`); continue }
    try {
      const client = clientFor(token)
      const app = await client.get('/applications/@me')
      if (agent === 'manager' && !hasMessageContentIntent(app.flags)) fail('Manager: Message Content Intent is off', 'Developer Portal → Manager app → Bot → Privileged Gateway Intents → Message Content Intent')
      if (instance.guildId) {
        try { await client.get(`/guilds/${instance.guildId}`); ok(`${agentName(agent)}: token valid, in the server`) }
        catch { fail(`${agentName(agent)}: not in the server`, `Invite it: ${inviteUrl(app.id, agent)}`) }
      } else ok(`${agentName(agent)}: token valid`)
    } catch (e) {
      fail(`${agentName(agent)}: token refused (${e.message})`, `Reset the token in the Developer Portal, then crelio bot add ${agent}`)
    }
  }

  // --- the Manager must be able to build the layout (Administrator, or at least Manage Channels + Manage Roles)
  const managerId = instance.settings.bots?.manager?.user_id
  if (managerToken && instance.guildId && managerId) {
    try {
      const client = clientFor(managerToken)
      const [member, roles] = await Promise.all([client.get(`/guilds/${instance.guildId}/members/${managerId}`), client.get(`/guilds/${instance.guildId}/roles`)])
      let perms = BigInt(roles.find(r => r.id === instance.guildId)?.permissions ?? 0)
      for (const r of roles) if (member.roles?.includes(r.id)) perms |= BigInt(r.permissions)
      const admin = (perms & 8n) !== 0n
      const canBuild = admin || ((perms & 16n) !== 0n && (perms & (1n << 28n)) !== 0n)
      if (admin) ok('Manager: Administrator in the server')
      else if (canBuild) warn('Manager: no Administrator (Manage Channels + Manage Roles are enough to build the layout)', 'Give it Administrator to let it manage threads everywhere')
      else fail('Manager: cannot create channels or roles in the server', `Re-authorize with Administrator: ${inviteUrl(instance.settings.bots.manager.app_id ?? managerId, 'manager')}&guild_id=${instance.guildId} — or Server Settings → Roles → its role → Administrator`)
    } catch {}
  }

  // --- channels
  if (managerToken && instance.guildId) {
    try { guildChannels = new Set((await clientFor(managerToken).get(`/guilds/${instance.guildId}/channels`)).map(c => c.id)) } catch {}
  }
  const checkChannel = (id, what) => {
    if (!id) return fail(`${what}: not created`, 'crelio discord provision')
    if (guildChannels && !guildChannels.has(id)) return fail(`${what}: channel ${id} no longer exists`, 'crelio discord provision')
  }
  if (instance.routerEnabled) checkChannel(instance.globalGeneralId, 'Global General')
  for (const kb of instance.kbs.values()) {
    existsSync(kb.path) ? ok(`KB ${kb.id}: folder found`) : fail(`KB ${kb.id}: folder not found (${kb.path})`, `Fix "path" in workspace/kbs/${kb.id}.json`)
    if (existsSync(join(kb.path, '.git'))) {
      const lock = staleLock(kb.path)
      if (lock) fail(`KB ${kb.id}: stale git lock (${lock.minutes} min old) blocks every git write`, `Make sure no git is running, then delete ${lock.path}`)
      const changes = kb.pull_on_start ? localChanges(kb.path) : 0
      if (changes) warn(`KB ${kb.id}: ${changes} uncommitted change(s) — "pull on start" fails if incoming commits touch them`, 'Commit or stash them (the session log says which files block the pull)')
    }
    checkChannel(kb.discord?.general_id, `KB ${kb.id} General`)
    for (const a of instance.agentsFor(kb.id).filter(a => a !== 'manager')) {
      checkChannel(kb.discord?.agents?.[a], `KB ${kb.id} #${a}`)
      if (!instance.botFor(kb.id, a)?.token) warn(`KB ${kb.id}: the ${agentName(a)} agent has no bot — it cannot post`, `crelio bot add ${a}`)
    }
  }

  // --- calls (optional voice channels, ADR-0007)
  const callKbs = [...instance.kbs.values()].filter(k => k.call?.enabled)
  if (callKbs.length) {
    callsInstalled(instance.repoDir) ? ok('Call service installed') : fail(`Calls are on (${callKbs.map(k => k.id).join(', ')}) but the Call service is not installed`, 'crelio calls install, then restart CrelioBot')
    if (!instance.secret(instance.settings.voice?.api_key_env ?? 'OPENAI_API_KEY')) fail('Calls need an OpenAI key for speech', 'Add OPENAI_API_KEY to workspace/.env')
    for (const kb of callKbs) checkChannel(kb.discord?.call_id, `KB ${kb.id} voice channel`)
  }

  // --- sessions
  for (const id of instance.sessions()) {
    try { buildSession(instance, id); ok(`session ${id}: ready to start`) } catch (e) { fail(`session ${id}: ${e.message}`) }
  }
  return results
}

export default async function doctor({ workspace, repoDir }) {
  const results = await runDoctor({ workspace, repoDir })
  const icon = { ok: '✔', warn: '⚠', fail: '✖' }
  for (const r of results) console.log(`${icon[r.level]} ${r.m}${r.fix ? `\n    → ${r.fix}` : ''}`)
  const fails = results.filter(r => r.level === 'fail').length
  console.log(fails ? `\n${fails} problem(s) to fix.` : '\nAll good.')
  if (fails) process.exitCode = 1
}
