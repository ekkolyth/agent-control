import { describe, expect, test } from 'vitest'
import { parseArgs } from './config'

describe('parseArgs', () => {
  test('defaults', () => {
    expect(parseArgs([])).toEqual({
      port: 3660,
      reconnectGraceMs: 3000,
    })
  })
  test('flags', () => {
    expect(parseArgs(['--port', '9100', '--reconnect-grace', '500'])).toEqual({
      port: 9100,
      reconnectGraceMs: 500,
    })
  })
  test('unknown flag throws', () => {
    expect(() => parseArgs(['--host', '0.0.0.0'])).toThrow(
      /unknown flag --host/
    )
  })
  test('non-numeric --port throws', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(
      /invalid value for --port/
    )
  })
  test('--port with no value throws', () => {
    expect(() => parseArgs(['--port'])).toThrow(/invalid value for --port/)
  })
  test('non-numeric --reconnect-grace throws', () => {
    expect(() => parseArgs(['--reconnect-grace', 'soon'])).toThrow(
      /invalid value for --reconnect-grace/
    )
  })
})
