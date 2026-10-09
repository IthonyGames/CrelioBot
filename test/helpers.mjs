// Test helpers: build a throwaway Workspace on disk.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REPO = join(import.meta.dirname, '..')

export function snowflake(n) {
  return String(100000000000000000n + BigInt(n))
}

const SPECIALISTS = ['kb-researcher', 'web-researcher', 'brainstormer', 'artist', 'ux-expert', 'marketing', 'lawyer', 'planner', 'coder']

export function kbProfile(id, n, overrides = {}) {
  const agents = Object.fromEntries(SPECIALISTS.map((a, i) => [a, snowflake(n * 100 + 10 + i)]))
  return {
    id,
    name: id.toUpperCase(),
    path: overrides.path,
    language: 'fr',
    permission: 'guarded',
    tasks: { adapter: 'local-board' },
    discord: { category_id: snowflake(n * 100), general_id: snowflake(n * 100 + 1), agents },
    ...overrides,
  }
}

export function makeWorkspace({ kbs = ['alpha'], settings = {}, env = {}, profiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'crelio-test-'))
  const ws = join(root, 'workspace')
  mkdirSync(join(ws, 'kbs'), { recursive: true })
  const bots = Object.fromEntries(['manager', ...SPECIALISTS].map((a, i) => [a, {
    token_env: `DISCORD_TOKEN_${a.toUpperCase().replace(/-/g, '_')}`,
    user_id: snowflake(9000 + i),
    app_id: snowflake(9000 + i),
  }]))
  writeFileSync(join(ws, 'crelio.json'), JSON.stringify({
    server: { guild_id: snowflake(1), owner_id: snowflake(2) },
    language: 'en',
    global_general: { channel_id: snowflake(3) },
    router: { enabled: true, permission: 'guarded' },
    bots,
    hop_budget: 12,
    ...settings,
  }, null, 2))
  const secrets = Object.values(bots).map(b => `${b.token_env}=token-${b.token_env}`)
  secrets.push('OPENAI_API_KEY=sk-test', ...Object.entries(env).map(([k, v]) => `${k}=${v}`))
  writeFileSync(join(ws, '.env'), secrets.join('\n') + '\n')
  kbs.forEach((id, i) => {
    const path = join(root, 'kbs', id)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(ws, 'kbs', `${id}.json`), JSON.stringify(kbProfile(id, i + 1, { path, ...profiles[id] }), null, 2))
  })
  return { root, ws }
}
