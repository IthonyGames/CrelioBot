// Instance: one person's CrelioBot — read from the Workspace (crelio.json, kbs/*.json, .env).
// Every other module asks it the same questions: which KBs, which Agents, which bot speaks
// for an Agent, which KB a Discord channel belongs to. See CONTEXT.md for the vocabulary.

import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export class ConfigError extends Error {
  name = 'ConfigError'
}

export const ROUTER = 'router'
export const SPECIALISTS = ['kb-researcher', 'web-researcher', 'brainstormer', 'artist', 'ux-expert', 'marketing', 'lawyer', 'planner', 'coder']
export const CORE_AGENTS = ['manager', ...SPECIALISTS]
// A new KB starts with the Manager and these; the other Core agents are enabled when someone needs them.
export const DEFAULT_TEAM = ['kb-researcher', 'web-researcher', 'planner']
export const PERMISSION_LEVELS = ['guarded', 'full']

const AGENT_NAMES = {
  manager: 'Manager', 'kb-researcher': 'KB Researcher', 'web-researcher': 'Web Researcher', brainstormer: 'Brainstormer',
  artist: 'Artist', 'ux-expert': 'UX Expert', marketing: 'Marketing', lawyer: 'Lawyer', planner: 'Planner', coder: 'Coder',
}
export function agentName(id) {
  return AGENT_NAMES[id] ?? id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/

export function parseEnv(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

function readJson(path, what) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { throw new ConfigError(`${what} not found: ${path} — run setup first`) }
  try { return JSON.parse(text) } catch (e) { throw new ConfigError(`${what} is not valid JSON (${path}): ${e.message}`) }
}

function writeJson(path, data) {
  writeFileSync(path + '.tmp', JSON.stringify(data, null, 2) + '\n')
  renameSync(path + '.tmp', path)
}

/** Read-modify-write a KB profile (mutate receives the parsed JSON and may change it in place). */
export function updateKbProfile(workspaceDir, id, mutate) {
  const path = join(resolve(workspaceDir), 'kbs', `${id}.json`)
  const data = readJson(path, 'KB profile')
  mutate(data)
  writeJson(path, data)
  return data
}

/** Read-modify-write the Instance settings (crelio.json). */
export function updateSettings(workspaceDir, mutate) {
  const path = join(resolve(workspaceDir), 'crelio.json')
  const data = readJson(path, 'Instance settings')
  mutate(data)
  writeJson(path, data)
  return data
}

/** Set (or replace) KEY=value lines in workspace/.env without touching the others. */
export function setSecret(workspaceDir, name, value) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new ConfigError(`invalid secret name ${name}`)
  const path = join(resolve(workspaceDir), '.env')
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : []
  const i = lines.findIndex(l => l.startsWith(`${name}=`))
  if (i >= 0) lines[i] = `${name}=${value}`
  else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`)
  writeFileSync(path, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 })
}

export function loadInstance(workspaceDir, { repoDir } = {}) {
  const ws = resolve(workspaceDir)
  const settings = readJson(join(ws, 'crelio.json'), 'Instance settings')
  const envPath = join(ws, '.env')
  const secrets = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}

  const kbs = new Map()
  const kbDir = join(ws, 'kbs')
  const files = existsSync(kbDir) ? readdirSync(kbDir).filter(f => f.endsWith('.json')).sort() : []
  for (const f of files) {
    const profile = readJson(join(kbDir, f), 'KB profile')
    const id = f.slice(0, -5)
    if (!ID.test(id) || id === ROUTER) throw new ConfigError(`KB id "${id}" (${f}) must be lowercase letters, digits and dashes, and not "router"`)
    if (profile.id && profile.id !== id) throw new ConfigError(`KB profile ${f} says id "${profile.id}" — the file name decides the id`)
    if (!profile.path) throw new ConfigError(`KB profile ${f} has no "path"`)
    const permission = profile.permission ?? 'guarded'
    if (!PERMISSION_LEVELS.includes(permission)) throw new ConfigError(`KB profile ${f}: "permission" must be ${PERMISSION_LEVELS.join(' or ')}`)
    kbs.set(id, { ...profile, id, permission, path: isAbsolute(profile.path) ? profile.path : resolve(ws, profile.path) })
  }
  return new Instance({ repoDir: resolve(repoDir ?? join(import.meta.dirname, '..')), workspaceDir: ws, settings, secrets, kbs })
}

/** What changes when the Workspace is edited: the mtimes of crelio.json, .env and every KB profile. */
function workspaceStamp(ws) {
  const stamp = f => { try { return statSync(f).mtimeMs } catch { return 0 } }
  const kbDir = join(ws, 'kbs')
  const kbs = existsSync(kbDir) ? readdirSync(kbDir).filter(f => f.endsWith('.json')).sort() : []
  return [stamp(join(ws, 'crelio.json')), stamp(join(ws, '.env')), ...kbs.map(f => `${f}:${stamp(join(kbDir, f))}`)].join('|')
}

/**
 * An Instance that follows the Workspace: every access goes to the latest version, re-read when a file
 * changed (checked at most once a second). Long-running processes (the MCP server) use it so an
 * administration change — an agent enabled, a channel created — applies without restarting the session.
 * A broken edit keeps the last good version.
 */
export function liveInstance(workspaceDir, { repoDir } = {}) {
  const ws = resolve(workspaceDir)
  let current = loadInstance(ws, { repoDir })
  let stamp = workspaceStamp(ws)
  let checkedAt = Date.now()
  const latest = (force = false) => {
    if (!force && Date.now() - checkedAt < 1000) return current
    checkedAt = Date.now()
    const now = workspaceStamp(ws)
    if (force || now !== stamp) {
      try { current = loadInstance(ws, { repoDir }); stamp = now } catch {}
    }
    return current
  }
  return new Proxy({}, {
    get(_, key) {
      if (key === 'reload') return () => latest(true) // after this process wrote the Workspace itself
      const inst = latest()
      const value = inst[key]
      return typeof value === 'function' ? value.bind(inst) : value
    },
  })
}

export class Instance {
  constructor({ repoDir, workspaceDir, settings, secrets, kbs }) {
    this.repoDir = repoDir
    this.workspaceDir = workspaceDir
    this.settings = settings
    this.secrets = secrets
    this.kbs = kbs
  }

  get language() { return this.settings.language ?? 'en' }
  get hopBudget() { return this.settings.hop_budget ?? 12 }
  get guildId() { return this.settings.server?.guild_id }
  get globalGeneralId() { return this.settings.global_general?.channel_id }
  get routerEnabled() { return this.settings.router?.enabled !== false }

  sessions() {
    return [...(this.routerEnabled ? [ROUTER] : []), ...this.kbs.keys()]
  }

  kb(id) {
    const kb = this.kbs.get(id)
    if (!kb) throw new ConfigError(`Unknown KB "${id}" — known KBs: ${[...this.kbs.keys()].join(', ') || 'none'}`)
    return kb
  }

  /** Agents a KB team may enable: the Core Specialists + Workspace-wide and KB Custom agents. */
  availableAgents(kbId) {
    const kb = kbId ? this.kb(kbId) : null
    return [...SPECIALISTS, ...(this.settings.agents?.custom ?? []), ...(kb?.agents?.custom ?? [])].filter((a, i, all) => all.indexOf(a) === i)
  }

  /**
   * Agents on a KB team: the Manager + the enabled ones. A profile lists them in agents.enabled; older
   * profiles have agents.disabled instead (everything available minus those).
   */
  agentsFor(kbId) {
    const kb = kbId ? this.kb(kbId) : null
    const available = this.availableAgents(kbId)
    const enabled = Array.isArray(kb?.agents?.enabled)
      ? new Set(kb.agents.enabled)
      : new Set(available.filter(a => !(kb?.agents?.disabled ?? []).includes(a)))
    return ['manager', ...available.filter(a => enabled.has(a))]
  }

  /** People whose messages count as approval for administration: the server owner and listed admins. */
  get owners() {
    return [this.settings.server?.owner_id, ...(this.settings.admins ?? [])].filter(Boolean)
  }

  /** The Agent bot that speaks for an Agent in a KB (a KB profile may override the shared bot). */
  botFor(kbId, agent) {
    const shared = this.settings.bots?.[agent]
    const override = kbId ? this.kb(kbId).bots?.[agent] : undefined
    const bot = { ...shared, ...override }
    if (!bot.token_env) return null
    return { agent, ...bot, token: this.secrets[bot.token_env] }
  }

  requireToken(kbId, agent) {
    const bot = this.botFor(kbId, agent)
    if (!bot) throw new ConfigError(`No bot configured for the ${agent} agent — add it with "crelio bot add ${agent}"`)
    if (!bot.token) throw new ConfigError(`Missing ${bot.token_env} in ${join(this.workspaceDir, '.env')} — the ${agent} bot token`)
    return bot.token
  }

  secret(name) { return this.secrets[name] }

  /** Discord channels a session listens to (and may act in, with their threads). */
  channelsOf(sessionId) {
    if (sessionId === ROUTER) return [this.globalGeneralId].filter(Boolean)
    const d = this.kb(sessionId).discord ?? {}
    const agents = this.agentsFor(sessionId)
    return [d.general_id, ...Object.entries(d.agents ?? {}).filter(([a]) => agents.includes(a)).map(([, c]) => c), ...Object.values(d.channels ?? {})].filter(Boolean)
  }

  /** Which session, KB, role and Agent a channel (not a thread) belongs to; null if outside the Instance. */
  locate(channelId) {
    if (channelId && channelId === this.globalGeneralId) return { session: ROUTER, kb: null, role: 'global', agent: 'manager' }
    for (const [id, kb] of this.kbs) {
      const d = kb.discord ?? {}
      if (channelId === d.general_id) return { session: id, kb: id, role: 'general', agent: 'manager' }
      for (const [agent, ch] of Object.entries(d.agents ?? {})) {
        if (ch === channelId && this.agentsFor(id).includes(agent)) return { session: id, kb: id, role: 'agent', agent }
      }
      // Other channels the owner had the team create in its category: the Manager serves them.
      for (const [name, ch] of Object.entries(d.channels ?? {})) {
        if (ch === channelId) return { session: id, kb: id, role: 'channel', agent: 'manager', name }
      }
    }
    return null
  }

  stateDir(sessionId) { return join(this.workspaceDir, 'state', sessionId) }
}
