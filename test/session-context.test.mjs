import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadInstance } from '../src/instance.mjs'
import { makeWorkspace, REPO } from './helpers.mjs'
import { startFakeDiscord } from './fake-discord.mjs'
import { startMcp } from './mcp-client.mjs'

const HOOK = join(REPO, 'plugin', 'hooks', 'session-context.mjs')

function runHook(env) {
  // The hook is synchronous from Claude Code's point of view: spawn it and read stdout.
  return new Promise(resolve => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } })
      let out = ''
      child.stdout.on('data', d => (out += d))
      child.on('exit', code => resolve({ code, out }))
    })
  })
}

test('outside a CrelioBot session the hook prints nothing', () => {
  const env = { ...process.env }
  delete env.CRELIO_SESSION
  delete env.CRELIO_WORKSPACE
  const res = spawnSync(process.execPath, [HOOK], { env, encoding: 'utf8' })
  assert.equal(res.status, 0)
  assert.equal(res.stdout, '')
})

test('a KB session starts knowing its team, Schedules, open threads and Team learnings', async () => {
  const { ws } = makeWorkspace({
    kbs: ['alpha'],
    profiles: { alpha: { schedules: [{ id: 'morning-brief', cron: '0 8 * * 1-5', prompt: 'Post the morning brief' }] } },
  })
  mkdirSync(join(ws, 'learnings'), { recursive: true })
  writeFileSync(join(ws, 'learnings', 'team.md'), '# Team learnings\n\n- 2026-10-09 [alpha] (lawyer) Check copy before posting\n')
  const instance = loadInstance(ws, { repoDir: REPO })
  const a = instance.kb('alpha').discord
  const bots = Object.fromEntries(Object.entries(instance.settings.bots).map(([k, b]) => [`token-${b.token_env}`, { id: b.user_id, username: k, bot: true }]))
  const fake = await startFakeDiscord({ guildId: instance.guildId, channels: [a.general_id, ...Object.values(a.agents)].map(id => ({ id, name: id })), bots })
  const env = { CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api }

  const req = fake.addMessage(a.general_id, { content: 'Build the pricing page', author: { id: '42', username: 'anthony' } })
  const mcp = startMcp(env)
  await mcp.call('thread_open', { chat_id: a.general_id, message_id: req.id, name: 'Pricing page — anthony', requester: '42' })
  await mcp.call('post', { agent: 'kb-researcher', chat_id: req.id, text: 'Prices live in product/pricing.md' })
  await mcp.close()

  const { code, out } = await runHook(env)
  await fake.close()
  assert.equal(code, 0)
  assert.match(out, /# CrelioBot — ALPHA team/)
  assert.match(out, /Language for everything posted: \*\*fr\*\*/)
  assert.match(out, /Coder \(`coder`\)/)
  assert.match(out, /morning-brief.*0 8 \* \* 1-5/)
  assert.match(out, /«Pricing page — anthony» — chat_id \d+/)
  assert.match(out, /requester <@42>/)
  assert.match(out, /kb-researcher \(agent\).*Prices live in product\/pricing\.md/)
  assert.match(out, /Check copy before posting/)
  assert.ok(out.length <= 9000)
})

test('the Router starts knowing every KB and its session name', async () => {
  const { ws } = makeWorkspace({ kbs: ['alpha', 'beta'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const fake = await startFakeDiscord({ guildId: instance.guildId, channels: [{ id: instance.globalGeneralId }], bots: {} })
  const { out } = await runHook({ CRELIO_SESSION: 'router', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api })
  await fake.close()
  assert.match(out, /Router session/)
  assert.match(out, /\*\*ALPHA\*\* \(id `alpha`.*session `crelio-alpha`/)
  assert.match(out, /\*\*BETA\*\* \(id `beta`.*session `crelio-beta`/)
})

test('when Discord is unreachable the hook still starts the session with what it knows', async () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const { code, out } = await runHook({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: 'http://127.0.0.1:9/api/v10' })
  assert.equal(code, 0)
  assert.match(out, /ALPHA team/)
  assert.match(out, /Could not read them at start/)
})
