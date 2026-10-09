// Instance: one person's CrelioBot — read from the Workspace (crelio.json, kbs/*.json, .env).
// Every other module asks it the same questions: which KBs, which Agents, which bot speaks
// for an Agent, which KB a Discord channel belongs to. See CONTEXT.md for the vocabulary.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export class ConfigError extends Error {
  name = 'ConfigError'
}

export const ROUTER = 'router'
export const SPECIALISTS = ['kb-researcher', 'web-researcher', 'brainstormer', 'artist', 'ux-expert', 'marketing', 'lawyer', 'planner', 'coder']
export const CORE_AGENTS = ['manager', ...SPECIALISTS]
export const PERMISSION_LEVELS = ['guarded', 'full']

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

  /** Agents on a KB team: Core agents (minus disabled) + Workspace-wide and KB Custom agents. */
  agentsFor(kbId) {
    const kb = kbId ? this.kb(kbId) : null
    const disabled = new Set(kb?.agents?.disabled ?? [])
    return [
      ...CORE_AGENTS.filter(a => a === 'manager' || !disabled.has(a)),
      ...(this.settings.agents?.custom ?? []),
      ...(kb?.agents?.custom ?? []),
    ].filter((a, i, all) => all.indexOf(a) === i)
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
    return [d.general_id, ...Object.values(d.agents ?? {})].filter(Boolean)
  }

  /** Which session, KB, role and Agent a channel (not a thread) belongs to; null if outside the Instance. */
  locate(channelId) {
    if (channelId && channelId === this.globalGeneralId) return { session: ROUTER, kb: null, role: 'global', agent: 'manager' }
    for (const [id, kb] of this.kbs) {
      const d = kb.discord ?? {}
      if (channelId === d.general_id) return { session: id, kb: id, role: 'general', agent: 'manager' }
      for (const [agent, ch] of Object.entries(d.agents ?? {})) {
        if (ch === channelId) return { session: id, kb: id, role: 'agent', agent }
      }
    }
    return null
  }

  stateDir(sessionId) { return join(this.workspaceDir, 'state', sessionId) }
}
