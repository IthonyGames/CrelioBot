// Builds a structurally valid Ogg Opus stream (page headers, OpusHead, OpusTags, audio pages with
// granule positions and varying sizes). The payload is filler, which is all the parser reads.

function page(granule, payload, seq, flags = 0) {
  const segs = []
  let left = payload.length
  while (left >= 255) { segs.push(255); left -= 255 }
  segs.push(left)
  const h = Buffer.alloc(27 + segs.length)
  h.write('OggS', 0, 'latin1')
  h[5] = flags
  h.writeBigInt64LE(BigInt(granule), 6)
  h.writeUInt32LE(1234, 14)
  h.writeUInt32LE(seq, 18)
  h[26] = segs.length
  segs.forEach((s, i) => (h[27 + i] = s))
  return Buffer.concat([h, payload])
}

export function oggOpusSample({ seconds = 2, preSkip = 312, pageSeconds = 0.06 } = {}) {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'latin1')
  head[8] = 1
  head[9] = 1
  head.writeUInt16LE(preSkip, 10)
  head.writeUInt32LE(48000, 12)
  const tags = Buffer.from('OpusTags\x08\x00\x00\x00crelio\x00\x00\x00\x00', 'latin1')
  const pages = [page(0, head, 0, 2), page(0, tags, 1)]
  const count = Math.round(seconds / pageSeconds)
  for (let i = 1; i <= count; i++) {
    const size = 40 + Math.round(200 * Math.abs(Math.sin(i / 3)))
    const granule = i === count ? Math.round(seconds * 48000) + preSkip : Math.round(i * pageSeconds * 48000) + preSkip
    pages.push(page(granule, Buffer.alloc(size, 7), i + 1, i === count ? 4 : 0))
  }
  return Buffer.concat(pages)
}
