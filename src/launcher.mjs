// Launcher: opens one console window per session and keeps each session alive.
//   start   → one window per session (Windows Terminal tab or console window; tmux elsewhere)
//   run     → the restart loop inside a window: regenerate files, (git pull), run claude, repeat
//   stop    → stop flag + end every running claude
// Sessions never prompt on start (ADR-0002), so a restart needs nobody at the keyboard.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { CALLS, loadInstance } from './instance.mjs'
import { buildSession, cleanEnv, writeSessionFiles } from './runtime.mjs'
import { pullFastForward } from './git.mjs'

const MIN_UPTIME_MS = 30_000

export function restartDelay(quickCrashes) {
  return Math.min(60_000, 3_000 * 2 ** Math.max(0, quickCrashes - 1))
}

export async function runLoop({ start, shouldStop, sleep, log, now = Date.now }) {
  let quickCrashes = 0
  while (!shouldStop()) {
    const startedAt = now()
    const code = await start()
    if (shouldStop()) break
    quickCrashes = now() - startedAt < MIN_UPTIME_MS ? quickCrashes + 1 : 0
    const delay = restartDelay(quickCrashes)
    log(`session exited (code ${code}) — restarting in ${Math.round(delay / 1000)}s`)
    await sleep(delay)
  }
}

/** cmd.exe command line: quote anything with spaces or quotes, doubling inner quotes. */
export function windowsCommandLine(file, args) {
  const q = a => (/[\s"&|<>^]/.test(a) || a === '' ? `"${a.replaceAll('"', '""')}"` : a)
  return [file, ...args].map(q).join(' ')
}

export function findExecutable(name, env = process.env) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, name + ext)
      if (existsSync(p)) return p
    }
  }
  return null
}

function stopFlag(instance) { return join(instance.workspaceDir, 'state', 'STOP') }

/** The Call service runs when its optional dependencies are installed (crelio calls install, ADR-0007). */
export function callsInstalled(repoDir) {
  return existsSync(join(repoDir, 'calls', 'node_modules', '@discordjs', 'voice'))
}

/** Windows the launcher keeps running: the sessions, plus the Call service when installed. */
export function launchIds(instance) {
  return [...instance.sessions(), ...(callsInstalled(instance.repoDir) ? [CALLS] : [])]
}

export function pidFile(instance, id) {
  return join(instance.stateDir(id), id === CALLS ? 'service.pid' : 'claude.pid')
}

/** Runs an interactive claude in this console (stdio inherited). */
export function spawnClaude(claudePath, { args, cwd, env }) {
  const opts = { cwd, env, stdio: 'inherit' }
  // Node refuses to spawn .cmd/.bat directly on Windows; go through cmd.exe with our own quoting.
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath)) {
    return spawn('cmd.exe', ['/d', '/s', '/c', `"${windowsCommandLine(claudePath, args)}"`], { ...opts, windowsVerbatimArguments: true })
  }
  return spawn(claudePath, args, opts)
}

/** The restart loop for one session (runs inside its window). */
export async function runSession(workspaceDir, id, { repoDir } = {}) {
  const first = loadInstance(workspaceDir, { repoDir })
  const logFile = join(first.stateDir(id), 'session.log')
  mkdirSync(first.stateDir(id), { recursive: true })
  const log = msg => {
    const line = `[${new Date().toISOString()}] ${msg}`
    console.log(line)
    appendFileSync(logFile, line + '\n')
  }
  // Ctrl+C belongs to the claude session in this window; the loop itself ignores it.
  process.on('SIGINT', () => {})

  await runLoop({
    shouldStop: () => existsSync(stopFlag(first)),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    log,
    start: async () => {
      if (id === CALLS) {
        log('starting the Call service')
        const child = spawn(process.execPath, [join(first.repoDir, 'calls', 'service.mjs')], {
          cwd: join(first.repoDir, 'calls'),
          env: { ...cleanEnv(process.env), CRELIO_WORKSPACE: first.workspaceDir, CRELIO_HOME: first.repoDir },
          stdio: 'inherit',
        })
        writeFileSync(pidFile(first, id), String(child.pid))
        return new Promise(resolve => {
          child.on('exit', code => resolve(code))
          child.on('error', err => { log(`could not start the Call service: ${err.message}`); resolve(-1) })
        })
      }
      // Re-read the Workspace each time so profile edits apply on the next restart.
      const instance = loadInstance(workspaceDir, { repoDir })
      const session = buildSession(instance, id)
      writeSessionFiles(session)
      const kb = id === 'router' ? null : instance.kb(id)
      if (kb?.pull_on_start && existsSync(join(kb.path, '.git'))) {
        const pull = pullFastForward(kb.path)
        log(pull.ok ? `git pull: ${pull.reason}` : `git pull skipped — ${pull.reason}. Starting on the current state.`)
      }
      const claude = instance.settings.claude_path ?? findExecutable('claude', session.env)
      if (!claude) throw new Error('Claude Code (claude) not found on PATH — install it, or set "claude_path" in crelio.json')
      log(`starting ${session.name} (${session.permission}) in ${session.cwd}`)
      const child = spawnClaude(claude, session)
      writeFileSync(join(session.stateDir, 'claude.pid'), String(child.pid))
      return new Promise(resolve => {
        child.on('exit', code => resolve(code))
        child.on('error', err => { log(`could not start claude: ${err.message}`); resolve(-1) })
      })
    },
  })
  log('stop flag set — loop ended')
}

