import { ProtocolError } from '@agent-control/protocol'
import { describe, expect, test, vi } from 'vitest'
import { ContentClient } from './content-client'

describe('ContentClient', () => {
  test('injects the content script once and retries when the receiving end is missing', async () => {
    let calls = 0
    const sendMessage = vi.fn(async () => {
      calls++
      if (calls === 1) {
        throw new Error(
          'Could not establish connection. Receiving end does not exist.'
        )
      }
      return { ok: true, result: 'r' }
    })
    const executeScript = vi.fn(async () => [])
    const client = new ContentClient({
      tabs: { sendMessage } as never,
      scripting: { executeScript } as never,
    })

    const result = await client.request(5, { kind: 'resolveRef', ref: 'x' })

    expect(result).toBe('r')
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5 },
      files: ['/content-scripts/content.js'],
    })
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  test('maps a second failure after injection to INTERNAL', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error(
        'Could not establish connection. Receiving end does not exist.'
      )
    })
    const executeScript = vi.fn(async () => [])
    const client = new ContentClient({
      tabs: { sendMessage } as never,
      scripting: { executeScript } as never,
    })

    await expect(
      client.request(5, { kind: 'resolveRef', ref: 'x' })
    ).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'content script unavailable on this page',
    })
    expect(executeScript).toHaveBeenCalledTimes(1)
  })

  test('rethrows a rejection that is not the missing-receiver signature, without injecting', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('The message port closed before a response was received.')
    })
    const executeScript = vi.fn(async () => [])
    const client = new ContentClient({
      tabs: { sendMessage } as never,
      scripting: { executeScript } as never,
    })

    await expect(
      client.request(5, { kind: 'waitQuiet', quietMs: 150, capMs: 1500 })
    ).rejects.toThrow('The message port closed before a response was received.')
    expect(executeScript).not.toHaveBeenCalled()
  })

  test('throws a ProtocolError when the content script reports failure', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: false,
      code: 'INTERNAL',
      message: 'boom',
    }))
    const client = new ContentClient({
      tabs: { sendMessage } as never,
      scripting: { executeScript: vi.fn() } as never,
    })

    await expect(
      client.request(5, { kind: 'resolveRef', ref: 'x' })
    ).rejects.toThrow(ProtocolError)
    await expect(
      client.request(5, { kind: 'resolveRef', ref: 'x' })
    ).rejects.toMatchObject({ code: 'INTERNAL', message: 'boom' })
  })

  test('returns the result on success without touching scripting', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, result: 42 }))
    const executeScript = vi.fn(async () => [])
    const client = new ContentClient({
      tabs: { sendMessage } as never,
      scripting: { executeScript } as never,
    })

    expect(await client.request(5, { kind: 'resolveRef', ref: 'x' })).toBe(42)
    expect(executeScript).not.toHaveBeenCalled()
  })
})
