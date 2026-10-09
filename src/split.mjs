// Split text into Discord-sized messages: paragraph boundaries first, then lines, then hard cuts.
// A code block cut in two is closed at the end of one message and reopened in the next.

export function splitMessage(text, limit = 2000) {
  const src = String(text ?? '')
  if (src.length <= limit) return src ? [src] : []
  const out = []
  let rest = src
  let reopen = '' // fence line to reopen at the start of the next chunk
  while (rest.length) {
    const room = limit - reopen.length - 4 // keep space to close an open fence
    let chunk
    if (reopen.length + rest.length <= limit) {
      chunk = rest
    } else {
      const window = rest.slice(0, room)
      const cut = Math.max(window.lastIndexOf('\n\n'), -1)
      const at = cut > room * 0.3 ? cut : window.lastIndexOf('\n') > room * 0.3 ? window.lastIndexOf('\n') : room
      chunk = rest.slice(0, at)
    }
    rest = rest.slice(chunk.length).replace(/^\n+/, '')
    let piece = reopen + chunk
    const fences = piece.match(/^```.*$/gm) ?? []
    if (fences.length % 2 === 1) {
      reopen = fences.at(-1) + '\n'
      piece += '\n```'
    } else {
      reopen = ''
    }
    out.push(piece)
  }
  return out
}
