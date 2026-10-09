// Ogg Opus inspection for Discord voice messages: duration (from the last page's granule position
// minus the Opus pre-skip, at 48 kHz) and a 256-point waveform (from page payload sizes — a
// loudness proxy that needs no audio decoding).

export function isOggOpus(buf) {
  return buf.length > 36 && buf.toString('latin1', 0, 4) === 'OggS' && buf.indexOf('OpusHead') >= 0
}

export function oggPages(buf) {
  const pages = []
  for (let i = 0; i + 27 <= buf.length;) {
    if (buf.toString('latin1', i, i + 4) !== 'OggS') { i++; continue }
    const segments = buf[i + 26]
    if (i + 27 + segments > buf.length) break
    let size = 0
    for (let s = 0; s < segments; s++) size += buf[i + 27 + s]
    pages.push({ granule: buf.readBigInt64LE(i + 6), size })
    i += 27 + segments + size
  }
  return pages
}

export function oggVoiceInfo(buf, points = 256) {
  if (!isOggOpus(buf)) throw new Error('not an Ogg Opus stream')
  const pages = oggPages(buf)
  const head = buf.indexOf('OpusHead')
  const preSkip = buf.readUInt16LE(head + 10)
  const lastGranule = pages.reduce((g, p) => (p.granule > g ? p.granule : g), 0n)
  const duration = Math.max(0.1, Number(lastGranule - BigInt(preSkip)) / 48000)
  const audio = pages.slice(2).map(p => p.size) // pages 0-1 are OpusHead and OpusTags
  const n = Math.max(1, Math.min(points, audio.length))
  const max = Math.max(1, ...audio)
  const wave = Buffer.alloc(n)
  for (let k = 0; k < n; k++) wave[k] = Math.round((255 * (audio[Math.floor((k * audio.length) / n)] ?? 0)) / max)
  return { duration_secs: Math.round(duration * 100) / 100, waveform: wave.toString('base64') }
}
