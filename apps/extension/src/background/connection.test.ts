import { ProtocolError } from '@agent-control/protocol'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Connection, type SocketLike } from './connection'

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  send(d: string) {
    this.sent.push(d)
  }

  close(code?: number) {
    this.closed = true
    this.readyState = 3
    this.onclose?.({ code })
  }

  open() {
    this.readyState = 1
    this.onopen?.({})
  }

  receive(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) })
  }
}

const last = () => FakeSocket.instances.at(-1)!

function make(over: Partial<ConstructorParameters<typeof Connection>[0]> = {}) {
  const states: string[] = []
  const c = new Connection({
    url: 'ws://x/ws',
    extensionVersion: '0.0.1',
    onRequest: async (req) => ({
      id: req.id,
      ok: true,
      result: { url: 'u', title: 't' },
    }),
    onStateChange: (s) => states.push(s),
    createSocket: (u) => new FakeSocket(u),
    random: () => 0.5,
    ...over,
  })
  return { c, states }
}

describe('Connection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
  })

  test('sends hello on open and reports connected', () => {
    const { c, states } = make()
    c.start()
    last().open()
    expect(JSON.parse(last().sent[0]!)).toEqual({
      type: 'hello',
      extensionVersion: '0.0.1',
    })
    expect(states).toEqual(['connecting', 'connected'])
  })

  test('reports the tab on open, and again after a reconnect', () => {
    const { c } = make()
    c.start()
    last().open()
    expect(last().sent).toHaveLength(1)
    c.reportTab({ id: 3, title: 't', url: 'u' })
    expect(JSON.parse(last().sent[1]!)).toEqual({
      type: 'tab',
      tab: { id: 3, title: 't', url: 'u' },
    })

    last().close()
    vi.advanceTimersByTime(250)
    last().open()
    // the server forgets the tab when the socket dies, so the hello has to
    // be followed by the tab again without anyone calling reportTab
    expect(JSON.parse(last().sent[1]!)).toEqual({
      type: 'tab',
      tab: { id: 3, title: 't', url: 'u' },
    })
  })

  test('reportTab before the socket opens is held, not dropped', () => {
    const { c } = make()
    c.start()
    c.reportTab({ id: 3, title: 't', url: 'u' })
    expect(last().sent).toEqual([])
    last().open()
    expect(JSON.parse(last().sent[1]!)).toEqual({
      type: 'tab',
      tab: { id: 3, title: 't', url: 'u' },
    })
  })

  test('answers requests through onRequest', async () => {
    const { c } = make()
    c.start()
    last().open()
    last().receive({ id: '9', type: 'tabInfo', payload: {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(last().sent.at(-1)!)).toEqual({
      id: '9',
      ok: true,
      result: { url: 'u', title: 't' },
    })
  })

  test('a rejecting onRequest sends an error response frame', async () => {
    const { c } = make({
      onRequest: async () => {
        throw new ProtocolError('INTERNAL', 'boom')
      },
    })
    c.start()
    last().open()
    last().receive({ id: '9', type: 'tabInfo', payload: {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(last().sent.at(-1)!)).toEqual({
      id: '9',
      ok: false,
      error: { code: 'INTERNAL', message: 'boom' },
    })
  })

  test('replies pong to ping', () => {
    const { c } = make()
    c.start()
    last().open()
    last().receive({ type: 'ping' })
    expect(last().sent.at(-1)).toBe('{"type":"pong"}')
  })

  test('pings every 20s and closes after 5s without pong', () => {
    const { c } = make()
    c.start()
    const s = last()
    s.open()
    vi.advanceTimersByTime(20_000)
    expect(s.sent.at(-1)).toBe('{"type":"ping"}')
    vi.advanceTimersByTime(5_000)
    expect(s.closed).toBe(true)
  })

  test('a pong before the deadline keeps the connection alive', () => {
    const { c } = make()
    c.start()
    const s = last()
    s.open()
    vi.advanceTimersByTime(20_000)
    s.receive({ type: 'pong' })
    vi.advanceTimersByTime(5_000)
    expect(s.closed).toBe(false)
  })

  test('reconnects with the backoff sequence, jitter 0.5 => exact values', () => {
    const { c } = make()
    c.start()
    const delays: number[] = []
    for (const expected of [250, 500, 1000, 2000, 4000, 5000, 5000]) {
      last().close()
      const before = FakeSocket.instances.length
      vi.advanceTimersByTime(expected - 1)
      expect(FakeSocket.instances.length).toBe(before)
      vi.advanceTimersByTime(1)
      expect(FakeSocket.instances.length).toBe(before + 1)
      delays.push(expected)
    }
    expect(delays.length).toBe(7)
  })

  test('attempt counter resets once the server sends a frame', () => {
    const { c } = make()
    c.start()
    last().close()
    vi.advanceTimersByTime(250)
    last().close()
    vi.advanceTimersByTime(500)
    last().open()
    last().receive({ type: 'ping' })
    last().close()
    const before = FakeSocket.instances.length
    vi.advanceTimersByTime(250)
    expect(FakeSocket.instances.length).toBe(before + 1)
  })

  test('a silent open does not reset the backoff', () => {
    const { c } = make()
    c.start()
    // the server accepts or rejects a hello without answering it, so an
    // open that is followed by nothing must not look like progress
    last().open()
    last().close()
    let before = FakeSocket.instances.length
    vi.advanceTimersByTime(250)
    expect(FakeSocket.instances.length).toBe(before + 1)
    last().open()
    last().close()
    before = FakeSocket.instances.length
    vi.advanceTimersByTime(499)
    expect(FakeSocket.instances.length).toBe(before)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances.length).toBe(before + 1)
  })

  test('an unauthorized close stops the retry loop', () => {
    const { c, states } = make()
    c.start()
    last().open()
    last().close(4001)
    const before = FakeSocket.instances.length
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances.length).toBe(before)
    c.tick()
    expect(FakeSocket.instances.length).toBe(before)
    expect(states.at(-1)).toBe('disconnected')
  })

  test('other close codes still reconnect', () => {
    const { c } = make()
    c.start()
    last().open()
    last().close(4002)
    const before = FakeSocket.instances.length
    vi.advanceTimersByTime(250)
    expect(FakeSocket.instances.length).toBe(before + 1)
  })

  test('tick reconnects a dead socket immediately', () => {
    const { c } = make()
    c.start()
    last().open()
    last().readyState = 3
    const before = FakeSocket.instances.length
    c.tick()
    expect(FakeSocket.instances.length).toBe(before + 1)
  })

  test('tick does nothing while the socket is already live', () => {
    const { c } = make()
    c.start()
    last().open()
    const before = FakeSocket.instances.length
    c.tick()
    expect(FakeSocket.instances.length).toBe(before)
  })

  test('tick does nothing while a reconnect is already pending', () => {
    const { c } = make()
    c.start()
    last().close()
    const before = FakeSocket.instances.length
    c.tick()
    expect(FakeSocket.instances.length).toBe(before)
  })

  test('onerror triggers a reconnect, same as onclose', () => {
    const { c } = make()
    c.start()
    const s = last()
    s.open()
    const before = FakeSocket.instances.length
    s.onerror?.({})
    vi.advanceTimersByTime(250)
    expect(FakeSocket.instances.length).toBe(before + 1)
  })

  test('stop closes and never reconnects', () => {
    const { c, states } = make()
    c.start()
    last().open()
    c.stop()
    expect(last().closed).toBe(true)
    const before = FakeSocket.instances.length
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances.length).toBe(before)
    expect(states.at(-1)).toBe('disconnected')
  })

  test('stop during a pending backoff timer prevents the reconnect', () => {
    const { c } = make()
    c.start()
    last().close()
    c.stop()
    const before = FakeSocket.instances.length
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances.length).toBe(before)
  })

  test('stop with a ping cycle in flight closes the socket and stops pinging', () => {
    const { c } = make()
    c.start()
    const s = last()
    s.open()
    const sentBeforeStop = s.sent.length
    c.stop()
    expect(s.closed).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(s.sent.length).toBe(sentBeforeStop)
  })
})
