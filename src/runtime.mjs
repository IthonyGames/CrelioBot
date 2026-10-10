// Session runtime: everything needed to start one session — working folder, environment,
// `claude` arguments and the generated files. buildSession is pure: it reads the Instance, writes nothing.
// writeSessionFiles() puts the generated files on disk; writeAccess() rewrites a running session's plugin access.

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ConfigError, ROUTER } from './instance.mjs'

export const DISCORD_CHANNEL = 'plugin:discord@claude-plugins-official'
export const PLUGIN_NAME = 'creliobot'

// Variables that identify the *parent* Claude Code session. Inherited, they make the child think it is
// nested: it then never registers for cross-session messages (verified in spike 01). User configuration
// such as ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR or CLAUDE_CODE_USE_BEDROCK is kept.
const PARENT_SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_ENV_FILE|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_(ROOT|DATA)|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|ENTRYPOINT|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN|BRIDGE_SESSION_ID|SSE_PORT))$/
// Never let another bot's token or another session's Crelio identity leak in.
const OWN_VARS = /^(DISCORD_|CRELIO_)/

export function cleanEnv(parentEnv) {
  return Object.fromEntries(Object.entries(parentEnv).filter(([k]) => !PARENT_SESSION_VARS.test(k) && !OWN_VARS.test(k)))
}

// Tools every session may use without a prompt (dontAsk denies anything not listed).
const TEAM_TOOLS = [
  'mcp__crelio', 'mcp__plugin_discord_discord',
  'Read', 'Glob', 'Grep', 'Agent', 'Skill', 'ToolSearch', 'TodoWrite',
  'SendMessage', 'ListAgents', 'CronCreate', 'CronList', 'CronDelete',
  'WebSearch', 'WebFetch',
]
// Guarded level: edits inside the session folder and a conservative set of commands; the Bash guard
// hook additionally refuses any path outside the session folder and inbox.
const GUARDED_RULES = [
  'Edit(./**)',
  'Bash(git *)', 'Bash(gh pr *)', 'Bash(gh issue *)', 'Bash(cd *)', 'Bash(ls *)',
  'Bash(npm install*)', 'Bash(npm ci*)', 'Bash(npm test*)', 'Bash(npm run *)',
]

/**
 * The official Discord plugin's access.json for a session: deliver every message from the session's
 * channels (and their threads), no DMs. The plugin re-reads it on every message, so rewriting it
 * (writeAccess) makes a session hear a new Agent channel at once — no restart.
 */
export function accessFor(instance, id) {
  return {
    dmPolicy: 'allowlist',
    allowFrom: [],
    groups: Object.fromEntries(instance.channelsOf(id).map(c => [c, { requireMention: false, allowFrom: [] }])),
    pending: {},
    ackReaction: instance.settings.ack_reaction ?? '', // no receipt reaction on people's messages unless asked for
    replyToMode: 'off',
    chunkMode: 'newline',
  }
}

export function accessPath(instance, id) {
  return join(instance.stateDir(id), 'discord', 'access.json')
}

export function writeAccess(instance, id) {
  const path = accessPath(instance, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path + '.tmp', JSON.stringify(accessFor(instance, id), null, 2) + '\n', { mode: 0o600 })
  renameSync(path + '.tmp', path)
}

function hookCommand(nodePath, script) {
  const fwd = p => p.replaceAll('\\', '/')
  return `"${fwd(nodePath)}" "${fwd(script)}"`
}

export function buildSession(instance, id, { parentEnv = process.env, nodePath = process.execPath } = {}) {
  const isRouter = id === ROUTER
  const kb = isRouter ? null : instance.kb(id)
  const kbId = kb?.id ?? null
  const permission = isRouter ? (instance.settings.router?.permission ?? 'guarded') : kb.permission
  if (!['guarded', 'full'].includes(permission)) throw new ConfigError(`Router "permission" must be guarded or full`)

  const stateDir = instance.stateDir(id)
  const discordDir = join(stateDir, 'discord')
  const inbox = join(discordDir, 'inbox')
  const settingsPath = join(stateDir, 'settings.json')
  const mcpPath = join(stateDir, 'mcp.json')
  const cwd = isRouter ? instance.workspaceDir : kb.path

  const channels = instance.channelsOf(id)
  if (!channels.length) {
    throw new ConfigError(isRouter
      ? 'The Global General channel is not set (crelio.json → global_general.channel_id) — run "crelio discord provision"'
      : `KB "${id}" has no Discord channels yet — run "crelio discord provision"`)
  }

  const crelioEnv = { CRELIO_SESSION: id, CRELIO_WORKSPACE: instance.workspaceDir, CRELIO_HOME: instance.repoDir }
  const env = {
    ...cleanEnv(parentEnv),
    ...crelioEnv,
    DISCORD_STATE_DIR: discordDir,
    DISCORD_BOT_TOKEN: instance.requireToken(kbId, 'manager'),
  }

  const mcp = {
    mcpServers: {
      crelio: { command: nodePath, args: [join(instance.repoDir, 'mcp', 'server.mjs')], env: crelioEnv },
    },
  }

  const extraAllow = isRouter ? (instance.settings.router?.allow ?? []) : (kb.allow?.tools ?? [])
  const settings = {
    crossSessionInbound: 'accept',
    permissions: {
      allow: [...TEAM_TOOLS, ...(permission === 'guarded' ? GUARDED_RULES : []), ...extraAllow],
      deny: [],
    },
  }
  if (permission === 'guarded') {
    const hooksDir = join(instance.repoDir, 'hooks')
    settings.hooks = {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand(nodePath, join(hooksDir, 'guard-bash.mjs')), timeout: 10 }] },
        {
          matcher: 'mcp__plugin_discord_discord__reply|mcp__crelio__post|mcp__crelio__attach',
          hooks: [{ type: 'command', command: hookCommand(nodePath, join(hooksDir, 'guard-files.mjs')), timeout: 10 }],
        },
      ],
    }
  }

  const pluginDirs = [join(instance.repoDir, 'plugin')]
  const wsPlugin = join(instance.workspaceDir, 'plugin')
  if (existsSync(join(wsPlugin, '.claude-plugin', 'plugin.json'))) pluginDirs.push(wsPlugin)

  const args = [
    '--channels', DISCORD_CHANNEL,
    ...pluginDirs.flatMap(d => ['--plugin-dir', d]),
    '--agent', `${PLUGIN_NAME}:${isRouter ? 'router' : 'manager'}`,
    '--name', `crelio-${id}`,
    '--permission-mode', permission === 'full' ? 'bypassPermissions' : 'dontAsk',
    '--settings', settingsPath,
    '--mcp-config', mcpPath,
    '--add-dir', inbox,
  ]

  const json = v => JSON.stringify(v, null, 2) + '\n'
  return {
    id,
    name: isRouter ? 'Router' : (kb.name ?? id),
    cwd,
    env,
    args,
    stateDir,
    inbox,
    permission,
    files: {
      [accessPath(instance, id)]: json(accessFor(instance, id)),
      [settingsPath]: json(settings),
      [mcpPath]: json(mcp),
    },
  }
}

export function writeSessionFiles(session) {
  mkdirSync(session.inbox, { recursive: true })
  for (const [path, content] of Object.entries(session.files)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, { mode: 0o600 })
  }
}
