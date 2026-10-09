import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oggVoiceInfo, isOggOpus } from '../src/ogg.mjs'
import { oggOpusSample } from './ogg-sample.mjs'

test('duration comes from the last granule position minus pre-skip, at 48 kHz', () => {
  const buf = oggOpusSample({ seconds: 3.5, preSkip: 312 })
  assert.equal(oggVoiceInfo(buf).duration_secs, 3.5)
})

test('the waveform has at most 256 points scaled to 0-255', () => {
  const long = oggVoiceInfo(oggOpusSample({ seconds: 20 }))
  const bytes = Buffer.from(long.waveform, 'base64')
  assert.equal(bytes.length, 256)
  assert.equal(Math.max(...bytes), 255)
  const short = Buffer.from(oggVoiceInfo(oggOpusSample({ seconds: 1, pageSeconds: 0.1 })).waveform, 'base64')
  assert.equal(short.length, 10)
})

test('anything that is not Ogg Opus is refused', () => {
  assert.equal(isOggOpus(Buffer.from('ID3 not an ogg file at all, mp3 header here.....')), false)
  assert.throws(() => oggVoiceInfo(Buffer.from('nope')), /not an Ogg Opus stream/)
})
