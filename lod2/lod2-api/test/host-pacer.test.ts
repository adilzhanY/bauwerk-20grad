import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HostPacer } from '../src/host-pacer.ts'

test('concurrent callers to one host get consecutive slots', () => {
  const pacer = new HostPacer(250, () => 1000)
  assert.equal(pacer.reserve('https://a.test/x'), 0)
  assert.equal(pacer.reserve('https://a.test/y'), 250)
  assert.equal(pacer.reserve('https://a.test/z'), 500)
})

test('hosts are paced independently', () => {
  const pacer = new HostPacer(250, () => 0)
  assert.equal(pacer.reserve('https://a.test/'), 0)
  assert.equal(pacer.reserve('https://b.test/'), 0)
})

test('a slot in the past is not waited for', () => {
  let now = 0
  const pacer = new HostPacer(250, () => now)
  pacer.reserve('https://a.test/')
  now = 10_000
  assert.equal(pacer.reserve('https://a.test/'), 0)
})

test('a wait longer than maxWaitMs reserves nothing', () => {
  const pacer = new HostPacer(250, () => 0)
  pacer.reserve('https://a.test/')
  pacer.reserve('https://a.test/')
  assert.equal(pacer.reserve('https://a.test/', 400), null)
  assert.equal(pacer.reserve('https://a.test/', 500), 500)
})

test('wait resolves true once the slot comes up', async () => {
  const pacer = new HostPacer(5)
  assert.equal(await pacer.wait('https://a.test/'), true)
  assert.equal(await pacer.wait('https://a.test/'), true)
})
