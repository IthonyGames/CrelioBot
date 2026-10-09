import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadInstance } from '../src/instance.mjs'
import { makeWorkspace, REPO } from './helpers.mjs'
import { startFakeDiscord } from './fake-discord.mjs'
import { startMcp } from './mcp-client.mjs'

let fake, ws, instance, alpha, beta, mcp
const tokenOf = agent => `token-${instance.settings.bots[agent].token_env}`
const userOf = agent => instance.settings.bots[agent].user_id

before(async () => {
  ;({ ws } = makeWorkspace({ kbs: ['alpha', 'beta'] }))
  instance = loadInstance(ws, { repoDir: REPO })
  alpha = instance.kb('alpha').discord
  beta = instance.kb('beta').discord
  const channels = [instance.globalGeneralId, alpha.general_id, ...Object.values(alpha.agents), beta.general_id, ...Object.values(beta.agents)]
    .map(id => ({ id, name: `ch-${id.slice(-3)}` }))
  const bots = Object.fromEntries(Object.keys(instance.settings.bots).map(a => [tokenOf(a), { id: userOf(a), username: a, bot: true }]))
  fake = await startFakeDiscord({ guildId: instance.guildId, channels, bots })
  mcp = startMcp({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api })
  await mcp.request('initialize', { protocolVersion: '2025-06-18' })
})
after(async () => { await mcp.close(); await fake.close() })

test('the server lists the team tools', async () => {
  const res = await mcp.request('tools/list')
  const names = res.result.tools.map(t => t.name)
  for (const n of ['post', 'thread_open', 'thread_close', 'thread_list', 'thread_history', 'thread_meta', 'whereami', 'team_learning']) assert.ok(names.includes(n), n)
})

test('an agent posts through its own bot, with link previews suppressed', async () => {
  const before = fake.posts().length
  const res = await mcp.call('post', { agent: 'coder', chat_id: alpha.general_id, text: 'Done — see https://example.com' })
  assert.equal(res.isError, false, res.text)
  const req = fake.posts().slice(before)
  assert.equal(req.length, 1)
  assert.equal(req[0].token, tokenOf('coder'))
  assert.equal(req[0].path, `/channels/${alpha.general_id}/messages`)
  assert.equal(req[0].json.flags & 4, 4)
  assert.deepEqual(req[0].json.allowed_mentions.parse, ['users', 'roles'])
})

