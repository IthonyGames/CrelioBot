// Team administration from Discord: agents on and off, channels and roles, bots — approved by the
// owner, applied live (the running MCP server and the plugin's access.json follow the Workspace).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_TEAM, loadInstance } from '../src/instance.mjs'
import { accessFor } from '../src/runtime.mjs'
import { makeWorkspace, REPO, snowflake } from './helpers.mjs'
import { startFakeDiscord } from './fake-discord.mjs'
import { startMcp } from './mcp-client.mjs'

// alpha: a new KB with the default team (3 Specialists). beta: an older profile (every agent on, "disabled" list).
async function setup() {
  const minimal = { category_id: snowflake(100), general_id: snowflake(101), agents: Object.fromEntries(DEFAULT_TEAM.map((a, i) => [a, snowflake(110 + i)])), roles: {} }
  const { ws } = makeWorkspace({ kbs: ['alpha', 'beta'], profiles: { alpha: { agents: { enabled: [...DEFAULT_TEAM], custom: [] }, discord: minimal }, beta: { agents: { disabled: ['lawyer'], custom: [] } } } })
  const instance = loadInstance(ws, { repoDir: REPO })
  const channels = [{ id: instance.globalGeneralId }]
  for (const id of ['alpha', 'beta']) {
    const d = instance.kb(id).discord
    channels.push({ id: d.category_id, type: 4, name: id }, { id: d.general_id, parent_id: d.category_id, name: 'general' }, ...Object.entries(d.agents).map(([a, c]) => ({ id: c, parent_id: d.category_id, name: a })))
  }
  const bots = Object.fromEntries(Object.entries(instance.settings.bots).map(([k, b]) => [`token-${b.token_env}`, { id: b.user_id, username: k, bot: true }]))
  bots['token-finances'] = { id: snowflake(9500), username: 'Finances', bot: true }
  const fake = await startFakeDiscord({ guildId: instance.guildId, channels, bots })
  const env = id => ({ CRELIO_SESSION: id, CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api, CRELIO_DISCORD_GATEWAY: 'off' })
  const say = (chat, author, text = 'yes') => ({ approval_chat_id: chat, approval_message_id: fake.addMessage(chat, { content: text, author: { id: author, username: 'someone' } }).id })
  const owner = instance.settings.server.owner_id
  const profile = id => JSON.parse(readFileSync(join(ws, 'kbs', `${id}.json`), 'utf8'))
  const access = id => JSON.parse(readFileSync(join(ws, 'state', id, 'discord', 'access.json'), 'utf8'))
  return { ws, instance, fake, env, say, owner, profile, access, alpha: instance.kb('alpha').discord, beta: instance.kb('beta').discord }
}

test('a new team is the Manager and the default Specialists; the rest is listed as available', async () => {
  const { instance, fake, env } = await setup()
  const kb = startMcp(env('alpha'))
  const { data } = await kb.call('team', {})
  await kb.close(); await fake.close()
  assert.deepEqual(data.agents.map(a => a.id), ['manager', 'kb-researcher', 'web-researcher', 'planner'])
  assert.deepEqual(data.available, ['brainstormer', 'artist', 'ux-expert', 'marketing', 'lawyer', 'coder'])
  assert.deepEqual(instance.agentsFor('beta').filter(a => a !== 'manager').length, 8, 'an older profile keeps every agent but the disabled ones')
  assert.ok(!Object.keys(accessFor(instance, 'beta').groups).includes(instance.kb('beta').discord.agents.lawyer), 'a disabled agent\'s channel is not heard')
})

test('agent_enable turns an agent on live: channel, role, access and roster without a restart', async () => {
  const { fake, env, say, owner, profile, access, alpha } = await setup()
  const kb = startMcp(env('alpha'))
  const res = await kb.call('agent_enable', { agent: 'artist', ...say(alpha.general_id, owner, 'active l\'Artist') })
  const { data: team } = await kb.call('team', {})
  await kb.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  assert.equal(res.data.bot_ready, true)
  assert.match(res.data.next, /no restart/)
  const ch = fake.state.channels.get(res.data.channel_id)
  assert.equal(ch.name, 'artist')
  assert.equal(ch.parent_id, alpha.category_id)
  assert.ok(fake.state.roles.some(r => r.id === res.data.role_id && /Artist/.test(r.name)))
  assert.deepEqual(profile('alpha').agents.enabled, ['kb-researcher', 'web-researcher', 'planner', 'artist'])
  assert.ok(Object.keys(access('alpha').groups).includes(res.data.channel_id), 'the plugin hears the new channel')
  assert.ok(team.agents.some(a => a.id === 'artist' && a.channel_id === res.data.channel_id), 'the running session sees the new roster')
})

