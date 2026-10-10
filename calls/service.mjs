#!/usr/bin/env node
// CrelioBot Call service — the voice side of Calls; the logic lives in src/calls.mjs. An optional
// component with its own dependencies (ADR-0007): discord.js for the gateway, @discordjs/voice and
// @snazzah/davey for the voice connection (Discord only accepts end-to-end encrypted voice — DAVE —
// since March 2026); opusscript and the WebRTC voice detector (WASM) to tell speech from noise.
// Installed with "crelio calls install"; the launcher then runs it in its own window.
//
// One gateway connection per Manager bot that serves a KB with Calls on (usually the one shared Manager),
// next to the connections the sessions' Discord plugins hold. It follows the Workspace: turning Calls on
// or off for a KB (call_setup) applies within seconds.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { Client, Events, GatewayIntentBits } from 'discord.js'
import * as voice from '@discordjs/voice'
import { liveInstance } from '../src/instance.mjs'
import { discordClient } from '../src/discord.mjs'
import { voiceProvider } from '../src/voice.mjs'
import { createCalls, startControlServer } from '../src/calls.mjs'
import { FRAME, SAMPLE_RATE, speechDetector, VAD_DEFAULTS } from '../src/vad.mjs'

const repoDir = process.env.CRELIO_HOME ?? resolve(import.meta.dirname, '..')
const instance = liveInstance(process.env.CRELIO_WORKSPACE ?? join(repoDir, 'workspace'), { repoDir })
const logFile = join(instance.workspaceDir, 'state', 'calls', 'service.log')
mkdirSync(dirname(logFile), { recursive: true })
const log = msg => {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { appendFileSync(logFile, line + '\n') } catch {}
}

// The voice connection's own story (gateway, UDP, end-to-end encryption) for when the bot can't be heard.
// Heartbeats are left out; the file is rotated at 5 MB.
const debugFile = join(dirname(logFile), 'voice-debug.log')
const debug = msg => {
  if (/"op":\s*(3|6)\b/.test(msg)) return
  try {
    if (statSync(debugFile, { throwIfNoEntry: false })?.size > 5_000_000) renameSync(debugFile, `${debugFile}.old`)
    appendFileSync(debugFile, `[${new Date().toISOString()}] ${msg.slice(0, 600)}\n`)
  } catch {}
}

const bots = new Map() // token env name → { client, calls, kbs }

// Speech detection: each packet is decoded to 16 kHz mono and checked by the WebRTC voice detector.
// Without these two (an install from before they were added), every sound counts — as it used to.
let OpusScript = null
let fvad = null
try {
  OpusScript = (await import('opusscript')).default
  fvad = await (await import('@echogarden/fvad-wasm')).default()
} catch (e) {
  log(`speech detection off (${e.message}) — run "crelio calls install" again`)
}

function webrtcDetector(mode) {
  const handle = fvad._fvad_new()
  fvad._fvad_set_sample_rate(handle, SAMPLE_RATE)
  fvad._fvad_set_mode(handle, mode)
  const ptr = fvad._malloc(FRAME * 2)
  return {
    test(frame) { fvad.HEAP16.set(frame, ptr >> 1); return fvad._fvad_process(handle, ptr, FRAME) === 1 },
    free() { fvad._free(ptr); fvad._fvad_free(handle) },
  }
}

/** One person's stream: decode as packets arrive; null when speech detection is off. */
function listener(vadConfig) {
  if (!OpusScript || !fvad) return null
  const decoder = new OpusScript(SAMPLE_RATE, 1)
  const webrtc = webrtcDetector(vadConfig.mode)
  const detector = speechDetector({ ...vadConfig, webrtc: frame => webrtc.test(frame) })
  return {
    detector,
    push(packet) {
      let pcm = null
      try {
        const out = decoder.decode(packet)
        pcm = new Int16Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length))
      } catch {}
      return detector.push(pcm)
    },
    close() { decoder.delete(); webrtc.free() },
  }
}

/** Which Manager bot serves each KB with Calls on (a KB profile may give its team its own Manager). */
function wantedBots() {
  const want = new Map()
  for (const kb of instance.kbs.values()) {
    if (!kb.call?.enabled || !kb.discord?.call_id) continue
    const bot = instance.botFor(kb.id, 'manager')
    if (!bot?.token) { log(`[${kb.id}] Calls are on but the Manager bot has no token`); continue }
    if (!want.has(bot.token_env)) want.set(bot.token_env, new Set())
    want.get(bot.token_env).add(kb.id)
  }
  return want
}

