// Git helpers for KBs that pull on start: run the pull with its output captured, and spot the
// problems that make it fail silently (a stale index.lock left by a crashed git, local changes).

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const STALE_MS = 10 * 60 * 1000

/** A .git/index.lock older than 10 minutes is left over from a crashed git and blocks every write. */
export function staleLock(repo, now = Date.now()) {
  const lock = join(repo, '.git', 'index.lock')
  if (!existsSync(lock)) return null
  const age = now - statSync(lock).mtimeMs
  return age > STALE_MS ? { path: lock, minutes: Math.round(age / 60000) } : null
}

export function localChanges(repo) {
  const out = spawnSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).stdout ?? ''
  return out.split('\n').filter(Boolean).length
}

/** git pull --ff-only; returns { ok, reason } with Git's own explanation when it fails. */
export function pullFastForward(repo) {
  const lock = staleLock(repo)
  if (lock) return { ok: false, reason: `stale git lock (${lock.minutes} min old): ${lock.path} — delete it if no git is running` }
  const res = spawnSync('git', ['-C', repo, 'pull', '--ff-only'], { encoding: 'utf8' })
  if (res.status === 0) return { ok: true, reason: (res.stdout ?? '').trim().split('\n').at(-1) }
  const text = `${res.stderr ?? ''}\n${res.stdout ?? ''}`
  const files = [...text.matchAll(/^\t(.+)$/gm)].map(m => m[1].trim())
  const why = /would be overwritten/.test(text)
    ? `local changes conflict with incoming commits${files.length ? ` (${files.slice(0, 5).join(', ')}${files.length > 5 ? ', …' : ''})` : ''} — commit or stash them, then restart`
    : /divergent|not possible to fast-forward/i.test(text)
      ? 'the local branch has commits that are not on the remote — push or rebase them, then restart'
      : text.trim().split('\n').find(l => /^(error|fatal):/.test(l)) ?? 'git pull failed'
  return { ok: false, reason: why }
}
