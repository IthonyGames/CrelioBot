import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadInstance } from '../src/instance.mjs'
import { discordClient } from '../src/discord.mjs'
import { provisionGlobal, provisionKb } from '../src/provision.mjs'
import { makeWorkspace, REPO } from './helpers.mjs'
import { startFakeDiscord } from './fake-discord.mjs'
import { startMcp } from './mcp-client.mjs'

async function setup({ kbs = ['alpha', 'beta'], profiles } = {}) {
  const { ws } = makeWorkspace({ kbs, profiles })
  const instance = loadInstance(ws, { repoDir: REPO })
  const channels = [{ id: instance.globalGeneralId }]
  for (const id of kbs) {
    const d = instance.kb(id).discord
    channels.push({ id: d.category_id, type: 4, name: id.toUpperCase() }, { id: d.general_id, parent_id: d.category_id, name: 'general' }, ...Object.entries(d.agents).map(([a, c]) => ({ id: c, parent_id: d.category_id, name: a })))
  }
  const bots = Object.fromEntries(Object.entries(instance.settings.bots).map(([k, b]) => [`token-${b.token_env}`, { id: b.user_id, username: k, bot: true }]))
  const fake = await startFakeDiscord({ guildId: instance.guildId, channels, bots })
  const env = id => ({ CRELIO_SESSION: id, CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api })
  return { ws, instance, fake, env }
}

const names = async mcp => (await mcp.request('tools/list')).result.tools.map(t => t.name)

test('Router tools exist only in the Router; KB administration only in KB sessions', async () => {
  const { fake, env } = await setup()
  const router = startMcp(env('router'))
  const kb = startMcp(env('alpha'))
  const r = await names(router)
  const k = await names(kb)
  await router.close(); await kb.close(); await fake.close()
  assert.ok(r.includes('route') && r.includes('instance_status') && !r.includes('schedules'))
  assert.ok(k.includes('schedules') && k.includes('provision_agent') && !k.includes('route'))
})

test('a routed request reaches the KB General without a ping, and the request gets a ✅ instead of a reply', async () => {
  const { instance, fake, env } = await setup()
  const router = startMcp(env('router'))
  const request = fake.addMessage(instance.globalGeneralId, { content: 'Add a FAQ page', author: { id: '380127725123403779', username: 'anthony', global_name: 'Anthony' } })
  const res = await router.call('route', { kb: 'beta', text: 'Add a FAQ page\nwith 5 questions', author_id: '380127725123403779', source_message_id: request.id })
  const bad = await router.call('route', { kb: 'nope', text: 'x' })
  await router.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  assert.equal(res.data.chat_id, instance.kb('beta').discord.general_id)
  assert.equal(res.data.session_name, 'crelio-beta')
  const sent = fake.posts().at(-1)
  assert.equal(sent.token, `token-${instance.settings.bots.manager.token_env}`)
  assert.match(sent.json.content, /^📨 \*\*Anthony\*\*/)
  assert.doesNotMatch(sent.json.content, /<@/, 'the author is named, not mentioned')
  assert.match(sent.json.content, /> Add a FAQ page\n> with 5 questions/)
  assert.deepEqual(sent.json.allowed_mentions, { parse: [] })
  assert.equal(sent.json.flags & 4096, 4096, 'silent: no push notification')
  assert.equal(fake.posts().filter(p => p.path === `/channels/${instance.globalGeneralId}/messages`).length, 0, 'nothing posted in the Global General')
  const reaction = fake.state.requests.find(r => r.method === 'PUT' && r.path.includes(`/messages/${request.id}/reactions/`))
  assert.ok(reaction && decodeURIComponent(reaction.path).includes('✅'))
  assert.match(bad.text, /Unknown KB "nope"/)
})

