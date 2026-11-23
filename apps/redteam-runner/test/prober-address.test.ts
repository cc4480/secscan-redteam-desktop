/**
 * Loopback-by-name classification. Only the exact name `localhost` and literal
 * private or loopback addresses count as private by name. Other `*.localhost`
 * names are public names: a resolved loopback address is refused at connect
 * time, so the name alone never grants the private-address allowance.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPrivateOrLoopbackHost } from '../src/prober-address.js'

describe('isPrivateOrLoopbackHost', () => {
  it('treats the exact name localhost and loopback or private literals as private', () => {
    assert.equal(isPrivateOrLoopbackHost('localhost'), true)
    assert.equal(isPrivateOrLoopbackHost('LOCALHOST'), true)
    assert.equal(isPrivateOrLoopbackHost('127.0.0.1'), true)
    assert.equal(isPrivateOrLoopbackHost('[::1]'), true)
    assert.equal(isPrivateOrLoopbackHost('2130706433'), true)
    assert.equal(isPrivateOrLoopbackHost('10.1.2.3'), true)
  })

  it('does not treat *.localhost names as private by name', () => {
    assert.equal(isPrivateOrLoopbackHost('app.localhost'), false)
    assert.equal(isPrivateOrLoopbackHost('a.b.localhost'), false)
  })

  it('leaves public names and public addresses alone', () => {
    assert.equal(isPrivateOrLoopbackHost('example.com'), false)
    assert.equal(isPrivateOrLoopbackHost('8.8.8.8'), false)
    assert.equal(isPrivateOrLoopbackHost('cho-zen1'), false)
  })
})
