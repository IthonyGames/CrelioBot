import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadInstance, ConfigError } from '../src/instance.mjs'
import { buildSession } from '../src/runtime.mjs'
import { makeWorkspace, REPO, snowflake } from './helpers.mjs'

const parentEnv = { PATH: 'C:\\bin', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'x', DISCORD_BOT_TOKEN: 'leak' }

function argValue(args, flag) {
  const i = args.indexOf(flag)
  return i < 0 ? undefined : args[i + 1]
}

function file(session, suffix) {
  const key = Object.keys(session.files).find(p => p.replaceAll('\\', '/').endsWith(suffix))
  assert.ok(key, `no generated file ending with ${suffix}`)
  return JSON.parse(session.files[key])
}

test('a KB session runs in the KB folder as the Manager, behind the official Discord plugin', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const s = buildSession(instance, 'alpha', { parentEnv })

  assert.equal(s.cwd, instance.kb('alpha').path)
  assert.equal(argValue(s.args, '--channels'), 'plugin:discord@claude-plugins-official')
  assert.equal(argValue(s.args, '--agent'), 'creliobot:manager')
  assert.equal(argValue(s.args, '--name'), 'crelio-alpha')
  assert.equal(argValue(s.args, '--plugin-dir'), join(REPO, 'plugin'))
  assert.equal(argValue(s.args, '--permission-mode'), 'dontAsk')
  assert.equal(argValue(s.args, '--settings'), join(s.stateDir, 'settings.json'))
  assert.equal(argValue(s.args, '--mcp-config'), join(s.stateDir, 'mcp.json'))
  assert.ok(s.args.includes(join(s.stateDir, 'discord', 'inbox')), 'inbox is an added dir')
})

test('the session environment points the plugin at its own state, with the Manager token', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const s = buildSession(instance, 'alpha', { parentEnv })

  assert.equal(s.env.DISCORD_STATE_DIR, join(s.stateDir, 'discord'))
  assert.equal(s.env.DISCORD_ACCESS_MODE, undefined, 'the plugin re-reads access.json on every message, so team changes apply live')
  assert.equal(s.env.DISCORD_BOT_TOKEN, 'token-DISCORD_TOKEN_MANAGER')
  assert.equal(s.env.CRELIO_SESSION, 'alpha')
  assert.equal(s.env.CRELIO_WORKSPACE, ws)
  assert.equal(s.env.PATH, 'C:\\bin')
})

test('variables inherited from a parent Claude Code session are removed, so the session registers for cross-session messages', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const s = buildSession(loadInstance(ws, { repoDir: REPO }), 'alpha', { parentEnv })
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID']) assert.equal(s.env[k], undefined, k)
})

test('the plugin access file lets everyone talk in the KB General and Agent channels, without mentions, and drops DMs', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const s = buildSession(instance, 'alpha', { parentEnv })
  const access = file(s, 'discord/access.json')
  const kb = instance.kb('alpha')

  assert.equal(access.dmPolicy, 'allowlist')
  assert.deepEqual(access.allowFrom, [])
  const expected = [kb.discord.general_id, ...Object.values(kb.discord.agents)].sort()
  assert.deepEqual(Object.keys(access.groups).sort(), expected)
  for (const g of Object.values(access.groups)) assert.deepEqual(g, { requireMention: false, allowFrom: [] })
  assert.equal(access.ackReaction, '', 'no receipt reaction on people\'s messages')
  assert.ok(file(s, 'settings.json').permissions.deny.includes('mcp__plugin_discord_discord__react'), 'the plugin\'s react is off: it would skip the people check')
})

test('two KBs never share a channel scope', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha', 'beta'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const a = Object.keys(file(buildSession(instance, 'alpha', { parentEnv }), 'discord/access.json').groups)
  const b = Object.keys(file(buildSession(instance, 'beta', { parentEnv }), 'discord/access.json').groups)
  assert.equal(a.filter(id => b.includes(id)).length, 0)
  assert.notEqual(buildSession(instance, 'alpha', { parentEnv }).stateDir, buildSession(instance, 'beta', { parentEnv }).stateDir)
})

test('the MCP config starts the Crelio server for this session', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const s = buildSession(loadInstance(ws, { repoDir: REPO }), 'alpha', { parentEnv, nodePath: 'C:\\node\\node.exe' })
  const crelio = file(s, 'mcp.json').mcpServers.crelio
  assert.equal(crelio.command, 'C:\\node\\node.exe')
  assert.deepEqual(crelio.args, [join(REPO, 'mcp', 'server.mjs')])
  assert.equal(crelio.env.CRELIO_SESSION, 'alpha')
  assert.equal(crelio.env.CRELIO_WORKSPACE, ws)
})

