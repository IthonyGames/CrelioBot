// Voice provider: speech-to-text for people's Voice notes, text-to-speech for agents' Voice notes.
// OpenAI by default (whisper transcription; TTS straight to Ogg Opus, the format Discord voice
// messages use). Another provider = another object with the same two methods.

import { ConfigError } from './instance.mjs'

export const OPENAI_API = 'https://api.openai.com/v1'
export const MAX_TTS_CHARS = 4096
export const MAX_STT_BYTES = 25 * 1024 * 1024

const DEFAULTS = { provider: 'openai', api_key_env: 'OPENAI_API_KEY', stt_model: 'whisper-1', tts_model: 'tts-1', voice: 'onyx', speed: 1.4 }

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
    async transcribe(audio, { filename = 'voice-message.ogg', contentType = 'audio/ogg', language } = {}) {
      const form = new FormData()
      form.append('model', cfg.stt_model)
      if (language) form.append('language', language)
      form.append('file', new Blob([audio], { type: contentType }), filename)
      const data = await (await call('/audio/transcriptions', { method: 'POST', body: form })).json()
      const text = String(data.text ?? '').trim()
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
