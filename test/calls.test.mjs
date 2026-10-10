// Calls: the controller (who is in a Call, joining, leaving, utterances, speech) against a fake voice
// adapter; the session inbox protocol; the control server and the session's call tools; Ogg muxing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CALLS, loadInstance } from '../src/instance.mjs'
import { createCalls, postToSession, speakable, speechChunks, startControlServer, writeInboxAddress } from '../src/calls.mjs'
import { keepSpeech, levelDb, speechDetector, voicing } from '../src/vad.mjs'
import { cleanTranscript, voiceProvider } from '../src/voice.mjs'
import { isOggOpus, oggCrc, oggFromOpus, oggPages, oggVoiceInfo } from '../src/ogg.mjs'
import { launchIds } from '../src/launcher.mjs'
import { makeWorkspace, REPO, snowflake } from './helpers.mjs'
import { startFakeDiscord } from './fake-discord.mjs'
import { startMcp } from './mcp-client.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const GUILD = snowflake(1)
const CALL = { alpha: snowflake(190), beta: snowflake(290) }
const ANTHONY = snowflake(2) // the owner in the test Workspace
const speechPackets = (n = 30) => Array.from({ length: n }, (_, i) => Buffer.from([0xfc, i, 1, 2, 3]))

function world({ idle = 120 } = {}) {
  const call = { enabled: true, merge_ms: 15, idle_minutes: idle }
  const { ws } = makeWorkspace({ kbs: ['alpha', 'beta'], profiles: { alpha: { call }, beta: { call } } })
  for (const id of ['alpha', 'beta']) {
    const p = JSON.parse(readFileSync(join(ws, 'kbs', `${id}.json`), 'utf8'))
    p.call = call
    p.discord = { ...p.discord, call_id: CALL[id] }
    writeFileSync(join(ws, 'kbs', `${id}.json`), JSON.stringify(p))
  }
  const instance = loadInstance(ws, { repoDir: REPO })
  const delivered = []
  const posts = []
  const texts = []
  const voiceCalls = { transcribe: [], speak: [] }
  const adapter = {
    channel: null, joins: [], leaves: 0, plays: [], stops: 0, gate: null,
    connectedChannel: () => adapter.channel,
    async join(_, ch) { adapter.channel = ch; adapter.joins.push(ch) },
    async leave() { adapter.channel = null; adapter.leaves++ },
    play(_, audio) { adapter.plays.push(audio.toString()); return adapter.gate ?? Promise.resolve() },
    stop() { adapter.stops++; adapter.open?.() },
  }
  const voice = {
    async transcribe(audio, opts) { voiceCalls.transcribe.push({ ogg: isOggOpus(audio), ...opts }); return texts.shift() ?? '' },
    async speak(text) { voiceCalls.speak.push(text); return Buffer.from(`audio:${text}`) },
  }
  const calls = createCalls({
    instance, adapter, voice: () => voice,
    clientFor: () => ({ post: async (path, body) => { posts.push({ path, ...body }); return { id: '1' } } }),
    deliver: async (kb, text) => { delivered.push({ kb, text }); return true },
  })
  const enter = (kb, user = ANTHONY, name = 'Anthony') => calls.voiceState({ guildId: GUILD, userId: user, name, bot: false, before: null, after: CALL[kb] })
  const exit = (kb, user = ANTHONY, name = 'Anthony') => calls.voiceState({ guildId: GUILD, userId: user, name, bot: false, before: CALL[kb], after: null })
  const speak = (kb, text, user = ANTHONY) => { texts.push(text); calls.utterance({ channelId: CALL[kb], userId: user, name: 'Anthony', packets: speechPackets() }) }
  return { ws, instance, calls, adapter, delivered, posts, voiceCalls, texts, join: enter, leave: exit, speak, last: () => delivered.at(-1)?.text }
}

