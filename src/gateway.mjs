// One-off gateway login. Discord requires a bot to connect to the gateway at least once before it
// may send messages; Specialist bots otherwise only use REST (the Manager's gateway connection is
// held by the official Discord plugin in each session).

export function gatewayLogin(token, { intents = 1, timeoutMs = 15_000, url = process.env.CRELIO_DISCORD_GATEWAY ?? 'wss://gateway.discord.gg/?v=10&encoding=json' } = {}) {
  // Tests run against a fake REST API and have no gateway to log in to.
  if (url === 'off') return Promise.resolve({ skipped: true })
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let heartbeat
    const done = (fn, v) => { clearInterval(heartbeat); clearTimeout(timer); try { ws.close() } catch {} fn(v) }
    const timer = setTimeout(() => done(reject, new Error('gateway login timed out')), timeoutMs)
    ws.onmessage = ev => {
      const p = JSON.parse(ev.data)
      if (p.op === 10) {
        heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: null })), p.d.heartbeat_interval)
        ws.send(JSON.stringify({ op: 2, d: { token, intents, properties: { os: process.platform, browser: 'creliobot', device: 'creliobot' } } }))
      } else if (p.op === 0 && p.t === 'READY') {
        done(resolve, { user: p.d.user, guilds: p.d.guilds?.map(g => g.id) ?? [] })
      } else if (p.op === 9) {
        done(reject, new Error('gateway refused the session (invalid token or intents)'))
      }
    }
    ws.onclose = ev => {
      if (ev.code === 4004) done(reject, new Error('gateway: authentication failed — the token is invalid'))
      else if (ev.code === 4014) done(reject, new Error('gateway: a privileged intent is not enabled in the Developer Portal'))
    }
    ws.onerror = () => {}
  })
}
