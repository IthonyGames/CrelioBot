// Voice provider: speech-to-text for people's Voice notes, text-to-speech for agents' Voice notes.
// OpenAI by default (whisper transcription; TTS straight to Ogg Opus, the format Discord voice
// messages use). Another provider = another object with the same two methods.

import { ConfigError } from './instance.mjs'

export const OPENAI_API = 'https://api.openai.com/v1'
export const MAX_TTS_CHARS = 4096
export const MAX_STT_BYTES = 25 * 1024 * 1024

const DEFAULTS = { provider: 'openai', api_key_env: 'OPENAI_API_KEY', stt_model: 'whisper-1', tts_model: 'tts-1', voice: 'onyx', speed: 1.4 }

// What speech-to-text invents from silence or noise — subtitle credits from the videos it learned on,
// bare links, "thank you"s — never something a person said.
const LINK = /(?:https?:\/\/|www\.)\S+/giu
const CREDITS = /(?:❤️\s*)?\b(?:par|by)\s+\S*sous-?titr\S*|\b(?:sous-titr|soustitreur|subtitles? by|subs by|captions? by|transcri(?:bed|ption) by|amara\.org|merci d'avoir regardé|thanks? (?:you )?for watching|abonnez-vous|n'oubliez pas de vous abonner)(?:[^.!?\n]|\.(?=\S))*[.!?]*/giu
const FILLER = /^(?:[\s.,!?…]*(?:merci(?: beaucoup)?|thank you(?: very much)?|thanks|you|so|bye|hmm+|euh+)[\s.,!?…]*)*$/iu
const BARE_DOMAIN = /^\W*[\w-]+(?:\.[\w-]+)+\W*$/u
// Whisper's own verdict on a segment: no speech in it (the openai-whisper thresholds, plus a sure "no speech").
const silentSegment = s => (s.no_speech_prob > 0.6 && s.avg_logprob < -1) || s.no_speech_prob > 0.85

/** A transcript without the invented parts; '' when nothing a person said is left. */
export function cleanTranscript(text) {
  const t = String(text ?? '').replace(LINK, ' ').replace(CREDITS, ' ').replace(/\s+/g, ' ').trim()
  return /^\W*$/u.test(t) || FILLER.test(t) || BARE_DOMAIN.test(t) ? '' : t
}

export function voiceProvider(instance, { fetchImpl = fetch, api = process.env.CRELIO_OPENAI_API ?? OPENAI_API } = {}) {
  const cfg = { ...DEFAULTS, ...instance.settings.voice }
  if (cfg.provider !== 'openai') throw new ConfigError(`voice provider "${cfg.provider}" is not supported — use "openai"`)
  const key = () => {
    const k = instance.secret(cfg.api_key_env)
    if (!k) throw new ConfigError(`Missing ${cfg.api_key_env} in workspace/.env — Voice notes need it`)
    return k
  }
  async function call(path, init) {
    const res = await fetchImpl(api + path, { ...init, headers: { Authorization: `Bearer ${key()}`, ...init.headers } })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(`voice provider refused ${path} (HTTP ${res.status}): ${data?.error?.message ?? 'error'}`)
    }
    return res
  }
  return {
    /** language: what people speak (voice.language in crelio.json); unset, the model detects it. */
    async transcribe(audio, { filename = 'voice-message.ogg', contentType = 'audio/ogg', language = cfg.language, prompt } = {}) {
      const form = new FormData()
      form.append('model', cfg.stt_model)
      if (language) form.append('language', language)
      if (prompt) form.append('prompt', prompt) // names the model should spell right (KBs, agents)
      // whisper models report, per segment, how sure they are that it holds speech
      if (/^whisper/.test(cfg.stt_model)) form.append('response_format', 'verbose_json')
      form.append('file', new Blob([audio], { type: contentType }), filename)
      const data = await (await call('/audio/transcriptions', { method: 'POST', body: form })).json()
      const said = Array.isArray(data.segments) ? data.segments.filter(s => !silentSegment(s)).map(s => s.text).join(' ') : data.text
      const text = cleanTranscript(said)
      if (!text) throw new Error('the transcription came back empty')
      return text
    },
    async speak(text) {
      const res = await call('/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.tts_model, voice: cfg.voice, speed: cfg.speed, input: text, response_format: 'opus' }),
      })
      return Buffer.from(await res.arrayBuffer())
    },
  }
}
