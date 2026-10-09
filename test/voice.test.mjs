import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadInstance } from '../src/instance.mjs'
import { makeWorkspace, REPO } from './helpers.mjs'
import { startFakeDiscord } from './fake-discord.mjs'
import { startMcp } from './mcp-client.mjs'

async function setup({ ttsFormat } = {}) {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const a = instance.kb('alpha').discord
  const bots = Object.fromEntries(Object.entries(instance.settings.bots).map(([k, b]) => [`token-${b.token_env}`, { id: b.user_id, username: k, bot: true }]))
  const fake = await startFakeDiscord({ guildId: instance.guildId, channels: [a.general_id, ...Object.values(a.agents)].map(id => ({ id })), bots, ttsFormat })
  const base = fake.api.replace('/api/v10', '')
  const mcp = startMcp({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api, CRELIO_OPENAI_API: `${base}/v1` })
  return { ws, instance, a, fake, base, mcp, done: async () => { await mcp.close(); await fake.close() } }
}

test('a person\'s Voice note is transcribed in the KB language', async () => {
  const { a, fake, base, mcp, done } = await setup()
  fake.state.files.set('777', Buffer.from('fake-ogg-bytes'))
  const msg = fake.addMessage(a.general_id, {
    flags: 8192,
    author: { id: '42', username: 'anthony' },
    attachments: [{ id: '777', filename: 'voice-message.ogg', content_type: 'audio/ogg', size: 14, duration_secs: 3, url: `${base}/files/777` }],
  })
  const res = await mcp.call('transcribe', { chat_id: a.general_id, message_id: msg.id })
  await done()
  assert.equal(res.isError, false, res.text)
  assert.equal(res.data.text, 'transcribed voice-message.ogg (14 bytes)')
  assert.equal(res.data.voice_message, true)
  const call = fake.state.requests.find(r => r.path === '/v1/audio/transcriptions')
  assert.equal(call.model, 'whisper-1')
  assert.equal(call.language, 'fr')
  assert.equal(call.auth, 'Bearer sk-test')
})

test('a message without audio is refused', async () => {
  const { a, fake, mcp, done } = await setup()
  const msg = fake.addMessage(a.general_id, { content: 'just text', author: { id: '42' } })
  const res = await mcp.call('transcribe', { chat_id: a.general_id, message_id: msg.id })
  await done()
  assert.match(res.text, /no audio attachment/)
})

test('an agent answers with a real Discord voice message from its own bot', async () => {
  const { instance, a, fake, mcp, done } = await setup()
  const res = await mcp.call('speak', { agent: 'manager', chat_id: a.general_id, text: 'Voici le résumé de la tâche.' })
  await done()
  assert.equal(res.isError, false, res.text)
  assert.equal(res.data.voice_message, true)
  const tts = fake.state.requests.find(r => r.path === '/v1/audio/speech')
  assert.deepEqual({ ...tts.body, input: undefined }, { model: 'tts-1', voice: 'onyx', speed: 1.4, response_format: 'opus', input: undefined })
  const sent = fake.posts().at(-1)
  assert.equal(sent.token, `token-${instance.settings.bots.manager.token_env}`)
  assert.equal(sent.form.payload.flags, 8192)
  assert.equal(sent.form.payload.content, undefined)
  const att = sent.form.payload.attachments[0]
  assert.equal(att.filename, 'voice-message.ogg')
  assert.equal(att.duration_secs, 2.5)
  assert.ok(Buffer.from(att.waveform, 'base64').length > 0)
  assert.deepEqual(sent.form.files.map(f => f.name), ['voice-message.ogg'])
})

test('when the provider returns another format, the audio is attached instead', async () => {
  const { a, fake, mcp, done } = await setup({ ttsFormat: 'mp3' })
  const res = await mcp.call('speak', { agent: 'coder', chat_id: a.general_id, text: 'Done.' })
  await done()
  assert.equal(res.data.voice_message, false)
  const sent = fake.posts().at(-1)
  assert.equal(sent.form.payload.flags & 8192, 0)
  assert.deepEqual(sent.form.files.map(f => f.name), ['voice-reply.mp3'])
})

test('long text and a missing API key are refused with the fix', async () => {
  const { ws, a, mcp, done } = await setup()
  const long = await mcp.call('speak', { agent: 'manager', chat_id: a.general_id, text: 'x'.repeat(5000) })
  assert.match(long.text, /too long to speak/)
  writeFileSync(join(ws, '.env'), readFileSync(join(ws, '.env'), 'utf8').replace(/^OPENAI_API_KEY=.*$/m, ''))
  await done()
  const again = await setup()
  writeFileSync(join(again.ws, '.env'), readFileSync(join(again.ws, '.env'), 'utf8').replace(/^OPENAI_API_KEY=.*$/m, ''))
  const fresh = startMcp({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: again.ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: again.fake.api, CRELIO_OPENAI_API: `${again.base}/v1` })
  const res = await fresh.call('speak', { agent: 'manager', chat_id: again.a.general_id, text: 'hi' })
  await fresh.close()
  await again.done()
  assert.match(res.text, /Missing OPENAI_API_KEY/)
})