test('administration needs a recent message from the owner, in the session\'s own channels', async () => {
  const { fake, env, say, owner, alpha, beta } = await setup()
  const kb = startMcp(env('alpha'))
  const none = await kb.call('agent_enable', { agent: 'artist' })
  const stranger = await kb.call('agent_enable', { agent: 'artist', ...say(alpha.general_id, '380127725123403779') })
  const elsewhere = await kb.call('agent_enable', { agent: 'artist', ...say(beta.general_id, owner) })
  const old = { approval_chat_id: alpha.general_id, approval_message_id: fake.addMessage(alpha.general_id, { content: 'ok', author: { id: owner }, timestamp: '2026-01-01T00:00:00.000Z' }).id }
  const stale = await kb.call('agent_enable', { agent: 'artist', ...old })
  const unknown = await kb.call('agent_enable', { agent: 'astronaut', ...say(alpha.general_id, owner) })
  const otherKb = await kb.call('agent_enable', { agent: 'artist', kb: 'beta', ...say(alpha.general_id, owner) })
  await kb.close(); await fake.close()
  assert.match(none.text, /needs the owner's approval/)
  assert.match(stranger.text, /not from the owner/)
  assert.match(elsewhere.text, /outside this KB/)
  assert.match(stale.text, /more than a day old/)
  assert.match(unknown.text, /not an agent of this Instance.*agent-creator/)
  assert.match(otherKb.text, /administers only its own team/)
  assert.equal(fake.state.requests.filter(r => r.method === 'POST' && /\/(channels|roles)$/.test(r.path) && r.path.startsWith('/guilds')).length, 0, 'nothing was created')
})

test('agent_disable turns an agent off and deletes its channel and role; an older profile becomes an explicit list', async () => {
  const { ws, fake, env, say, owner, profile, access, beta } = await setup()
  fake.state.roles.push({ id: snowflake(7777), name: 'Coder · BETA' })
  const p = profile('beta'); p.discord.roles = { coder: snowflake(7777) }
  writeFileSync(join(ws, 'kbs', 'beta.json'), JSON.stringify(p))
  const kb = startMcp(env('beta'))
  const res = await kb.call('agent_disable', { agent: 'coder', ...say(beta.general_id, owner, 'enlève le Coder') })
  const again = await kb.call('agent_disable', { agent: 'coder' })
  await kb.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  assert.equal(res.data.removed.channel_id, beta.agents.coder)
  assert.ok(!fake.state.channels.has(beta.agents.coder), 'channel deleted')
  assert.ok(!fake.state.roles.some(r => r.id === snowflake(7777)), 'role deleted')
  const after = profile('beta')
  assert.equal(after.agents.disabled, undefined)
  assert.deepEqual(after.agents.enabled, ['kb-researcher', 'web-researcher', 'brainstormer', 'artist', 'ux-expert', 'marketing', 'planner'])
  assert.equal(after.discord.agents.coder, undefined)
  assert.ok(!Object.keys(access('beta').groups).includes(beta.agents.coder))
  assert.equal(again.data.note, 'already off', 'no approval needed for a no-op')
})

test('the Router administers any KB, and the KB\'s running session follows', async () => {
  const { fake, env, say, owner, instance } = await setup()
  const alpha = startMcp(env('alpha'))
  await alpha.call('team', {})
  const router = startMcp(env('router'))
  const res = await router.call('agent_enable', { agent: 'lawyer', kb: 'alpha', ...say(instance.globalGeneralId, owner, 'turn on the Lawyer in alpha') })
  const missingKb = await router.call('agent_enable', { agent: 'lawyer', ...say(instance.globalGeneralId, owner) })
  await new Promise(r => setTimeout(r, 1100)) // the live Instance re-checks the Workspace at most once a second
  const { data } = await alpha.call('team', {})
  await router.close(); await alpha.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  assert.match(missingKb.text, /kb is required/)
  assert.ok(data.agents.some(a => a.id === 'lawyer'), 'alpha sees the Lawyer without a restart')
})

test('discord_admin creates and deletes the team\'s own channels and roles, never the General or an Agent channel', async () => {
  const { fake, env, say, owner, profile, access, alpha, beta } = await setup()
  const kb = startMcp(env('alpha'))
  const voice = await kb.call('discord_admin', { action: 'create_channel', name: 'Appel', voice: true, ...say(alpha.general_id, owner) })
  const where = await kb.call('whereami', { chat_id: voice.data.channel_id })
  const general = await kb.call('discord_admin', { action: 'delete_channel', id: alpha.general_id, ...say(alpha.general_id, owner) })
  const agentCh = await kb.call('discord_admin', { action: 'delete_channel', id: alpha.agents.planner, ...say(alpha.general_id, owner) })
  const foreign = await kb.call('discord_admin', { action: 'delete_channel', id: beta.general_id, ...say(alpha.general_id, owner) })
  const role = await kb.call('discord_admin', { action: 'create_role', name: 'Investisseurs', ...say(alpha.general_id, owner) })
  const delRole = await kb.call('discord_admin', { action: 'delete_role', id: role.data.role_id, ...say(alpha.general_id, owner) })
  const serverRole = await kb.call('discord_admin', { action: 'delete_role', id: snowflake(1), ...say(alpha.general_id, owner) })
  const del = await kb.call('discord_admin', { action: 'delete_channel', id: voice.data.channel_id, ...say(alpha.general_id, owner) })
  await kb.close(); await fake.close()
  assert.equal(voice.isError, false, voice.text)
  assert.equal(fake.state.requests.find(r => r.method === 'POST' && r.json?.name === 'appel').json.type, 2, 'a voice channel')
  assert.equal(where.data.role, 'channel')
  assert.match(general.text, /General cannot be deleted/)
  assert.match(agentCh.text, /agent_disable\(agent: "planner"\)/)
  assert.match(foreign.text, /outside this KB|not in this KB's category/)
  assert.equal(delRole.isError, false, delRole.text)
  assert.match(serverRole.text, /only deletes roles it created/)
  assert.equal(del.isError, false, del.text)
  assert.deepEqual(profile('alpha').discord.channels, {})
  assert.ok(!Object.keys(access('alpha').groups).includes(voice.data.channel_id))
})

test('bot_register activates a bot whose token the owner put in .env, and returns its invite link', async () => {
  const { ws, fake, env, say, owner, alpha } = await setup()
  const kb = startMcp(env('alpha'))
  appendFileSync(join(ws, '.env'), 'DISCORD_TOKEN_FINANCES=token-finances\n')
  fake.state.notInGuild.add(snowflake(9500))
  const p = JSON.parse(readFileSync(join(ws, 'kbs', 'alpha.json'), 'utf8')); p.agents.custom = ['finances']
  writeFileSync(join(ws, 'kbs', 'alpha.json'), JSON.stringify(p))
  await new Promise(r => setTimeout(r, 1100))
  const res = await kb.call('bot_register', { agent: 'finances', ...say(alpha.general_id, owner, 'le token est dans .env') })
  await kb.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  assert.equal(res.data.registered, true)
  assert.equal(res.data.in_server, false)
  assert.match(res.data.invite_url, new RegExp(`client_id=${snowflake(9500)}`))
  const settings = JSON.parse(readFileSync(join(ws, 'crelio.json'), 'utf8'))
  assert.deepEqual(settings.bots.finances, { token_env: 'DISCORD_TOKEN_FINANCES', user_id: snowflake(9500), app_id: snowflake(9500) })
  assert.doesNotMatch(JSON.stringify(res.data), /token-finances/, 'the token never leaves the tool')
})

test('bot_register without a token gives the owner the Portal steps — tokens never go through Discord', async () => {
  const { fake, env } = await setup()
  const router = startMcp(env('router'))
  const res = await router.call('bot_register', { agent: 'video-editor' })
  await router.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  assert.equal(res.data.registered, false)
  assert.match(res.data.next, /New Application.*"Video Editor".*workspace\/\.env on the PC \(DISCORD_TOKEN_VIDEO_EDITOR=…\), never into Discord/s)
})

test('an agent created after the session started is dispatched as general-purpose with its definition', async () => {
  const { instance, fake, env, say, owner, alpha } = await setup()
  const def = '---\nname: finances\ndescription: Finances on a CrelioBot team — budgets and statements.\nmodel: sonnet\n---\n\nYou are **Finances**.\n'
  const kb = startMcp(env('alpha'))
  const res = await kb.call('provision_agent', { agent: 'finances', definition: def, ...say(alpha.general_id, owner, 'crée un agent Finances') })
  const { data } = await kb.call('team', {})
  await kb.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  const fin = data.agents.find(a => a.id === 'finances')
  assert.equal(fin.subagent_type, 'general-purpose', 'the KB had no .claude/agents/ when the session started: Claude Code will not load it live')
  assert.equal(fin.definition, join(instance.kb('alpha').path, '.claude', 'agents', 'finances.md'))
})
