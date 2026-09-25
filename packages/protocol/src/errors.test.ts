import { describe, expect, test } from 'vitest'
import { errorCodeSchema, ProtocolError, protocolErrorSchema } from './errors'

describe('errors', () => {
  test('enumerates exactly the eight spec codes', () => {
    expect(errorCodeSchema.options).toEqual([
      'NO_TAB',
      'STALE_REF',
      'REF_NOT_FOUND',
      'DEBUGGER_FAILED',
      'TIMEOUT',
      'NAVIGATION_FAILED',
      'DISCONNECTED',
      'INTERNAL',
    ])
  })

  test('ProtocolError carries code and message and is an Error', () => {
    const e = new ProtocolError('NO_TAB', 'no tab')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('NO_TAB')
    expect(e.message).toBe('no tab')
  })

  test('protocolErrorSchema rejects unknown codes', () => {
    expect(
      protocolErrorSchema.safeParse({ code: 'NOPE', message: 'x' }).success
    ).toBe(false)
    expect(
      protocolErrorSchema.safeParse({ code: 'TIMEOUT', message: 'x' }).success
    ).toBe(true)
  })
})
