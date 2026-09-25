import { describe, expect, test } from 'vitest'
import {
  parseExtensionFrame,
  parseServerFrame,
  requestFrameSchema,
} from './envelope'

describe('envelope', () => {
  test('request frame round-trips', () => {
    const f = {
      id: '1',
      type: 'click',
      payload: { ref: 's1e1', mode: 'compact' },
    }
    expect(requestFrameSchema.parse(f)).toEqual(f)
    expect(parseServerFrame(JSON.stringify(f))).toEqual(f)
  })

  test('server frames accept ping and pong', () => {
    expect(parseServerFrame('{"type":"ping"}')).toEqual({ type: 'ping' })
    expect(parseServerFrame('{"type":"pong"}')).toEqual({ type: 'pong' })
  })

  test('extension frames: ok, error, hello', () => {
    expect(
      parseExtensionFrame('{"id":"1","ok":true,"result":{"url":"u"}}')
    ).toEqual({ id: '1', ok: true, result: { url: 'u' } })
    expect(
      parseExtensionFrame(
        '{"id":"1","ok":false,"error":{"code":"NO_TAB","message":"m"}}'
      )
    ).toEqual({ id: '1', ok: false, error: { code: 'NO_TAB', message: 'm' } })
    expect(
      parseExtensionFrame('{"type":"hello","extensionVersion":"0.0.1"}')
    ).toEqual({ type: 'hello', extensionVersion: '0.0.1' })
  })

  test('invalid input yields null, never throws', () => {
    expect(parseServerFrame('not json')).toBeNull()
    expect(parseServerFrame('{"id":"1","type":"nope","payload":{}}')).toBeNull()
    expect(parseExtensionFrame('{"type":"hello"}')).toBeNull()
    expect(
      parseExtensionFrame(
        '{"id":"1","ok":false,"error":{"code":"BAD","message":"m"}}'
      )
    ).toBeNull()
  })

  test('a request frame with a bad command name is not reinterpreted as a ping', () => {
    expect(parseServerFrame('{"id":"1","type":"ping","payload":{}}')).toBeNull()
  })

  test('a response carrying both result and error is rejected, not treated as success', () => {
    expect(
      parseExtensionFrame(
        '{"id":"1","ok":true,"result":1,"error":{"code":"NO_TAB","message":"m"}}'
      )
    ).toBeNull()
  })

  test('excess keys reject pong, request and hello frames', () => {
    expect(parseServerFrame('{"type":"pong","extra":1}')).toBeNull()
    expect(parseExtensionFrame('{"type":"pong","extra":1}')).toBeNull()
    expect(
      parseServerFrame('{"id":"1","type":"click","payload":{},"extra":1}')
    ).toBeNull()
    expect(
      parseExtensionFrame(
        '{"type":"hello","extensionVersion":"0.0.1","extra":1}'
      )
    ).toBeNull()
  })

  test('each parser rejects frames meant for the other direction', () => {
    expect(
      parseServerFrame('{"id":"1","ok":true,"result":{"url":"u"}}')
    ).toBeNull()
    expect(
      parseServerFrame('{"type":"hello","extensionVersion":"0.0.1"}')
    ).toBeNull()
    expect(
      parseExtensionFrame(
        '{"id":"1","type":"click","payload":{"ref":"s1e1","mode":"compact"}}'
      )
    ).toBeNull()
  })
})