test('settings accept cross-session messages and pre-approve the team tools', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const settings = file(buildSession(loadInstance(ws, { repoDir: REPO }), 'alpha', { parentEnv }), 'settings.json')
  assert.equal(settings.crossSessionInbound, 'accept')
  for (const rule of ['mcp__crelio', 'mcp__plugin_discord_discord', 'Agent', 'SendMessage', 'CronCreate', 'WebSearch']) {
    assert.ok(settings.permissions.allow.includes(rule), rule)
  }
})

test('a guarded KB confines Bash and attachments with guard hooks; a full KB bypasses permissions', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha', 'beta'], profiles: { beta: { permission: 'full' } } })
  const instance = loadInstance(ws, { repoDir: REPO })
  const guarded = buildSession(instance, 'alpha', { parentEnv })
  const full = buildSession(instance, 'beta', { parentEnv })

  const hooks = file(guarded, 'settings.json').hooks.PreToolUse.map(h => h.matcher)
  assert.ok(hooks.includes('Bash'))
  assert.ok(hooks.some(m => m.includes('mcp__plugin_discord_discord__reply')))
  assert.equal(argValue(full.args, '--permission-mode'), 'bypassPermissions')
  assert.equal(file(full, 'settings.json').hooks, undefined)
})

test('the Router runs in the Workspace and only listens to the Global General', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const s = buildSession(instance, 'router', { parentEnv })
  assert.equal(s.cwd, ws)
  assert.equal(argValue(s.args, '--agent'), 'creliobot:router')
  assert.equal(argValue(s.args, '--name'), 'crelio-router')
  assert.deepEqual(Object.keys(file(s, 'discord/access.json').groups), [snowflake(3)])
  assert.deepEqual(instance.sessions(), ['router', 'alpha'])
})

test('a KB profile can give its session a dedicated Manager bot', () => {
  const { ws } = makeWorkspace({
    kbs: ['alpha'],
    env: { DISCORD_TOKEN_MANAGER_ALPHA: 'alpha-manager' },
    profiles: { alpha: { bots: { manager: { token_env: 'DISCORD_TOKEN_MANAGER_ALPHA', user_id: snowflake(77) } } } },
  })
  const instance = loadInstance(ws, { repoDir: REPO })
  assert.equal(buildSession(instance, 'alpha', { parentEnv }).env.DISCORD_BOT_TOKEN, 'alpha-manager')
  assert.equal(instance.botFor('alpha', 'manager').user_id, snowflake(77))
  assert.equal(instance.botFor('alpha', 'coder').token, 'token-DISCORD_TOKEN_CODER')
})

test('a Workspace plugin folder is loaded when it exists', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  mkdirSync(join(ws, 'plugin', '.claude-plugin'), { recursive: true })
  writeFileSync(join(ws, 'plugin', '.claude-plugin', 'plugin.json'), '{"name":"crelio-workspace"}')
  const s = buildSession(loadInstance(ws, { repoDir: REPO }), 'alpha', { parentEnv })
  const dirs = s.args.flatMap((a, i) => (a === '--plugin-dir' ? [s.args[i + 1]] : []))
  assert.deepEqual(dirs, [join(REPO, 'plugin'), join(ws, 'plugin')])
})

test('configuration mistakes are reported with the exact thing to fix', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  writeFileSync(join(ws, '.env'), 'OPENAI_API_KEY=x\n')
  const instance = loadInstance(ws, { repoDir: REPO })
  assert.throws(() => buildSession(instance, 'alpha', { parentEnv }), err => err instanceof ConfigError && /DISCORD_TOKEN_MANAGER/.test(err.message))
  assert.throws(() => instance.kb('nope'), err => err instanceof ConfigError && /nope/.test(err.message))
})

test('locate tells which KB and role a channel belongs to', () => {
  const { ws } = makeWorkspace({ kbs: ['alpha', 'beta'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const beta = instance.kb('beta')
  assert.deepEqual(instance.locate(beta.discord.general_id), { session: 'beta', kb: 'beta', role: 'general', agent: 'manager' })
  assert.deepEqual(instance.locate(beta.discord.agents.coder), { session: 'beta', kb: 'beta', role: 'agent', agent: 'coder' })
  assert.deepEqual(instance.locate(snowflake(3)), { session: 'router', kb: null, role: 'global', agent: 'manager' })
  assert.equal(instance.locate('123'), null)
})
