// Shared by the guard hooks of the "guarded" permission level (generated into each session's settings).
// The allowed roots are the session's folder (the KB, or the Workspace for the Router) and its inbox.

import { realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { loadInstance } from '../src/instance.mjs'

export function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }))
  process.exit(0)
}

export async function readInput() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  try { return JSON.parse(raw) } catch { deny('guard: unreadable hook input') }
}

function real(p) {
  try { return realpathSync(p) } catch { return resolve(p) } // not created yet: judge the intended location
}

export function sessionRoots() {
  const session = process.env.CRELIO_SESSION
  const workspace = process.env.CRELIO_WORKSPACE
  if (!session || !workspace) deny('guard: not a CrelioBot session (CRELIO_SESSION/CRELIO_WORKSPACE missing)')
  const instance = loadInstance(workspace, { repoDir: process.env.CRELIO_HOME })
  const folder = session === 'router' ? instance.workspaceDir : instance.kb(session).path
  const inbox = join(instance.stateDir(session), 'discord', 'inbox')
  return {
    instance,
    roots: [folder, inbox].map(p => real(p).toLowerCase()),
    secrets: [join(instance.workspaceDir, '.env'), join(instance.workspaceDir, 'state')].map(p => real(p).toLowerCase()),
    inbox: real(inbox).toLowerCase(),
  }
}

export function isInside(path, dirs) {
  const p = real(path).toLowerCase()
  return dirs.some(d => p === d || p.startsWith(d.endsWith(sep) ? d : d + sep))
}

/** Git Bash /c/Users/… → C:/Users/…, ~ → home; then resolve against cwd. */
export function toNativePath(p, cwd) {
  if (process.platform === 'win32' && /^\/[a-z](\/|$)/i.test(p)) p = `${p[1]}:${p.slice(2) || '/'}`
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(process.env.USERPROFILE ?? process.env.HOME ?? '', p.slice(1))
  return resolve(cwd, p)
}
