import { describe, expect, test } from 'vitest'
import { captureDestination, parseLogLines } from '../tests/log-capture'
import { createLogger, scope } from './log'

describe('createLogger', () => {
  test('every line carries the service field', () => {
    const dest = captureDestination()
    const log = createLogger({
      service: 'agent-control-server',
      destination: dest,
    })
    log.info('booted')
    const [record] = parseLogLines(dest.lines)
    expect(record?.service).toBe('agent-control-server')
    expect(record?.msg).toBe('booted')
  })

  test('an error on the error key is serialized with type, message and stack', () => {
    const dest = captureDestination()
    const log = createLogger({ service: 'test', destination: dest })
    log.error({ error: new Error('boom') }, 'listener threw')
    const [record] = parseLogLines(dest.lines)
    const error = record?.error as Record<string, unknown>
    expect(error.type).toBe('Error')
    expect(error.message).toBe('boom')
    expect(typeof error.stack).toBe('string')
  })

  test('a top-level token is redacted', () => {
    const dest = captureDestination()
    const log = createLogger({ service: 'test', destination: dest })
    log.warn({ token: 'shh' }, 'test event')
    const [record] = parseLogLines(dest.lines)
    expect(record?.token).toBe('[REDACTED]')
    expect(dest.lines.join('')).not.toContain('shh')
  })

  test('a nested token one level down is redacted', () => {
    const dest = captureDestination()
    const log = createLogger({ service: 'test', destination: dest })
    log.warn(
      { frame: { type: 'hello', token: 'shh', extensionVersion: 1 } },
      'malformed extension frame'
    )
    const [record] = parseLogLines(dest.lines)
    const frame = record?.frame as Record<string, unknown>
    expect(frame.token).toBe('[REDACTED]')
    expect(dest.lines.join('')).not.toContain('shh')
  })
})

describe('scope', () => {
  test('adds a scope field without disturbing the base service field', () => {
    const dest = captureDestination()
    const log = scope(
      createLogger({ service: 'agent-control-server', destination: dest }),
      'bridge'
    )
    log.info('connected')
    const [record] = parseLogLines(dest.lines)
    expect(record?.service).toBe('agent-control-server')
    expect(record?.scope).toBe('bridge')
  })
})
