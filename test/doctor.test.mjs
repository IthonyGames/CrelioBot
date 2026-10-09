import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctor } from '../src/commands/doctor.mjs'
import { loadInstance } from '../src/instance.mjs'
import { makeWorkspace, REPO } from './helpers.mjs'

function fakeClients(instance, { noIntent = false, notInGuild = [], missingChannels = [] } = {}) {
  const byToken = Object.fromEntries(Object.entries(instance.settings.bots).map(([a, b]) => [`token-${b.token_env}`, a]))
  const channels = [instance.globalGeneralId, ...[...instance.kbs.values()].flatMap(k => [k.discord.general_id, ...Object.values(k.discord.agents)])]
    .filter(id => !missingChannels.includes(id)).map(id => ({ id }))
  return token => ({
    get: async path => {
      const agent = byToken[token]
      if (path === '/applications/@me') return { id: '1', flags: agent === 'manager' && noIntent ? 0 : 1 << 19 }
      if (path === `/guilds/${instance.guildId}`) { if (notInGuild.includes(agent)) throw new Error('Unknown Guild'); return { id: instance.guildId } }
      if (path === `/guilds/${instance.guildId}/channels`) return channels
      throw new Error(`unexpected ${path}`)
    },
  })
}

// An environment whose PATH has (or lacks) claude, bun, and a Claude config with (or without) the plugin.
function fakeEnv({ claude = true, bun = true, plugin = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'crelio-env-'))
  const ext = process.platform === 'win32' ? '.cmd' : ''
  if (claude) writeFileSync(join(dir, `claude${ext}`), process.platform === 'win32' ? '@echo 9.9.9 (Claude Code)' : '#!/bin/sh\necho "9.9.9 (Claude Code)"', { mode: 0o755 })
  if (bun) writeFileSync(join(dir, `bun${ext}`), '', { mode: 0o755 })
  const config = join(dir, 'claude-config')
  mkdirSync(join(config, 'plugins'), { recursive: true })
  writeFileSync(join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: plugin ? { 'discord@claude-plugins-official': [] } : {} }))
  return { PATH: dir, CLAUDE_CONFIG_DIR: config }
}

const fails = results => results.filter(r => r.level === 'fail').map(r => r.m).join('\n')

test('a healthy Instance passes', async () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const results = await runDoctor({ workspace: ws, repoDir: REPO, clientFor: fakeClients(instance), env: fakeEnv() })
  assert.equal(fails(results), '')
})

test('missing Bun, Discord plugin and Claude Code are reported with the fix', async () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const results = await runDoctor({ workspace: ws, repoDir: REPO, clientFor: fakeClients(instance), env: fakeEnv({ claude: false, bun: false, plugin: false }) })
  const text = fails(results)
  assert.match(text, /Claude Code \(claude\) not found/)
  assert.match(text, /Bun not found/)
  assert.match(text, /Discord channel plugin not installed/)
  assert.ok(results.find(r => /plugin not installed/.test(r.m)).fix.includes('/plugin install discord@claude-plugins-official'))
})

test('a Manager without Message Content Intent, a bot outside the server and a deleted channel are reported', async () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const gone = instance.kb('alpha').discord.agents.lawyer
  const results = await runDoctor({ workspace: ws, repoDir: REPO, env: fakeEnv(), clientFor: fakeClients(instance, { noIntent: true, notInGuild: ['coder'], missingChannels: [gone] }) })
  const text = fails(results)
  assert.match(text, /Manager: Message Content Intent is off/)
  assert.match(text, /Coder: not in the server/)
  assert.match(text, new RegExp(`#lawyer: channel ${gone} no longer exists`))
  assert.match(results.find(r => /Coder: not in the server/.test(r.m)).fix, /discord\.com\/oauth2\/authorize/)
})
