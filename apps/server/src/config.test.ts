import { describe, expect, test } from 'vitest'
import { parseArgs } from './config'

const { flags } = await Bun.file(
  new URL('../../../testdata/contracts/launch.json', import.meta.url)
).json()

describe('parseArgs', () => {
  test('parses the flags in the launch contract', () => {
    expect(
      parseArgs([flags.port, '9100', flags.exitOnStdinClose])
    ).toMatchObject({ port: 9100, exitOnStdinClose: true })
  })
  test('defaults', () => {
    expect(parseArgs([])).toEqual({
      port: 3660,
      reconnectGraceMs: 3000,
      exitOnStdinClose: false,
    })
  })
  test('flags', () => {
    expect(
      parseArgs([
        '--port',
        '9100',
        '--reconnect-grace',
        '500',
        '--exit-on-stdin-close',
      ])
    ).toEqual({ port: 9100, reconnectGraceMs: 500, exitOnStdinClose: true })
  })
  test('--exit-on-stdin-close takes no value', () => {
    expect(parseArgs(['--exit-on-stdin-close', '--port', '1'])).toEqual({
      port: 1,
      reconnectGraceMs: 3000,
      exitOnStdinClose: true,
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