test('long text is split into messages of at most 2000 characters', async () => {
  const before = fake.posts().length
  const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}: ${'x'.repeat(80)}`).join('\n\n')
  const res = await mcp.call('post', { agent: 'planner', chat_id: alpha.general_id, text })
  assert.equal(res.isError, false, res.text)
  const sent = fake.posts().slice(before).map(r => r.json.content)
  assert.ok(sent.length > 1)
  assert.ok(sent.every(c => c.length <= 2000))
  assert.equal(sent.join('\n\n'), text)
})

test('a code block cut in two is closed and reopened', async () => {
  const before = fake.posts().length
  const code = Array.from({ length: 80 }, (_, i) => `const line${i} = ${i} // ${'y'.repeat(30)}`).join('\n')
  await mcp.call('post', { agent: 'coder', chat_id: alpha.general_id, text: '```js\n' + code + '\n```' })
  const sent = fake.posts().slice(before).map(r => r.json.content)
  assert.ok(sent.length > 1)
  for (const c of sent) assert.equal((c.match(/^```/gm) ?? []).length % 2, 0, 'balanced fences in every message')
  assert.ok(sent[1].startsWith('```js\n'))
})

test('a KB session cannot post in another KB or the Global General', async () => {
  const before = fake.posts().length
  for (const chat_id of [beta.general_id, beta.agents.coder, instance.globalGeneralId]) {
    const res = await mcp.call('post', { agent: 'manager', chat_id, text: 'hello' })
    assert.equal(res.isError, true)
    assert.match(res.text, /outside this KB/)
  }
  assert.equal(fake.posts().length, before, 'nothing was sent')
})

test('unknown agents and agents without a token are refused with the fix', async () => {
  const unknown = await mcp.call('post', { agent: 'pirate', chat_id: alpha.general_id, text: 'arr' })
  assert.match(unknown.text, /unknown agent "pirate"/)
  writeFileSync(join(ws, '.env'), Object.values(instance.settings.bots).filter(b => !b.token_env.endsWith('LAWYER')).map(b => `${b.token_env}=token-${b.token_env}`).join('\n'))
  const solo = startMcp({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api })
  const res = await solo.call('post', { agent: 'lawyer', chat_id: alpha.general_id, text: 'hi' })
  await solo.close()
  assert.match(res.text, /crelio bot add lawyer/)
})

test('the Manager opens a Task thread on the request; opening it again returns the same thread', async () => {
  const request = fake.addMessage(alpha.general_id, { content: 'Redesign the landing page', author: { id: '42', username: 'anthony' } })
  const first = await mcp.call('thread_open', { agent: 'manager', chat_id: alpha.general_id, message_id: request.id, name: 'Landing page — anthony', requester: '42' })
  assert.equal(first.isError, false, first.text)
  assert.equal(first.data.thread_id, request.id)
  assert.equal(first.data.kind, 'task')
  assert.equal(first.data.requester, '42')
  assert.equal(first.data.created, true)
  const again = await mcp.call('thread_open', { agent: 'manager', chat_id: alpha.general_id, message_id: request.id, name: 'Landing page — anthony' })
  assert.equal(again.data.thread_id, request.id)
  assert.equal(again.data.created, false)
})

test('a Specialist posts in the Task thread under its own bot', async () => {
  const request = fake.addMessage(alpha.general_id, { content: 'Research competitors', author: { id: '42', username: 'anthony' } })
  const { data: thread } = await mcp.call('thread_open', { chat_id: alpha.general_id, message_id: request.id, name: 'Competitors' })
  const res = await mcp.call('post', { agent: 'kb-researcher', chat_id: thread.thread_id, text: 'Here is what the KB says…' })
  assert.equal(res.isError, false, res.text)
  const last = fake.posts().at(-1)
  assert.equal(last.path, `/channels/${thread.thread_id}/messages`)
  assert.equal(last.token, tokenOf('kb-researcher'))
})

test('a thread under another KB is out of scope', async () => {
  const foreign = fake.addMessage(beta.general_id, { content: 'beta task', author: { id: '42', username: 'anthony' } })
  fake.state.channels.set(foreign.id, { id: foreign.id, type: 11, parent_id: beta.general_id, guild_id: instance.guildId, name: 'beta thread', thread_metadata: { archived: false } })
  const res = await mcp.call('post', { agent: 'manager', chat_id: foreign.id, text: 'sneaky' })
  assert.equal(res.isError, true)
})

test('a thread opened in an Agent channel is that agent\'s Side thread', async () => {
  const res = await mcp.call('thread_open', { agent: 'artist', chat_id: alpha.agents.artist, name: 'Palette exploration', parent: '123456789012345678' })
  assert.equal(res.data.kind, 'side')
  assert.equal(res.data.agent, 'artist')
  assert.equal(res.data.parent, '123456789012345678')
})

test('the thread registry survives a server restart', async () => {
  const req = fake.addMessage(alpha.general_id, { content: 'Persist me', author: { id: '42', username: 'anthony' } })
  await mcp.call('thread_open', { chat_id: alpha.general_id, message_id: req.id, name: 'Persist' })
  await mcp.call('thread_meta', { chat_id: req.id, patch: { hops: 3, task_id: 'T-7', waiting_on: { agent: 'brainstormer', person: '42' } } })
  const fresh = startMcp({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api })
  const res = await fresh.call('thread_meta', { chat_id: req.id })
  await fresh.close()
  assert.equal(res.data.hops, 3)
  assert.equal(res.data.task_id, 'T-7')
  assert.deepEqual(res.data.waiting_on, { agent: 'brainstormer', person: '42' })
  const bad = await mcp.call('thread_meta', { chat_id: req.id, patch: { evil: true } })
  assert.match(bad.text, /unknown fields: evil/)
})

test('whereami names the agent whose question a person answered', async () => {
  const req = fake.addMessage(alpha.general_id, { content: 'Pick a palette', author: { id: '42', username: 'anthony' } })
  const { data: th } = await mcp.call('thread_open', { chat_id: alpha.general_id, message_id: req.id, name: 'Palette' })
  const { data: q } = await mcp.call('post', { agent: 'brainstormer', chat_id: th.thread_id, text: '<@42> Q1 — warm or cool palette?' })
  const answer = fake.addMessage(th.thread_id, { content: 'warm', author: { id: '42', username: 'anthony' }, type: 19, message_reference: { message_id: q.message_ids[0], channel_id: th.thread_id } })
  const res = await mcp.call('whereami', { chat_id: th.thread_id, message_id: answer.id })
  assert.equal(res.data.role, 'general')
  assert.equal(res.data.is_thread, true)
  assert.equal(res.data.thread.kind, 'task')
  assert.equal(res.data.author.agent, null)
  assert.equal(res.data.replied_to.agent, 'brainstormer')
})

test('thread_list shows only this KB\'s open threads, and thread_close archives', async () => {
  const req = fake.addMessage(alpha.general_id, { content: 'Close me', author: { id: '42', username: 'anthony' } })
  await mcp.call('thread_open', { chat_id: alpha.general_id, message_id: req.id, name: 'Close me' })
  const listed = (await mcp.call('thread_list', {})).data.threads
  assert.ok(listed.some(t => t.thread_id === req.id))
  for (const t of listed) assert.ok([alpha.general_id, ...Object.values(alpha.agents)].includes(fake.state.channels.get(t.thread_id).parent_id))
  const closed = await mcp.call('thread_close', { chat_id: req.id, summary: 'done' })
  assert.equal(closed.data.status, 'closed')
  assert.equal(fake.state.channels.get(req.id).thread_metadata.archived, true)
  assert.ok(!(await mcp.call('thread_list', {})).data.threads.some(t => t.thread_id === req.id))
})

test('thread_history gives the request and the conversation with agents named', async () => {
  const req = fake.addMessage(alpha.general_id, { content: 'Write the FAQ', author: { id: '42', username: 'anthony' } })
  const { data: th } = await mcp.call('thread_open', { chat_id: alpha.general_id, message_id: req.id, name: 'FAQ' })
  await mcp.call('post', { agent: 'marketing', chat_id: th.thread_id, text: 'Draft ready' })
  const res = await mcp.call('thread_history', { chat_id: th.thread_id })
  assert.match(res.data.request, /anthony .*Write the FAQ/)
  assert.match(res.data.messages.at(-1), /marketing \(agent\).*Draft ready/)
})

test('Discord rate limits are waited out', async () => {
  fake.state.rateLimitOnce.add(`POST /channels/${alpha.general_id}/messages`)
  const res = await mcp.call('post', { agent: 'manager', chat_id: alpha.general_id, text: 'after the wait' })
  assert.equal(res.isError, false, res.text)
})

test('files are attached to the last message', async () => {
  const file = join(ws, 'report.md')
  writeFileSync(file, '# Report')
  await mcp.call('post', { agent: 'planner', chat_id: alpha.general_id, text: 'Plan attached', files: [file] })
  const last = fake.posts().at(-1)
  assert.equal(last.form.payload.content, 'Plan attached')
  assert.deepEqual(last.form.files.map(f => f.name), ['report.md'])
})

test('team learnings go to the Workspace', async () => {
  const res = await mcp.call('team_learning', { text: 'Ask the Lawyer before the Marketing copy is final', agents: ['lawyer', 'marketing'] })
  assert.match(res.data.recorded, /\[alpha\] \(lawyer, marketing\) Ask the Lawyer/)
})