/** Opens one window per session. */
export function startAll(workspaceDir, { repoDir, only } = {}) {
  const instance = loadInstance(workspaceDir, { repoDir })
  rmSync(stopFlag(instance), { force: true })
  const ids = only?.length ? only : launchIds(instance)
  for (const id of ids) if (id !== CALLS) buildSession(instance, id) // fail fast on configuration errors, before opening anything
  const node = process.execPath
  const cli = join(instance.repoDir, 'bin', 'crelio.mjs')
  const env = { ...cleanEnv(process.env), CRELIO_WORKSPACE: instance.workspaceDir }
  const opened = []

  if (process.platform === 'win32') {
    const wt = findExecutable('wt', env)
    for (const id of ids) {
      const title = `CrelioBot - ${id === 'router' ? 'Router' : id === CALLS ? 'Calls' : (instance.kb(id).name ?? id)}`
      const dir = instance.stateDir(id)
      mkdirSync(dir, { recursive: true })
      const windowCmd = join(dir, 'window.cmd')
      writeFileSync(windowCmd, [
        '@echo off',
        `title ${title.replace(/[&|<>^]/g, '')}`,
        `"${node}" "${cli}" run ${id}`,
        'if errorlevel 1 pause',
        '',
      ].join('\r\n'))
      const line = wt
        ? `"${wt}" -w creliobot new-tab --title "${title}" cmd /c "${windowCmd}"`
        : `start "${title}" cmd /c "${windowCmd}"`
      spawn('cmd.exe', ['/d', '/c', line], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore', env }).unref()
      opened.push(title)
    }
    return opened
  }

  if (!findExecutable('tmux', env)) throw new Error('tmux is required on macOS/Linux to keep sessions in terminals — install it (brew install tmux / apt install tmux)')
  const has = spawnSync('tmux', ['has-session', '-t', 'creliobot']).status === 0
  ids.forEach((id, i) => {
    const cmd = `"${node}" "${cli}" run ${id}`
    const args = !has && i === 0
      ? ['new-session', '-d', '-s', 'creliobot', '-n', id, cmd]
      : ['new-window', '-t', 'creliobot', '-n', id, cmd]
    spawnSync('tmux', args, { env, stdio: 'inherit' })
    opened.push(id)
  })
  return opened
}

/** True when pid is still a Claude Code process (or the cmd.exe wrapping it) — PIDs get reused. */
export function isSessionProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (process.platform === 'win32') {
    const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
    const name = out.match(/^"([^"]+)"/)?.[1]?.toLowerCase()
    return name === 'claude.exe' || name === 'cmd.exe' || name === 'node.exe'
  }
  const out = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).stdout ?? ''
  return /claude|node/.test(out)
}

/** Ends a session's claude process (and its children) if the PID still belongs to it. */
export function killSessionProcess(pid) {
  if (!isSessionProcess(pid)) return false
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else process.kill(pid, 'SIGTERM')
  return true
}

/** Sets the stop flag and ends every running claude session. */
export function stopAll(workspaceDir, { repoDir } = {}) {
  const instance = loadInstance(workspaceDir, { repoDir })
  mkdirSync(join(instance.workspaceDir, 'state'), { recursive: true })
  writeFileSync(stopFlag(instance), new Date().toISOString())
  const stopped = []
  for (const id of [...instance.sessions(), CALLS]) {
    const file = pidFile(instance, id)
    if (!existsSync(file)) continue
    try { if (killSessionProcess(Number(readFileSync(file, 'utf8')))) stopped.push(id) } catch {}
    rmSync(file, { force: true })
  }
  return stopped
}
