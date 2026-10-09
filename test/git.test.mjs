import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localChanges, pullFastForward, staleLock } from '../src/git.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// A remote, a KB clone, and a second clone that pushes new commits — like a KB edited from two places.
function repos() {
  const root = mkdtempSync(join(tmpdir(), 'crelio-git-'))
  const remote = join(root, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  const other = join(root, 'other')
  execFileSync('git', ['clone', '-q', remote, other], { stdio: 'ignore' })
  writeFileSync(join(other, 'log.md'), '# Log\n- one\n')
  git(other, 'add', '.'); git(other, 'commit', '-q', '-m', 'init'); git(other, 'push', '-q', 'origin', 'HEAD:main')
  const kb = join(root, 'kb')
  execFileSync('git', ['clone', '-q', remote, kb], { stdio: 'ignore' })
  const pushChange = text => { writeFileSync(join(other, 'log.md'), text); git(other, 'commit', '-q', '-am', 'remote change'); git(other, 'push', '-q', 'origin', 'HEAD:main') }
  return { kb, pushChange }
}

test('a clean KB fast-forwards', () => {
  const { kb, pushChange } = repos()
  pushChange('# Log\n- one\n- two\n')
  assert.equal(pullFastForward(kb).ok, true)
})

test('local changes that conflict with incoming commits are named', () => {
  const { kb, pushChange } = repos()
  pushChange('# Log\n- one\n- remote\n')
  writeFileSync(join(kb, 'log.md'), '# Log\n- one\n- local\n')
  assert.equal(localChanges(kb), 1)
  const res = pullFastForward(kb)
  assert.equal(res.ok, false)
  assert.match(res.reason, /local changes conflict with incoming commits \(log\.md\)/)
})

test('a stale index.lock is detected before git fails on it', () => {
  const { kb } = repos()
  const lock = join(kb, '.git', 'index.lock')
  writeFileSync(lock, '')
  assert.equal(staleLock(kb), null, 'a fresh lock may belong to a running git')
  const old = (Date.now() - 3 * 3600_000) / 1000
  utimesSync(lock, old, old)
  assert.equal(staleLock(kb).minutes >= 179, true)
  assert.match(pullFastForward(kb).reason, /stale git lock/)
})
