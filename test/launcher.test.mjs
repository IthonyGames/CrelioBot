import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLoop, restartDelay, windowsCommandLine } from '../src/launcher.mjs'

test('a session that exits is restarted until the stop flag is set', async () => {
  let runs = 0
  let stop = false
  const delays = []
  await runLoop({
    start: async () => { runs++; if (runs === 3) stop = true; return 0 },
    shouldStop: () => stop,
    sleep: async ms => { delays.push(ms) },
    now: (() => { let t = 0; return () => (t += 60_000) })(),
    log: () => {},
  })
  assert.equal(runs, 3)
  assert.equal(delays.length, 2)
})

test('the loop does not start at all when the stop flag is already set', async () => {
  let runs = 0
  await runLoop({ start: async () => { runs++ }, shouldStop: () => true, sleep: async () => {}, log: () => {} })
  assert.equal(runs, 0)
})

test('a session that keeps crashing right away backs off, up to a minute', () => {
  assert.equal(restartDelay(0), 3_000)
  assert.equal(restartDelay(1), 3_000)
  assert.equal(restartDelay(2), 6_000)
  assert.equal(restartDelay(3), 12_000)
  assert.equal(restartDelay(10), 60_000)
})

test('quick crashes count up and a long run resets the backoff', async () => {
  const uptimes = [1_000, 1_000, 1_000, 120_000, 1_000]
  let i = 0
  let clock = 0
  const delays = []
  await runLoop({
    start: async () => { clock += uptimes[i++]; return 1 },
    shouldStop: () => i >= uptimes.length,
    sleep: async ms => { delays.push(ms) },
    now: () => clock,
    log: () => {},
  })
  assert.deepEqual(delays, [3_000, 6_000, 12_000, 3_000])
})

test('Windows command lines quote arguments with spaces for cmd.exe', () => {
  assert.equal(
    windowsCommandLine('C:\\Program Files\\claude.cmd', ['--name', 'crelio-alpha', '--settings', 'C:\\My Files\\s.json', 'say "hi"']),
    '"C:\\Program Files\\claude.cmd" --name crelio-alpha --settings "C:\\My Files\\s.json" "say ""hi"""',
  )
})
