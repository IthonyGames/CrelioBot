// Minimal Discord REST client (ADR-0005: no dependencies). One client per bot token.

export const DISCORD_API = 'https://discord.com/api/v10'
export const FLAGS = { SUPPRESS_EMBEDS: 1 << 2, SUPPRESS_NOTIFICATIONS: 1 << 12, IS_VOICE_MESSAGE: 1 << 13 }
export const THREAD_TYPES = new Set([10, 11, 12])
export const SNOWFLAKE = /^\d{17,20}$/
export const MAX_FILE_BYTES = 20 * 1024 * 1024

export class DiscordError extends Error {
  name = 'DiscordError'
  constructor(method, path, status, data) {
    const hint = {
      401: 'the bot token is invalid',
      403: 'the bot lacks a permission here',
      404: 'not found (deleted, or the bot cannot see it)',
    }[status]
    super(`Discord ${method} ${path} → HTTP ${status}${data?.code ? ` (code ${data.code})` : ''}: ${data?.message ?? 'error'}${hint ? ` — ${hint}` : ''}`)
    this.status = status
    this.code = data?.code
    this.data = data
  }
}

export function discordClient(token, { api = process.env.CRELIO_DISCORD_API ?? DISCORD_API, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!token) throw new Error('discordClient needs a bot token')
  async function request(method, path, { json, form, reason } = {}) {
    for (let attempt = 0; ; attempt++) {
      const headers = { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (https://github.com/IthonyGames/CrelioBot, 0.1)' }
      if (json !== undefined) headers['Content-Type'] = 'application/json'
      if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason)
      const res = await fetchImpl(api + path, { method, headers, body: form ?? (json !== undefined ? JSON.stringify(json) : undefined) })
      if (res.status === 204) return null
      const data = await res.json().catch(() => ({}))
      if (res.status === 429 && attempt < 4) {
        await sleep(Math.ceil((Number(data.retry_after) || 1) * 1000) + 50)
        continue
      }
      if (res.status >= 500 && attempt < 1) {
        await sleep(1000)
        continue
      }
      if (!res.ok) throw new DiscordError(method, path, res.status, data)
      return data
    }
  }
  return {
    request,
    get: (path, o) => request('GET', path, o),
    post: (path, json, o) => request('POST', path, { ...o, json }),
    patch: (path, json, o) => request('PATCH', path, { ...o, json }),
    put: (path, json, o) => request('PUT', path, { ...o, json }),
    delete: (path, o) => request('DELETE', path, o),
    postForm: (path, form, o) => request('POST', path, { ...o, form }),
  }
}
