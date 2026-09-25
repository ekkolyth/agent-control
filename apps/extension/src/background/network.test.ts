import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Cdp } from './cdp'
import { NetworkMonitor } from './network'

type EventFn = (tabId: number, method: string, params: unknown) => void

function fakeCdp() {
  let listener: EventFn = () => {}
  const cdp = {
    onEvent: (fn: EventFn) => {
      listener = fn
      return () => {}
    },
  }
  return {
    cdp: cdp as unknown as Cdp,
    start: (tabId: number, requestId: string, type = 'Fetch') =>
      listener(tabId, 'Network.requestWillBeSent', { requestId, type }),
    finish: (tabId: number, requestId: string) =>
      listener(tabId, 'Network.loadingFinished', { requestId }),
    fail: (tabId: number, requestId: string) =>
      listener(tabId, 'Network.loadingFailed', { requestId }),
  }
}

// drains microtasks without moving the clock, so a parked wait stays parked
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  void p.then(() => {
    done = true
  })
  await vi.advanceTimersByTimeAsync(0)
  return done
}

describe('NetworkMonitor', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('no traffic since the mark resolves false at once', async () => {
    const net = new NetworkMonitor()
    net.attach(fakeCdp().cdp)
    await expect(net.waitForIdle(1, 300, 3000, net.mark(1))).resolves.toBe(
      false
    )
  })

  test('waits for the open request, then for the idle window after it', async () => {
    const net = new NetworkMonitor()
    const cdp = fakeCdp()
    net.attach(cdp.cdp)
    const since = net.mark(1)
    cdp.start(1, 'a')

    const waiting = net.waitForIdle(1, 300, 3000, since)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settled(waiting)).toBe(false)

    cdp.finish(1, 'a')
    await vi.advanceTimersByTimeAsync(299)
    expect(await settled(waiting)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBe(true)
  })

  test('a fetch chained inside the idle window restarts it', async () => {
    const net = new NetworkMonitor()
    const cdp = fakeCdp()
    net.attach(cdp.cdp)
    const since = net.mark(1)
    cdp.start(1, 'a')
    const waiting = net.waitForIdle(1, 300, 3000, since)

    cdp.finish(1, 'a')
    await vi.advanceTimersByTimeAsync(200)
    cdp.start(1, 'b')
    await vi.advanceTimersByTimeAsync(200)
    cdp.fail(1, 'b')
    await vi.advanceTimersByTimeAsync(299)
    expect(await settled(waiting)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBe(true)
  })

  test('traffic that already finished since the mark still gets the idle window', async () => {
    const net = new NetworkMonitor()
    const cdp = fakeCdp()
    net.attach(cdp.cdp)
    const since = net.mark(1)
    cdp.start(1, 'a')
    cdp.finish(1, 'a')

    const waiting = net.waitForIdle(1, 300, 3000, since)
    await vi.advanceTimersByTimeAsync(299)
    expect(await settled(waiting)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBe(true)
  })

  test('media, event streams and sockets are never counted', async () => {
    const net = new NetworkMonitor()
    const cdp = fakeCdp()
    net.attach(cdp.cdp)
    const since = net.mark(1)
    cdp.start(1, 'radio', 'Media')
    cdp.start(1, 'feed', 'EventSource')
    cdp.start(1, 'ws', 'WebSocket')

    await expect(net.waitForIdle(1, 300, 3000, since)).resolves.toBe(false)
  })

  test('a request open past the long-lived bound stops holding the wait', async () => {
    const net = new NetworkMonitor()
    const cdp = fakeCdp()
    net.attach(cdp.cdp)
    const since = net.mark(1)
    cdp.start(1, 'long-poll')

    const waiting = net.waitForIdle(1, 300, 10_000, since)
    await vi.advanceTimersByTimeAsync(2000 + 299)
    expect(await settled(waiting)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBe(true)
  })

  test('the cap ends a wait that never goes idle', async () => {
    const net = new NetworkMonitor()
    const cdp = fakeCdp()
    net.attach(cdp.cdp)
    const since = net.mark(1)
    cdp.start(1, 'r0')
    const waiting = net.waitForIdle(1, 300, 1000, since)

    // a fresh request every 250ms keeps the idle window from ever closing
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(125)
      cdp.finish(1, `r${i}`)
      await vi.advanceTimersByTimeAsync(125)
      cdp.start(1, `r${i + 1}`)
    }
    await expect(waiting).resolves.toBe(true)
  })

  test('traffic on another tab is not this tab’s traffic', async () => {
    const net = new NetworkMonitor()
    const cdp = fakeCdp()
    net.attach(cdp.cdp)
    const since = net.mark(1)
    cdp.start(2, 'elsewhere')

    await expect(net.waitForIdle(1, 300, 3000, since)).resolves.toBe(false)
  })

  test('an event with no requestId is ignored', () => {
    const net = new NetworkMonitor()
    let listener: EventFn = () => {}
    net.attach({
      onEvent: (fn: EventFn) => {
        listener = fn
        return () => {}
      },
    } as unknown as Cdp)
    expect(() =>
      listener(1, 'Network.requestWillBeSent', { type: 'Fetch' })
    ).not.toThrow()
    expect(net.mark(1)).toBe(0)
  })
})