function startBot(tokenEnv, kbs) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })
  const players = new Map() // guild id → { conn, player }: a fresh player for every new voice connection
  const wired = new WeakSet()
  const entry = { client, kbs, calls: null }
  const memberName = (guildId, userId) => {
    const m = client.guilds.cache.get(guildId)?.members.cache.get(userId)
    return m?.displayName ?? m?.user?.globalName ?? m?.user?.username ?? 'someone'
  }

  /** Listen to everyone in the channel: each stretch of speech up to silence_ms of silence is one segment. */
  function wire(conn, guildId) {
    if (wired.has(conn)) return
    wired.add(conn)
    conn.on('debug', m => debug(`[connection] ${m}`))
    conn.on('stateChange', (before, after) => {
      if (before.status !== after.status) log(`voice connection: ${before.status} → ${after.status}`)
    })
    conn.on(voice.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          voice.entersState(conn, voice.VoiceConnectionStatus.Signalling, 5_000),
          voice.entersState(conn, voice.VoiceConnectionStatus.Connecting, 5_000),
        ])
      } catch {
        const channelId = conn.joinConfig.channelId
        conn.destroy()
        await entry.calls.disconnected(guildId, channelId)
      }
    })
    conn.on('error', e => log(`voice connection error: ${e.message}`))
    conn.receiver.speaking.on('start', userId => {
      const channelId = conn.joinConfig.channelId
      entry.calls.speakingStart({ guildId, channelId, userId })
      if (conn.receiver.subscriptions.has(userId)) return
      const kbId = entry.calls.kbOfChannel(channelId)
      if (!kbId) return
      const cfg = entry.calls.config(kbId)
      const stream = conn.receiver.subscribe(userId, { end: { behavior: voice.EndBehaviorType.AfterSilence, duration: cfg.silence_ms } })
      const ear = listener({ ...VAD_DEFAULTS, ...cfg.vad })
      // Without speech detection, any sound talks over the bot; with it, only real speech does.
      if (!ear) entry.calls.bargeIn({ guildId, channelId, userId })
      const packets = []
      let barged = !ear
      stream.on('data', p => {
        packets.push(p)
        if (!ear) return
        ear.push(p)
        if (!barged && ear.detector.speechMs >= cfg.barge_ms) {
          barged = true
          entry.calls.bargeIn({ guildId, channelId, userId })
        }
      })
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        ear?.close()
        entry.calls.utterance({ channelId, userId, name: memberName(guildId, userId), packets, speech: ear?.detector.flags })
      }
      stream.on('end', finish)
      stream.on('close', finish)
      stream.on('error', e => log(`receive error (${userId}): ${e.message}`))
    })
  }

  /** The player of this voice connection — never one left over from an earlier connection. */
  function playerFor(guildId, conn) {
    const current = players.get(guildId)
    if (current?.conn === conn) return current.player
    current?.player.stop(true)
    const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause }, debug: true })
    player.on('error', e => log(`player error: ${e.message}`))
    player.on('debug', m => debug(`[player] ${m}`))
    conn.subscribe(player)
    players.set(guildId, { conn, player })
    return player
  }

  const adapter = {
    connectedChannel(guildId) {
      const conn = voice.getVoiceConnection(guildId)
      return conn && conn.state.status !== voice.VoiceConnectionStatus.Destroyed ? conn.joinConfig.channelId : null
    },
    async join(guildId, channelId) {
      const current = voice.getVoiceConnection(guildId)
      if (current && current.state.status !== voice.VoiceConnectionStatus.Destroyed) {
        // A move. rejoin() also updates the connection's own channel: joinVoiceChannel() would only ask
        // Discord to move, and the library's next automatic reconnect would take the bot back.
        const moving = new Promise(resolve => {
          const onState = (_, next) => { if (next.status !== voice.VoiceConnectionStatus.Ready) { current.off('stateChange', onState); resolve() } }
          current.on('stateChange', onState)
          setTimeout(() => { current.off('stateChange', onState); resolve() }, 3_000)
        })
        current.rejoin({ channelId, selfDeaf: false, selfMute: false })
        await moving
        await voice.entersState(current, voice.VoiceConnectionStatus.Ready, 20_000)
        log(`moved to voice channel ${channelId}`)
        return
      }
      const guild = await client.guilds.fetch(guildId)
      const conn = voice.joinVoiceChannel({ channelId, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: false, debug: true })
      await voice.entersState(conn, voice.VoiceConnectionStatus.Ready, 20_000)
      wire(conn, guildId)
      log(`joined voice channel ${channelId}`)
    },
    async leave(guildId) {
      players.get(guildId)?.player.stop(true)
      players.delete(guildId)
      voice.getVoiceConnection(guildId)?.destroy()
      log(`left the voice channel in ${guildId}`)
    },
    /** Resolves when the audio has played, was stopped, or could not play for 5 s (logged, never blocks the queue). */
    play(guildId, ogg) {
      const conn = voice.getVoiceConnection(guildId)
      if (!conn || conn.state.status === voice.VoiceConnectionStatus.Destroyed) return Promise.resolve()
      const player = playerFor(guildId, conn)
      return new Promise(done => {
        let stuckSince = Date.now()
        const watch = setInterval(() => {
          if (player.state.status === voice.AudioPlayerStatus.Playing) { stuckSince = Date.now(); return }
          if (Date.now() - stuckSince < 5_000) return
          log(`could not play (player ${player.state.status}, connection ${conn.state.status}) — skipped`)
          player.stop(true)
        }, 1_000)
        const onState = (_, next) => {
          if (next.status !== voice.AudioPlayerStatus.Idle) return
          clearInterval(watch)
          player.off('stateChange', onState)
          done()
        }
        player.on('stateChange', onState)
        player.play(voice.createAudioResource(Readable.from([ogg]), { inputType: voice.StreamType.OggOpus }))
      })
    },
    stop(guildId) { players.get(guildId)?.player.stop(true) },
  }

  entry.calls = createCalls({
    instance,
    adapter,
    voice: () => voiceProvider(instance),
    clientFor: token => discordClient(token),
    owns: kbId => entry.kbs.has(kbId),
    log,
  })

  client.on(Events.VoiceStateUpdate, (before, after) => {
    const guildId = after.guild.id
    if (after.id === client.user.id) {
      if (before.channelId && !after.channelId) entry.calls.disconnected(guildId, before.channelId).catch(e => log(e.message))
      return
    }
    const member = after.member ?? before.member
    entry.calls.voiceState({
      guildId, userId: after.id, bot: !!member?.user?.bot,
      name: member?.displayName ?? member?.user?.username ?? 'someone',
      before: before.channelId, after: after.channelId,
    }).catch(e => log(`voice state: ${e.message}`))
  })

  client.once(Events.ClientReady, async () => {
    log(`connected as ${client.user.username} for ${[...kbs].join(', ')}`)
    // People already in a call channel when the service starts.
    for (const kb of entry.calls.enabledKbs()) {
      try {
        const ch = await client.channels.fetch(kb.discord.call_id)
        for (const m of ch.members?.values() ?? []) {
          if (!m.user.bot) await entry.calls.voiceState({ guildId: ch.guild.id, userId: m.id, name: m.displayName, bot: false, before: null, after: ch.id })
        }
      } catch (e) { log(`[${kb.id}] call channel ${kb.discord.call_id}: ${e.message}`) }
    }
  })
  client.login(instance.secret(tokenEnv)).catch(e => log(`login failed (${tokenEnv}): ${e.message}`))
  return entry
}

