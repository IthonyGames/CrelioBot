// Ogg Opus inspection for Discord voice messages: duration (from the last page's granule position
// minus the Opus pre-skip, at 48 kHz) and a 256-point waveform (from page payload sizes — a
// loudness proxy that needs no audio decoding).

// Ogg page checksum: CRC-32, polynomial 0x04C11DB7, not reflected, initial value 0 (RFC 3533).
const CRC_TABLE = new Uint32Array(256).map((_, i) => {
  let r = i << 24
  for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
  return r >>> 0
})
export function oggCrc(buf) {
  let crc = 0
  for (const b of buf) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0
  return crc
}

function oggPage({ serial, seq, granule, flags, packets }) {
  const lacing = []
  for (const p of packets) {
    let left = p.length
    while (left >= 255) { lacing.push(255); left -= 255 }
    lacing.push(left)
  }
  const head = Buffer.alloc(27 + lacing.length)
  head.write('OggS', 0, 'latin1')
  head[5] = flags
  head.writeBigInt64LE(BigInt(granule), 6)
  head.writeUInt32LE(serial, 14)
  head.writeUInt32LE(seq, 18)
  head[26] = lacing.length
  lacing.forEach((v, i) => { head[27 + i] = v })
  const page = Buffer.concat([head, ...packets])
  page.writeUInt32LE(oggCrc(page), 22)
  return page
}

/**
 * Wraps raw Opus packets (as Discord delivers them: 48 kHz, 20 ms each) into an Ogg Opus file
 * (RFC 7845) — what the transcription API accepts — without decoding any audio.
 */
export function oggFromOpus(packets, { channels = 2, frameSamples = 960, serial = 0x6372656c } = {}) {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'latin1')
  head[8] = 1
  head[9] = channels
  head.writeUInt16LE(312, 10) // pre-skip: the usual encoder delay
  head.writeUInt32LE(48000, 12)
  const vendor = Buffer.from('creliobot')
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0, 'latin1')
  tags.writeUInt32LE(vendor.length, 8)
  vendor.copy(tags, 12)
  const pages = [oggPage({ serial, seq: 0, granule: 0, flags: 2, packets: [head] }), oggPage({ serial, seq: 1, granule: 0, flags: 0, packets: [tags] })]
  // A page holds at most 255 lacing values (a packet takes floor(len / 255) + 1 of them).
  let granule = 312
  let chunk = []
  let lacing = 0
  const flush = last => {
    granule += chunk.length * frameSamples
    pages.push(oggPage({ serial, seq: pages.length, granule, flags: last ? 4 : 0, packets: chunk }))
    chunk = []
    lacing = 0
  }
  for (const p of packets) {
    const need = Math.floor(p.length / 255) + 1
    if (lacing + need > 255 || chunk.length >= 50) flush(false)
    chunk.push(p)
    lacing += need
  }
  flush(true)
  return Buffer.concat(pages)
}

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
