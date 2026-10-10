// Speech detection for Calls: does this stretch of someone's audio hold speech? A Discord client sends
// audio whenever it thinks its user talks — breathing, a keyboard, a fan — and speech-to-text invents
// words from that ("Sous-titres réalisés par…", links). A 20 ms frame counts as speech when three tests
// agree: the WebRTC voice detector (run by the Call service, passed in), a level above min_db, and
// voicing — the periodicity of a voice, which breath, clicks and noise don't have. Dependency-free:
// the Call service decodes the Opus packets to 16 kHz mono and hands each packet's samples here.

export const SAMPLE_RATE = 16000
export const FRAME = 320 // 20 ms at 16 kHz
const FRAME_MS = 20
const MIN_LAG = Math.round(SAMPLE_RATE / 400) // pitch up to 400 Hz
const MAX_LAG = Math.round(SAMPLE_RATE / 70) // down to 70 Hz

/** mode: WebRTC aggressiveness 0–3. min_db: quieter frames are never speech. voicing: 0–1 periodicity
 * a frame needs. pad_ms: audio kept around speech. max_gap_ms: longer silences inside are shortened. */
export const VAD_DEFAULTS = { mode: 2, min_db: -50, voicing: 0.55, pad_ms: 200, max_gap_ms: 800 }

/** RMS level of a frame in dBFS. */
export function levelDb(frame) {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return 10 * Math.log10(sum / (frame.length || 1) / 32768 ** 2 + 1e-12)
}

/** Periodicity: the best normalized autocorrelation over pitch lags (0 = noise, 1 = a pure tone). */
export function voicing(x) {
  let best = 0
  for (let lag = MIN_LAG; lag <= MAX_LAG && lag < x.length; lag++) {
    let xy = 0, xx = 0, yy = 0
    for (let n = 0; n + lag < x.length; n++) {
      const a = x[n], b = x[n + lag]
      xy += a * b; xx += a * a; yy += b * b
    }
    const r = xy / Math.sqrt(xx * yy + 1e-9)
    if (r > best) best = r
  }
  return best
}

/**
 * One person's stream: push each packet's samples (16 kHz mono) as it arrives; push(null) for a packet
 * that could not be decoded. `flags` has one entry per packet, `speechMs` the speech heard so far.
 */
export function speechDetector({ webrtc = () => true, min_db = VAD_DEFAULTS.min_db, voicing: threshold = VAD_DEFAULTS.voicing } = {}) {
  let prev = new Int16Array(FRAME)
  let carry = new Int16Array(0)
  const flags = []
  return {
    flags,
    get speechMs() { return flags.filter(Boolean).length * FRAME_MS },
    push(pcm) {
      if (!pcm) { flags.push(false); return false }
      const all = new Int16Array(carry.length + pcm.length)
      all.set(carry)
      all.set(pcm, carry.length)
      let speech = false
      let off = 0
      for (; off + FRAME <= all.length; off += FRAME) {
        const frame = all.subarray(off, off + FRAME)
        const detected = webrtc(frame) // every frame: the WebRTC detector adapts to the background
        if (detected && levelDb(frame) > min_db) {
          const window = new Int16Array(FRAME * 2) // 40 ms: two pitch periods even for a low voice
          window.set(prev)
          window.set(frame, FRAME)
          if (voicing(window) > threshold) speech = true
        }
        prev = frame.slice()
      }
      carry = all.slice(off)
      flags.push(speech)
      return speech
    },
  }
}

/**
 * Which packets to transcribe: the speech, `pad_ms` around it, and silences inside it shortened to
 * `max_gap_ms`. Leading and trailing silence is where speech-to-text invents words.
 */
export function keepSpeech(flags, { pad_ms = VAD_DEFAULTS.pad_ms, max_gap_ms = VAD_DEFAULTS.max_gap_ms } = {}) {
  const speechMs = flags.filter(Boolean).length * FRAME_MS
  const first = flags.indexOf(true)
  if (first < 0) return { speech_ms: 0, keep: [] }
  const last = flags.lastIndexOf(true)
  const pad = Math.round(pad_ms / FRAME_MS)
  const gap = Math.max(Math.round(max_gap_ms / FRAME_MS), 2 * pad)
  const keep = []
  for (let i = Math.max(0, first - pad); i <= Math.min(flags.length - 1, last + pad); i++) {
    if (flags[i] || i < first || i > last) { keep.push(i); continue }
    let end = i // a silence inside the speech: keep it whole when short, its edges when long
    while (end <= last && !flags[end]) end++
    const length = end - i
    for (let j = i; j < end; j++) if (length <= gap || j - i < pad || end - j <= pad) keep.push(j)
    i = end - 1
  }
  return { speech_ms: speechMs, keep }
}
