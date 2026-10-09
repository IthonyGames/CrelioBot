import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadInstance } from '../src/instance.mjs'
import { makeWorkspace, REPO } from './helpers.mjs'

const { ws, root } = makeWorkspace({ kbs: ['alpha', 'beta'] })
const instance = loadInstance(ws, { repoDir: REPO })
const kb = instance.kb('alpha').path
const other = instance.kb('beta').path
const inbox = join(instance.stateDir('alpha'), 'discord', 'inbox')
mkdirSync(inbox, { recursive: true })
writeFileSync(join(kb, 'notes.md'), 'hi')
writeFileSync(join(inbox, 'voice.ogg'), 'x')
writeFileSync(join(other, 'secret.md'), 'beta only')

function hook(script, input, session = 'alpha') {
  const res = spawnSync(process.execPath, [join(REPO, 'hooks', script)], {
    input: JSON.stringify(input),
    env: { ...process.env, CRELIO_SESSION: session, CRELIO_WORKSPACE: ws, CRELIO_HOME: REPO },
    encoding: 'utf8',
  })
  assert.equal(res.status, 0, res.stderr)
  return res.stdout ? JSON.parse(res.stdout).hookSpecificOutput : null
}
const bash = (command, cwd = kb, session) => hook('guard-bash.mjs', { tool_input: { command }, cwd }, session)
const files = (list, session) => hook('guard-files.mjs', { tool_input: { files: list } }, session)

test('commands inside the KB pass', () => {
  for (const c of ['git status', 'git add notes.md', 'npm test', 'ls ./src', `cat "${join(kb, 'notes.md')}"`, 'git commit -m "fix ../ path in docs"', 'curl https://example.com/a/../b']) {
    assert.equal(bash(c), null, c)
  }
})

test('paths outside the KB are refused, in Windows, Git Bash and relative forms', () => {
  const outside = [
    `cat "${join(other, 'secret.md')}"`,
    `git diff --no-index notes.md ${other.replaceAll('\\', '/')}/secret.md`,
    'cd ..',
    'cat ../beta/secret.md',
    'cat ~/.ssh/id_rsa',
    'npm --prefix=../beta install',
  ]
  if (process.platform === 'win32') outside.push('ls /c/Windows', 'type C:\\Windows\\win.ini')
  for (const c of outside) assert.equal(bash(c)?.permissionDecision, 'deny', c)
})

test('a working directory outside the KB is refused', () => {
  assert.equal(bash('git status', other)?.permissionDecision, 'deny')
})

test('CrelioBot secrets are refused even to the Router, whose folder is the Workspace', () => {
  assert.equal(bash(`cat "${join(ws, '.env')}"`, ws, 'router')?.permissionDecision, 'deny')
  assert.equal(bash(`cat "${join(ws, 'state', 'alpha', 'discord', 'access.json')}"`, ws, 'router')?.permissionDecision, 'deny')
  assert.equal(bash(`cat "${join(ws, 'kbs', 'alpha.json')}"`, ws, 'router'), null)
})

test('attachments must come from the KB or the session inbox', () => {
  assert.equal(files([join(kb, 'notes.md'), join(inbox, 'voice.ogg')]), null)
  assert.equal(files([join(other, 'secret.md')])?.permissionDecision, 'deny')
  assert.equal(files([join(ws, '.env')], 'router')?.permissionDecision, 'deny')
  assert.equal(files([join(root, 'anything.txt')])?.permissionDecision, 'deny')
  assert.equal(hook('guard-files.mjs', { tool_input: { text: 'no files' } }), null)
})