test('a routed request carries its attachments into the KB General', async () => {
  const { instance, fake, env } = await setup()
  const base = fake.api.replace('/api/v10', '')
  fake.state.files.set('901', Buffer.from('png-bytes'))
  const request = fake.addMessage(instance.globalGeneralId, {
    content: 'icons like this', author: { id: '380127725123403779', username: 'anthony' },
    attachments: [{ id: '901', filename: 'style.png', size: 9, url: `${base}/files/901` }],
  })
  const router = startMcp(env('router'))
  const res = await router.call('route', { kb: 'alpha', text: 'Make agent icons like the attached style', author_id: '380127725123403779', source_message_id: request.id })
  await router.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  assert.deepEqual(res.data.attachments, ['style.png'])
  const sent = fake.posts().at(-1)
  assert.deepEqual(sent.form.files.map(f => [f.name, f.size]), [['style.png', 9]])
  assert.equal(sent.form.payload.flags & 4096, 4096)
})

test('instance_status shows each KB\'s open threads with their records', async () => {
  const { instance, fake, env } = await setup()
  const kb = startMcp(env('alpha'))
  const req = fake.addMessage(instance.kb('alpha').discord.general_id, { content: 'Do X', author: { id: '42' } })
  await kb.call('thread_open', { chat_id: instance.kb('alpha').discord.general_id, message_id: req.id, name: 'Do X', requester: '42' })
  await kb.call('thread_meta', { chat_id: req.id, patch: { waiting_on: { agent: 'lawyer', person: '42' } } })
  await kb.close()
  const router = startMcp(env('router'))
  const res = await router.call('instance_status', {})
  await router.close(); await fake.close()
  const alpha = res.data.kbs.find(k => k.id === 'alpha')
  assert.equal(alpha.open_threads, 1)
  assert.equal(alpha.threads[0].requester, '42')
  assert.deepEqual(alpha.threads[0].waiting_on, { agent: 'lawyer', person: '42' })
  assert.equal(res.data.kbs.find(k => k.id === 'beta').open_threads, 0)
})

test('Schedules are saved in the KB profile, validated, and removable', async () => {
  const { ws, fake, env } = await setup()
  const kb = startMcp(env('alpha'))
  const add = await kb.call('schedules', { action: 'add', id: 'morning-brief', cron: '0 8 * * 1-5', prompt: 'Post the morning brief' })
  const bad = await kb.call('schedules', { action: 'add', id: 'oops', cron: 'every morning', prompt: 'x' })
  const list = await kb.call('schedules', { action: 'list' })
  const del = await kb.call('schedules', { action: 'remove', id: 'morning-brief' })
  await kb.close(); await fake.close()
  assert.match(add.data.next, /CronCreate/)
  assert.match(bad.text, /5 fields/)
  assert.deepEqual(list.data.schedules, [{ id: 'morning-brief', cron: '0 8 * * 1-5', prompt: 'Post the morning brief' }])
  assert.equal(del.data.removed, 'morning-brief')
  assert.deepEqual(JSON.parse(readFileSync(join(ws, 'kbs', 'alpha.json'), 'utf8')).schedules, [])
})

test('provision_agent registers a Custom agent and creates its channel and role, once', async () => {
  const { ws, instance, fake, env } = await setup()
  const kb = startMcp(env('alpha'))
  const first = await kb.call('provision_agent', { agent: 'video-editor' })
  const again = await kb.call('provision_agent', { agent: 'video-editor' })
  await kb.close(); await fake.close()
  assert.equal(first.isError, false, first.text)
  assert.equal(first.data.bot_ready, false)
  assert.match(first.data.next, /crelio bot add video-editor/)
  assert.equal(again.data.channel_id, first.data.channel_id)
  assert.equal(again.data.role_id, first.data.role_id)
  const created = fake.state.requests.filter(r => r.method === 'POST' && /\/guilds\/\d+\/(channels|roles)$/.test(r.path))
  assert.equal(created.length, 2, 'one channel and one role, only the first time')
  const ch = fake.state.channels.get(first.data.channel_id)
  assert.equal(ch.name, 'video-editor')
  assert.equal(ch.parent_id, instance.kb('alpha').discord.category_id)
  const profile = JSON.parse(readFileSync(join(ws, 'kbs', 'alpha.json'), 'utf8'))
  assert.deepEqual(profile.agents.custom, ['video-editor'])
  assert.equal(profile.discord.agents['video-editor'], first.data.channel_id)
  assert.ok(loadInstance(ws, { repoDir: REPO }).agentsFor('alpha').includes('video-editor'))
})

