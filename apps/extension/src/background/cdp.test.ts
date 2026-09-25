import { ProtocolError } from '@agent-control/protocol'
import { describe, expect, test, vi } from 'vitest'
import { Cdp } from './cdp'

function fakeApi(overrides: {
  attach?: () => Promise<unknown>
  detach?: () => Promise<unknown>
  sendCommand?: (
    target: { tabId: number },
    method: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>
}) {
  return {
    attach: vi.fn(overrides.attach ?? (async () => {})),
    detach: vi.fn(overrides.detach ?? (async () => {})),
    sendCommand: vi.fn(overrides.sendCommand ?? (async () => ({}))),
    onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
    onDetach: { addListener: vi.fn() },
  }
}

describe('Cdp', () => {
  test('treats an already-attached error as success, case-insensitively, and still enables Runtime', async () => {
    const api = fakeApi({
      attach: vi.fn(async () => {
        throw new Error(
          'Another debugger is ALREADY ATTACHED to the tab with id: 5.'
        )
      }),
    })
    const cdp = new Cdp({ api: api as never })

    await cdp.ensureAttached(5)

    expect(cdp.isAttached(5)).toBe(true)
    expect(api.sendCommand).toHaveBeenCalledWith(
      { tabId: 5 },
      'Runtime.enable',
      undefined
    )
    expect(api.sendCommand).toHaveBeenCalledWith(
      { tabId: 5 },
      'Network.enable',
      undefined
    )
  })

  test('a different attach failure still throws DEBUGGER_FAILED', async () => {
    const api = fakeApi({
      attach: vi.fn(async () => {
        throw new Error(
          'Cannot attach to this target: an attached client already exists.'
        )
      }),
    })
    const cdp = new Cdp({ api: api as never })

    await expect(cdp.ensureAttached(5)).rejects.toThrow(ProtocolError)
    expect(cdp.isAttached(5)).toBe(false)
  })

  test('marks attached only once Runtime.enable succeeds, and retries attach on the next call after a failed enable', async () => {
    let enableCalls = 0
    const api = fakeApi({
      sendCommand: vi.fn(async (_target, method) => {
        if (method === 'Runtime.enable') {
          enableCalls++
          if (enableCalls === 1) throw new Error('enable failed')
        }
        return {}
      }),
    })
    const cdp = new Cdp({ api: api as never })

    await expect(cdp.ensureAttached(5)).rejects.toThrow(ProtocolError)
    expect(cdp.isAttached(5)).toBe(false)

    await cdp.ensureAttached(5)

    expect(cdp.isAttached(5)).toBe(true)
    expect(api.attach).toHaveBeenCalledTimes(2)
  })

  test('detach clears attached state even when the underlying call rejects', async () => {
    const api = fakeApi({
      detach: vi.fn(async () => {
        throw new Error('No target with given id')
      }),
    })
    const cdp = new Cdp({ api: api as never })
    await cdp.ensureAttached(5)

    await expect(cdp.detach(5)).rejects.toThrow(ProtocolError)
    expect(cdp.isAttached(5)).toBe(false)
  })
})