test('someone joining the KB voice channel starts a Call: the bot joins, greets them at once, and the session is told', async () => {
  const w = world()
  await w.join('alpha')
  await sleep(20)
  assert.deepEqual(w.adapter.joins, [CALL.alpha])
  assert.deepEqual(w.adapter.plays, ['audio:Ici ALPHA. Je t\'écoute.'], 'no wait for the session: it says which KB answers, in the language people speak')
  assert.match(w.last(), /\[Call\] Anthony joined the voice channel <#\d+> — a Call has started\. I greeted them for you \(« Ici ALPHA\. Je t'écoute\. »\): don't greet again/)
  const state = JSON.parse(readFileSync(join(w.instance.stateDir('alpha'), 'call', 'state.json'), 'utf8'))
  assert.equal(state.active, true)
  assert.deepEqual(state.people, ['Anthony'])
})

test('what a person says is transcribed (in the language they speak, not forced to the KB\'s), logged, shown in the call chat and sent to the session', async () => {
  const w = world()
  await w.join('alpha')
  w.speak('alpha', 'Fais-moi le point sur Quillz')
  await sleep(60)
  const t = w.voiceCalls.transcribe[0]
  assert.equal(t.ogg, true)
  assert.equal(t.language, undefined, 'the provider uses voice.language, or detects it')
  assert.match(t.prompt, /ALPHA.*CrelioBot.*KB Researcher/)
  assert.match(w.last(), /🎙️ \[Call\] Anthony \(user \d+, utterance (u1-\w+)\): « Fais-moi le point sur Quillz »/)
  const id = w.last().match(/utterance (u1-\w+)/)[1]
  const logged = readFileSync(join(w.instance.stateDir('alpha'), 'call', 'utterances.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual([logged[0].id, logged[0].user_id, logged[0].text], [id, ANTHONY, 'Fais-moi le point sur Quillz'])
  const chat = w.posts.at(-1)
  assert.equal(chat.path, `/channels/${CALL.alpha}/messages`)
  assert.match(chat.content, /🎙️ \*\*Anthony\*\*: Fais-moi le point/)
  assert.equal(chat.flags & 4096, 4096, 'the transcript is silent')
})

test('a pause mid-sentence does not cut the request in two; noise and too-short sounds are dropped', async () => {
  const w = world()
  await w.join('alpha')
  w.speak('alpha', 'Crée un tableau')
  w.calls.speakingStart({ guildId: GUILD, channelId: CALL.alpha, userId: ANTHONY })
  await sleep(30)
  w.speak('alpha', 'de mes dépenses du mois')
  await sleep(60)
  assert.equal(w.delivered.filter(d => d.text.includes('🎙️')).length, 1)
  assert.match(w.last(), /« Crée un tableau de mes dépenses du mois »/)
  w.calls.utterance({ channelId: CALL.alpha, userId: ANTHONY, packets: speechPackets(9) }) // 180 ms
  w.speak('alpha', 'Sous-titres réalisés par la communauté d\'Amara.org')
  await sleep(60)
  assert.equal(w.delivered.filter(d => d.text.includes('🎙️')).length, 1, 'nothing new reached the session')
})

test('the session speaks: plain spoken text, chunked, played in the call and shown in the chat', async () => {
  const w = world()
  await w.join('alpha')
  await sleep(20)
  const res = await w.calls.say('alpha', '**Fait !** Voir [le fil](https://discord.com/x) <@123> 🎉\n- point un')
  await sleep(20)
  assert.deepEqual(res, { spoken: true, listeners: ['Anthony'] })
  assert.deepEqual(w.voiceCalls.speak.slice(1), ['Fait ! Voir le fil\npoint un'])
  assert.deepEqual(w.adapter.plays.slice(1), ['audio:Fait ! Voir le fil\npoint un'])
  assert.match(w.posts.at(-1).content, /^🔊 Fait !/)
  assert.deepEqual(speechChunks('Un. Deux! Trois?', 6), ['Un.', 'Deux!', 'Trois?'])
  assert.equal(speakable('```js\ncode\n``` ok'), 'ok')
})

test('when everyone leaves, the bot stays and work goes on; what the session says waits, and is said the moment someone is back', async () => {
  const w = world()
  await w.join('alpha')
  await w.leave('alpha')
  assert.equal(w.adapter.leaves, 0, 'the bot stays in the channel')
  assert.match(w.last(), /nobody is in the call now\. I stay in the channel\. Keep working: what you call_say now is kept, and said as soon as someone is back here/)
  const held = await w.calls.say('alpha', 'Le tableau est prêt.')
  assert.equal(held.spoken, false)
  const before = w.adapter.plays.length
  await w.join('alpha')
  await sleep(20)
  assert.deepEqual(w.adapter.plays.slice(before), ['audio:Ici ALPHA. Le tableau est prêt.'], 'said at once, without waiting for the session')
  assert.match(w.last(), /Anthony is back in the call \(away 1 min\)\. I said right away what you kept for them: « Le tableau est prêt\. » Add only what changed since/)
  assert.deepEqual(w.adapter.joins, [CALL.alpha], 'no rejoin needed')

  await w.leave('alpha')
  await w.join('alpha')
  assert.match(w.last(), /is back in the call \(away 1 min\)\. I told them « Ici ALPHA\. Je t'écoute\. »\. Give them a short spoken update/, 'nothing kept: the session gives the update')
})

test('call_end: the bot leaves when the last person leaves — or at once with now', async () => {
  const w = world()
  await w.join('alpha')
  const later = await w.calls.end('alpha')
  assert.equal(later.left, false)
  assert.equal(w.adapter.leaves, 0)
  await w.leave('alpha')
  assert.equal(w.adapter.leaves, 1)
  assert.match(w.last(), /left and the Call is over — I left the voice channel/)
  await w.join('alpha')
  assert.match(w.last(), /a Call has started/, 'a new Call next time')
  const now = await w.calls.end('alpha', { now: true })
  assert.equal(now.left, true)
  assert.equal(w.adapter.leaves, 2)
})

test('talking over the bot stops its speech, and the session learns it was interrupted — a sound alone does not', async () => {
  const w = world()
  await w.join('alpha')
  w.adapter.gate = new Promise(r => { w.adapter.open = r })
  await w.calls.say('alpha', 'Une longue réponse. Avec plusieurs phrases. Qui ne finit pas.')
  await sleep(10)
  w.calls.speakingStart({ guildId: GUILD, channelId: CALL.alpha, userId: ANTHONY })
  assert.equal(w.adapter.stops, 0, 'audio started — maybe only a breath')
  w.calls.bargeIn({ guildId: GUILD, channelId: CALL.alpha, userId: ANTHONY })
  assert.equal(w.adapter.stops, 1)
  w.speak('alpha', 'Attends, plutôt Quillz Spark')
  await sleep(60)
  assert.match(w.last(), /« Attends, plutôt Quillz Spark » — they interrupted your reply/)
})

test('one bot, two calls: a busy bot says so, and comes over once the other call empties', async () => {
  const w = world()
  await w.join('alpha')
  await w.join('beta', snowflake(77), 'Lauriane')
  assert.deepEqual(w.adapter.joins, [CALL.alpha])
  assert.match(w.posts.at(-1).content, /in the ALPHA call right now/)
  await w.leave('alpha')
  assert.equal(w.adapter.channel, CALL.beta)
  assert.ok(w.delivered.some(d => d.kb === 'beta' && /Lauriane joined the voice channel/.test(d.text)))
})

test('only speech is transcribed: noise is dropped before speech-to-text, silence around speech is cut', async () => {
  const w = world()
  await w.join('alpha')
  const flags = n => Array(n).fill(false)
  w.texts.push('Sous-titres réalisés par la communauté d\'Amara.org')
  w.calls.utterance({ channelId: CALL.alpha, userId: ANTHONY, packets: speechPackets(150), speech: flags(150) }) // 3 s of breathing
  w.calls.utterance({ channelId: CALL.alpha, userId: ANTHONY, packets: speechPackets(50), speech: flags(48).concat(true, true) }) // 40 ms: a click
  await sleep(60)
  assert.equal(w.voiceCalls.transcribe.length, 0, 'nothing reached speech-to-text')
  assert.equal(w.delivered.filter(d => d.text.includes('🎙️')).length, 0)

  w.texts.splice(0)
  const speech = flags(100).concat(Array(40).fill(true), flags(100)) // 2 s silence, 0.8 s speech, 2 s silence
  w.texts.push('Oui, vas-y')
  w.calls.utterance({ channelId: CALL.alpha, userId: ANTHONY, packets: speechPackets(240), speech })
  await sleep(60)
  assert.match(w.last(), /« Oui, vas-y »/)
  assert.equal(w.voiceCalls.transcribe.length, 1)
})

test('words waiting for the end of a sentence still go out when the next sound is only noise', async () => {
  const w = world()
  await w.join('alpha')
  w.speak('alpha', 'Lance les trois tickets')
  w.calls.speakingStart({ guildId: GUILD, channelId: CALL.alpha, userId: ANTHONY })
  await sleep(30)
  w.calls.utterance({ channelId: CALL.alpha, userId: ANTHONY, packets: speechPackets(40), speech: Array(40).fill(false) })
  await sleep(60)
  assert.match(w.last(), /« Lance les trois tickets »/)
})

test('switching to another KB\'s call routes the bot there: both sessions know, each Call keeps its own KB, and the first speaks on return', async () => {
  const w = world()
  const move = (from, to) => w.calls.voiceState({ guildId: GUILD, userId: ANTHONY, name: 'Anthony', bot: false, before: CALL[from], after: CALL[to] })
  await w.join('alpha')
  w.adapter.gate = new Promise(r => { w.adapter.open = r })
  await w.calls.say('alpha', 'Je lance les tickets. Ensuite je fais la revue.')
  await sleep(10)
  await move('alpha', 'beta')
  w.adapter.open()
  w.adapter.gate = null
  assert.equal(w.adapter.channel, CALL.beta, 'the bot followed')
  const alphaTold = w.delivered.filter(d => d.kb === 'alpha').at(-1).text
  assert.match(alphaTold, /Anthony switched to the BETA call, and the bot went with them \(one bot serves every call\)\. This Call stays open, off the air until someone is back\. You were cut off mid-reply; the rest is kept\. Keep working/)
  assert.ok(w.delivered.some(d => d.kb === 'beta' && /Anthony joined the voice channel <#\d+> from the ALPHA call — the bot came with them — a Call has started/.test(d.text)), 'a Call starts in beta')

  w.speak('beta', 'Parlons de Spark')
  await sleep(60)
  assert.equal(w.delivered.filter(d => d.text.includes('Parlons de Spark')).map(d => d.kb).join(), 'beta', 'what is said in beta reaches beta only')
  const held = await w.calls.say('alpha', 'Les tickets sont faits.')
  assert.equal(held.spoken, false, 'alpha has nobody to talk to: kept')

  const before = w.adapter.plays.length
  await move('beta', 'alpha')
  await sleep(20)
  assert.equal(w.adapter.channel, CALL.alpha)
  assert.match(w.delivered.filter(d => d.kb === 'beta').at(-1).text, /switched to the ALPHA call/)
  assert.match(w.delivered.filter(d => d.kb === 'alpha').at(-1).text, /Anthony is back in the call \(away 1 min\) from the BETA call — the bot came with them\. I said right away what you kept for them: « Je lance les tickets\. Ensuite je fais la revue\. » « Les tickets sont faits\. »/)
  assert.match(w.adapter.plays.slice(before).join(' '), /Je lance les tickets\. Ensuite je fais la revue\. Les tickets sont faits\./, 'alpha speaks as soon as the bot is back')
})

test('speech detection: a voice is speech; silence, noise and a too-quiet voice are not; padding and long pauses', () => {
  const sr = 16000
  const vowel = Int16Array.from({ length: sr }, (_, i) => { // 140 Hz with harmonics, like a vowel
    const t = i / sr
    return 6000 * (Math.sin(2 * Math.PI * 140 * t) + 0.6 * Math.sin(2 * Math.PI * 280 * t) + 0.3 * Math.sin(2 * Math.PI * 420 * t))
  })
  let seed = 7
  const noise = Int16Array.from({ length: sr }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5) * 8000)
  const frames = x => Array.from({ length: x.length / 320 }, (_, i) => x.subarray(i * 320, (i + 1) * 320))
  assert.ok(voicing(vowel.subarray(0, 640)) > 0.9)
  assert.ok(voicing(noise.subarray(0, 640)) < 0.3)
  assert.ok(levelDb(new Int16Array(320)) < -100)
  const run = x => { const d = speechDetector(); for (const f of frames(x)) d.push(f); return d }
  assert.ok(run(vowel).speechMs >= 900, 'a voice is speech')
  assert.equal(run(noise).speechMs, 0, 'noise is not')
  assert.equal(run(new Int16Array(sr)).speechMs, 0, 'silence is not')
  assert.equal(run(vowel.map(v => v / 1000)).speechMs, 0, 'too quiet to be someone talking to the team')
  const d = speechDetector()
  d.push(null)
  assert.deepEqual(d.flags, [false], 'an undecodable packet is not speech')

  const f = (...runs) => runs.flatMap(([n, v]) => Array(n).fill(v))
  assert.deepEqual(keepSpeech(f([5, false]), {}), { speech_ms: 0, keep: [] })
  const k = keepSpeech(f([50, false], [10, true], [100, false], [10, true], [50, false]), { pad_ms: 200, max_gap_ms: 800 })
  assert.equal(k.speech_ms, 400)
  assert.equal(k.keep[0], 40, '200 ms before the speech')
  assert.equal(k.keep.at(-1), 179, '200 ms after it')
  assert.equal(k.keep.length, 10 + 10 + 10 + 10 + 10 + 10, 'the 2 s pause inside is cut to its edges')
  assert.equal(keepSpeech(f([10, true], [30, false], [10, true]), { pad_ms: 200, max_gap_ms: 800 }).keep.length, 50, 'a short pause stays whole')
})

test('what speech-to-text invents is removed: subtitle credits, bare links, lone thank-yous', () => {
  for (const invented of ['❤️ par SousTitreur.com', 'https://www.kenhub.com', 'http://TheBusinessProfessor.com', 'Subs by www.zeoranger.co.uk', 'Thank you. Thank you. Thank you.', 'So.', 'Sous-titres réalisés par la communauté d\'Amara.org', 'Merci.']) {
    assert.equal(cleanTranscript(invented), '', invented)
  }
  assert.equal(cleanTranscript('❤️ par SousTitreur.com Oui, bien, en fait, peux-tu me dire les trois prochains?'), 'Oui, bien, en fait, peux-tu me dire les trois prochains?')
  assert.equal(cleanTranscript('Va voir quillz.com pour la démo'), 'Va voir quillz.com pour la démo', 'a domain inside a sentence stays')
  assert.equal(cleanTranscript('Merci, lance les tickets.'), 'Merci, lance les tickets.')
})

test('transcription: segments the model marks as silence are dropped; the language is what people speak, if set', async () => {
  const sent = []
  const fetchImpl = async (url, init) => {
    sent.push(Object.fromEntries([...init.body.entries()].filter(([k]) => k !== 'file')))
    return new Response(JSON.stringify({
      text: 'Lance les tickets. Thank you for watching! Bla',
      segments: [
        { text: ' Lance les tickets.', no_speech_prob: 0.02, avg_logprob: -0.2 },
        { text: ' Thank you for watching!', no_speech_prob: 0.9, avg_logprob: -0.3 },
        { text: ' Bla', no_speech_prob: 0.7, avg_logprob: -1.4 },
      ],
    }), { status: 200 })
  }
  const inst = lang => ({ settings: { voice: lang ? { language: lang } : {} }, secret: () => 'sk-test' })
  assert.equal(await voiceProvider(inst(), { fetchImpl }).transcribe(Buffer.from('x')), 'Lance les tickets.')
  await voiceProvider(inst('fr'), { fetchImpl }).transcribe(Buffer.from('x'))
  assert.equal(sent[0].response_format, 'verbose_json')
  assert.equal(sent[0].language, undefined, 'detected by default')
  assert.equal(sent[1].language, 'fr')
})

test('an empty Call nobody returns to ends after idle_minutes', async () => {
  const w = world({ idle: 0 })
  await w.join('alpha')
  await w.leave('alpha')
  await sleep(5)
  await w.calls.tick()
  assert.equal(w.adapter.leaves, 1)
  assert.match(w.last(), /Nobody came back for 0 min — I left the voice channel/)
})

test('the session inbox: the hook records its address; a post authenticates, then delivers one user message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crelio-inbox-'))
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\crelio-test-${process.pid}-${Date.now()}` : join(dir, 'inbox.sock')
  const lines = []
  const server = createServer(s => { s.setEncoding('utf8'); let buf = ''; s.on('data', d => { buf += d }); s.on('end', () => lines.push(...buf.trim().split('\n').map(l => JSON.parse(l)))) })
  await new Promise(r => server.listen(path, r))
  assert.equal(writeInboxAddress(dir, {}), false, 'no address outside a session')
  assert.equal(writeInboxAddress(dir, { CLAUDE_CODE_MESSAGING_SOCKET: path, CLAUDE_CODE_MESSAGING_TOKEN: 'tok' }), true)
  assert.equal(await postToSession(dir, '🎙️ [Call] hello'), true)
  await sleep(50)
  server.close()
  assert.deepEqual(lines[0], { type: 'auth', token: 'tok' })
  assert.equal(lines[1].type, 'user')
  assert.equal(lines[1].from, 'crelio-call')
  assert.deepEqual(lines[1].message, { content: '🎙️ [Call] hello' })
  assert.equal(await postToSession(mkdtempSync(join(tmpdir(), 'crelio-none-')), 'x'), false, 'no session, no delivery')
})

test('the session\'s call tools reach the Call service; call_setup creates the voice channel; an owner\'s spoken "yes" approves', async () => {
  const w = world()
  const fake = await startFakeDiscord({ guildId: w.instance.guildId, channels: [{ id: w.instance.kb('alpha').discord.category_id, type: 4 }, { id: w.instance.kb('alpha').discord.general_id, parent_id: w.instance.kb('alpha').discord.category_id }, { id: CALL.alpha, type: 2, parent_id: w.instance.kb('alpha').discord.category_id }], bots: { [`token-${w.instance.settings.bots.manager.token_env}`]: { id: w.instance.settings.bots.manager.user_id, bot: true } } })
  const control = await startControlServer({ instance: w.instance, calls: w.calls })
  const mcp = startMcp({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: w.ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api })
  const before = await mcp.call('call_say', { text: 'allô' })
  await w.join('alpha')
  const said = await mcp.call('call_say', { text: 'Bonjour Anthony' })
  const status = await mcp.call('call_status', {})
  const ended = await mcp.call('call_end', {})
  // An owner's utterance approves a Team change; someone else's does not.
  const dir = join(w.instance.stateDir('alpha'), 'call')
  appendFileSync(join(dir, 'utterances.jsonl'), JSON.stringify({ id: 'u9-x', user_id: ANTHONY, name: 'Anthony', text: 'oui, active les appels', ts: new Date().toISOString() }) + '\n')
  appendFileSync(join(dir, 'utterances.jsonl'), JSON.stringify({ id: 'u10-x', user_id: snowflake(77), name: 'Lauriane', text: 'oui', ts: new Date().toISOString() }) + '\n')
  const setup = await mcp.call('call_setup', { enabled: true, approval_chat_id: 'call', approval_message_id: 'u9-x' })
  const notOwner = await mcp.call('call_setup', { enabled: true, approval_chat_id: 'call', approval_message_id: 'u10-x' })
  await mcp.close(); await control.close(); await fake.close()
  assert.match(before.text, /no Call in progress/)
  assert.equal(said.isError, false, said.text)
  assert.equal(said.data.spoken, true)
  assert.deepEqual(status.data.people, ['Anthony'])
  assert.equal(status.data.bot_in_channel, true)
  assert.equal(ended.data.left, false)
  assert.equal(setup.isError, false, setup.text)
  assert.equal(setup.data.channel_id, CALL.alpha, 'the existing voice channel is reused')
  assert.match(notOwner.text, /said by Lauriane, not the owner/)
})

test('call_setup turns Calls on with a new voice channel the session hears; the launcher runs the Call service once installed', async () => {
  const { ws } = makeWorkspace({ kbs: ['alpha'] })
  const instance = loadInstance(ws, { repoDir: REPO })
  const d = instance.kb('alpha').discord
  const owner = instance.settings.server.owner_id
  const fake = await startFakeDiscord({ guildId: instance.guildId, channels: [{ id: d.category_id, type: 4 }, { id: d.general_id, parent_id: d.category_id }], bots: { [`token-${instance.settings.bots.manager.token_env}`]: { id: instance.settings.bots.manager.user_id, bot: true } } })
  const mcp = startMcp({ CRELIO_SESSION: 'alpha', CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO, CRELIO_DISCORD_API: fake.api })
  const ask = fake.addMessage(d.general_id, { content: 'active le mode appel', author: { id: owner } })
  const res = await mcp.call('call_setup', { approval_chat_id: d.general_id, approval_message_id: ask.id })
  await mcp.close(); await fake.close()
  assert.equal(res.isError, false, res.text)
  const created = fake.state.channels.get(res.data.channel_id)
  assert.deepEqual([created.name, created.type, created.parent_id], ['🔈𝘊𝘢𝘭𝘭', 2, d.category_id])
  const after = loadInstance(ws, { repoDir: REPO })
  assert.equal(after.kb('alpha').call.enabled, true)
  assert.ok(after.channelsOf('alpha').includes(res.data.channel_id), 'its text chat is heard')
  assert.equal(after.locate(res.data.channel_id).role, 'call')
  const access = JSON.parse(readFileSync(join(ws, 'state', 'alpha', 'discord', 'access.json'), 'utf8'))
  assert.ok(Object.keys(access.groups).includes(res.data.channel_id))

  const repo = mkdtempSync(join(tmpdir(), 'crelio-repo-'))
  assert.ok(!launchIds(loadInstance(ws, { repoDir: repo })).includes(CALLS))
  mkdirSync(join(repo, 'calls', 'node_modules', '@discordjs', 'voice'), { recursive: true })
  assert.ok(launchIds(loadInstance(ws, { repoDir: repo })).includes(CALLS))
})

test('Opus packets become a valid Ogg Opus file: checksummed pages, 20 ms per packet', () => {
  const ogg = oggFromOpus(speechPackets(130))
  assert.equal(isOggOpus(ogg), true)
  let i = 0
  let pages = 0
  while (i < ogg.length) {
    const n = ogg[i + 26]
    let size = 0
    for (let s = 0; s < n; s++) size += ogg[i + 27 + s]
    const page = Buffer.from(ogg.subarray(i, i + 27 + n + size))
    const crc = page.readUInt32LE(22)
    page.writeUInt32LE(0, 22)
    assert.equal(oggCrc(page), crc, `page ${pages} checksum`)
    i += 27 + n + size
    pages++
  }
  assert.equal(oggPages(ogg).length, pages)
  assert.equal(oggVoiceInfo(ogg).duration_secs, 2.6)
})