test('provision_agent writes the definition into the KB, or into the Workspace for every KB from the Router', async () => {
  const { ws, instance, fake, env } = await setup()
  const def = id => `---\nname: ${id}\ndescription: Video editor on a CrelioBot team — cuts and captions videos.\nmodel: sonnet\n---\n\nYou are the **Video Editor**.\n`
  const kb = startMcp(env('alpha'))
  const bad = await kb.call('provision_agent', { agent: 'video-editor', definition: 'no frontmatter' })
  const core = await kb.call('provision_agent', { agent: 'coder', definition: def('coder') })
  const ok = await kb.call('provision_agent', { agent: 'video-editor', definition: def('video-editor') })
  await kb.close()
  const router = startMcp(env('router'))
  const shared = await router.call('provision_agent', { agent: 'translator', definition: def('translator') })
  await router.close(); await fake.close()
  assert.match(bad.text, /frontmatter/)
  assert.match(core.text, /Core agent/)
  assert.equal(ok.isError, false, ok.text)
  assert.match(readFileSync(join(instance.kb('alpha').path, '.claude', 'agents', 'video-editor.md'), 'utf8'), /name: video-editor/)
  assert.equal(shared.isError, false, shared.text)
  assert.ok(shared.data.channels.alpha.channel_id && shared.data.channels.beta.channel_id, 'a channel in every KB')
  assert.match(readFileSync(join(ws, 'plugin', 'agents', 'translator.md'), 'utf8'), /name: translator/)
  assert.equal(JSON.parse(readFileSync(join(ws, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).name, 'crelio-workspace')
  const after = loadInstance(ws, { repoDir: REPO })
  assert.ok(after.agentsFor('beta').includes('translator'))
  assert.ok(!after.agentsFor('beta').includes('video-editor'))
})

test('restart_session ends the recorded session process so the launcher restarts it', async () => {
  const { instance, fake, env } = await setup()
  const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  mkdirSync(instance.stateDir('alpha'), { recursive: true })
  writeFileSync(join(instance.stateDir('alpha'), 'claude.pid'), String(dummy.pid))
  const exited = new Promise(r => dummy.on('exit', () => r(true)))
  const kb = startMcp(env('alpha'))
  const res = await kb.call('restart_session', {})
  const other = await kb.call('restart_session', { kb: 'beta' })
  const ok = await Promise.race([exited, new Promise(r => setTimeout(() => r(false), 8000))])
  await kb.close(); await fake.close()
  assert.equal(res.data.restarting, 'alpha')
  assert.match(other.text, /only restart itself/)
  assert.equal(ok, true, 'the session process was ended')
})

test('provisioning a fresh server creates the layout once and records every ID', async () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'], settings: { global_general: {} }, profiles: { alpha: { discord: {} } } })
  const instance = loadInstance(ws, { repoDir: REPO })
  const fake = await startFakeDiscord({ guildId: instance.guildId, channels: [], bots: {} })
  const client = discordClient('token-DISCORD_TOKEN_MANAGER', { api: fake.api })
  const g1 = await provisionGlobal({ instance, client })
  const k1 = await provisionKb({ instance: loadInstance(ws, { repoDir: REPO }), client, kbId: 'alpha' })
  const before = fake.state.requests.filter(r => r.method === 'POST').length
  const g2 = await provisionGlobal({ instance: loadInstance(ws, { repoDir: REPO }), client })
  const k2 = await provisionKb({ instance: loadInstance(ws, { repoDir: REPO }), client, kbId: 'alpha' })
  const after = fake.state.requests.filter(r => r.method === 'POST').length
  await fake.close()
  assert.equal(after, before, 'second run creates nothing')
  assert.equal(g2.created, false)
  assert.equal(k2.created, false)
  assert.deepEqual(k2.agents, k1.agents)
  assert.equal(Object.keys(k1.agents).length, 9)
  assert.equal(Object.keys(k1.roles).length, 10)
  const reloaded = loadInstance(ws, { repoDir: REPO })
  assert.equal(reloaded.globalGeneralId, g1.channel_id)
  assert.equal(reloaded.kb('alpha').discord.general_id, k1.general_id)
  assert.equal(fake.state.channels.get(k1.general_id).parent_id, k1.category_id)
})
