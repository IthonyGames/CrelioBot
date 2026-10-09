// Drives mcp/server.mjs over stdio the way Claude Code does.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { REPO } from './helpers.mjs'

export function startMcp(env) {
  const child = spawn(process.execPath, [join(REPO, 'mcp', 'server.mjs')], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const pending = new Map()
  let buf = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      pending.get(msg.id)?.(msg)
      pending.delete(msg.id)
    }
  })
  const request = (method, params) => new Promise(resolve => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return {
    request,
    async call(name, args) {
      const res = await request('tools/call', { name, arguments: args })
      const text = res.result?.content?.[0]?.text
      return { isError: !!res.result?.isError, text, data: res.result?.isError ? null : JSON.parse(text) }
    },
    close: () => new Promise(r => { child.on('exit', r); child.stdin.end() }),
  }
}