function sync() {
  const want = wantedBots()
  for (const [tokenEnv, entry] of bots) {
    if (!want.has(tokenEnv)) { entry.client.destroy(); bots.delete(tokenEnv); log(`no Calls left for ${tokenEnv} — disconnected`) }
  }
  for (const [tokenEnv, kbs] of want) {
    if (bots.has(tokenEnv)) bots.get(tokenEnv).kbs = kbs
    else bots.set(tokenEnv, startBot(tokenEnv, kbs))
  }
}

const owner = kb => [...bots.values()].find(b => b.kbs.has(kb))?.calls
const router = {
  say: (kb, text) => { const c = owner(kb); if (!c) throw Object.assign(new Error('Calls are off for this KB (call_setup turns them on)'), { name: 'CallError' }); return c.say(kb, text) },
  end: (kb, opts) => owner(kb)?.end(kb, opts) ?? { active: false, note: 'Calls are off for this KB' },
  status: kb => owner(kb)?.status(kb) ?? { active: false, calls_enabled: false },
}

await startControlServer({ instance, calls: router })
log(`Call service started (${process.pid})`)
sync()
setInterval(sync, 10_000)
setInterval(() => { for (const b of bots.values()) b.calls.tick().catch(e => log(`tick: ${e.message}`)) }, 60_000)
process.on('unhandledRejection', e => log(`unhandled: ${e?.message ?? e}`))
