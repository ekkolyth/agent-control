import { ProtocolError } from '@agent-control/protocol'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { captureDestination, parseLogLines } from '../tests/log-capture'
import { Bridge, type BridgeSocket } from './bridge'
import { createLogger } from './log'

function fakeSocket() {
  const sent: string[] = []
  const closed: Array<[number | undefined, string | undefined]> = []
  const socket: BridgeSocket = {
    send: (d) => sent.push(d),
    close: (c, r) => closed.push([c, r]),
  }
  return { socket, sent, closed }
}

const hello = JSON.stringify({ type: 'hello', extensionVersion: '0.0.1' })

const tabFrame = JSON.stringify({
  type: 'tab',
  tab: { id: 5, title: 'a', url: 'a' },
})

// a rejected handshake now logs at info — keep these assertions on
// close/state behaviour from also dumping real JSON into the test run
const quietLogger = createLogger({
  service: 'test',
  destination: captureDestination(),
})

describe('Bridge handshake', () => {
  test('valid hello connects', () => {
    const b = new Bridge({ logger: quietLogger })
    const { socket } = fakeSocket()
    const h = b.accept(socket)
    expect(b.state).toBe('disconnected')
    h.message(hello)
    expect(b.state).toBe('connected')
    expect(b.extensionVersion).toBe('0.0.1')
  })

  test('a tab frame is what /health reads, and a drop clears it', () => {
    const b = new Bridge({ logger: quietLogger })
    const { socket } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    expect(b.tab).toBeNull()
    h.message(tabFrame)
    expect(b.tab).toEqual({ id: 5, title: 'a', url: 'a' })
    h.closed()
    expect(b.tab).toBeNull()
  })

  test('a tab frame carrying null clears the reported tab', () => {
    const b = new Bridge({ logger: quietLogger })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.message(tabFrame)
    h.message(JSON.stringify({ type: 'tab', tab: null }))
    expect(b.tab).toBeNull()
  })

  test('connect and disconnect are logged at info with the version', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.closed()
    const records = parseLogLines(dest.lines)
    expect(records.map((r) => r.msg)).toEqual([
      'extension connected',
      'extension disconnected',
    ])
    expect(records.every((r) => r.level === 30)).toBe(true)
    expect(records[0]?.extension_version).toBe('0.0.1')
  })

  test('a malformed hello closes 4001 and stays disconnected', () => {
    const b = new Bridge({ logger: quietLogger })
    const { socket, closed } = fakeSocket()
    b.accept(socket).message(JSON.stringify({ type: 'hello' }))
    expect(closed).toEqual([[4001, 'unauthorized']])
    expect(b.state).toBe('disconnected')
  })

  test('non-hello first frame closes 4001', () => {
    const b = new Bridge({ logger: quietLogger })
    const { socket, closed } = fakeSocket()
    b.accept(socket).message('{"type":"ping"}')
    expect(closed[0]?.[0]).toBe(4001)
  })

  test('a rejected handshake whose close throws does not escape', () => {
    const b = new Bridge({ logger: quietLogger })
    const throwingSocket: BridgeSocket = {
      send: () => {},
      close: () => {
        throw new Error('already gone')
      },
    }
    const h = b.accept(throwingSocket)
    expect(() => h.message('{"type":"ping"}')).not.toThrow()
    expect(b.state).toBe('disconnected')
  })

  test('closed() on a never-promoted socket is a no-op', () => {
    const b = new Bridge({ logger: quietLogger })
    const { socket } = fakeSocket()
    const h = b.accept(socket)
    expect(() => h.closed()).not.toThrow()
    expect(b.state).toBe('disconnected')
  })

  test('a socket rejected by the handshake can never be promoted by a later frame', () => {
    const b = new Bridge({ logger: quietLogger })
    const { socket, closed } = fakeSocket()
    const h = b.accept(socket)
    h.message('{"type":"ping"}')
    expect(b.state).toBe('disconnected')
    h.message(hello)
    expect(b.state).toBe('disconnected')
    expect(closed).toEqual([[4001, 'unauthorized']])
  })
})

describe('Bridge send', () => {
  let b: Bridge
  let sent: string[]
  let h: ReturnType<Bridge['accept']>

  beforeEach(() => {
    vi.useFakeTimers()
    b = new Bridge({ defaultTimeoutMs: 1000, logger: quietLogger })
    const f = fakeSocket()
    sent = f.sent
    h = b.accept(f.socket)
    h.message(hello)
  })
  afterEach(() => vi.useRealTimers())

  test('resolves with validated result and refreshes the reported tab', async () => {
    h.message(tabFrame)
    const p = b.send('click', { ref: 's1e1', mode: 'compact' })
    const req = JSON.parse(sent.at(-1) ?? '{}')
    expect(req.type).toBe('click')
    expect(req.payload).toEqual({ ref: 's1e1', mode: 'compact' })
    h.message(
      JSON.stringify({
        id: req.id,
        ok: true,
        result: { url: 'u', title: 't', hash: 'h' },
      })
    )
    await expect(p).resolves.toEqual({ url: 'u', title: 't', hash: 'h' })
    expect(b.tab).toEqual({ id: 5, title: 't', url: 'u' })
  })

  test('error response rejects with the extension code', async () => {
    const p = b.send('click', { ref: 's1e1', mode: 'compact' })
    const { id } = JSON.parse(sent.at(-1) ?? '{}')
    h.message(
      JSON.stringify({
        id,
        ok: false,
        error: { code: 'STALE_REF', message: 'old' },
      })
    )
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'STALE_REF', message: 'old' })
  })

  test('malformed result rejects INTERNAL', async () => {
    const p = b.send('screenshot', {})
    const { id } = JSON.parse(sent.at(-1) ?? '{}')
    h.message(JSON.stringify({ id, ok: true, result: { nope: 1 } }))
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('a malformed result carrying page-shaped fields must not update the tab', async () => {
    h.message(tabFrame)
    const p = b.send('screenshot', {})
    const { id } = JSON.parse(sent.at(-1) ?? '{}')
    h.message(
      JSON.stringify({ id, ok: true, result: { url: 'u', title: 't' } })
    )
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(b.tab).toEqual({ id: 5, title: 'a', url: 'a' })
  })

  test('times out', async () => {
    const p = b.send('screenshot', {}, { timeoutMs: 500 })
    vi.advanceTimersByTime(501)
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  test('close rejects in-flight with DISCONNECTED and flips state', async () => {
    const p = b.send('screenshot', {})
    h.closed()
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(b.state).toBe('disconnected')
  })

  test('answers ping with pong', () => {
    h.message('{"type":"ping"}')
    expect(sent.at(-1)).toBe('{"type":"pong"}')
  })

  test('a pong reply that throws does not escape', () => {
    const b2 = new Bridge({ logger: quietLogger })
    const throwingSocket: BridgeSocket = {
      send: (d) => {
        if (d === '{"type":"pong"}') throw new Error('socket closing')
      },
      close: () => {},
    }
    const h2 = b2.accept(throwingSocket)
    h2.message(hello)
    expect(() => h2.message('{"type":"ping"}')).not.toThrow()
    expect(b2.state).toBe('connected')
  })

  test('send while disconnected rejects DISCONNECTED once the grace window elapses', async () => {
    h.closed()
    const p = b.send('screenshot', {})
    vi.advanceTimersByTime(3_001)
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })

  test('a response for an id nobody is waiting on is dropped, not thrown', () => {
    expect(() =>
      h.message(JSON.stringify({ id: 'no-such-id', ok: true, result: {} }))
    ).not.toThrow()
  })

  test('a second response for an already-settled id does not resettle it', async () => {
    h.message(tabFrame)
    const p = b.send('tabInfo', {})
    const { id } = JSON.parse(sent.at(-1) ?? '{}')
    h.message(
      JSON.stringify({ id, ok: true, result: { url: 'first', title: 'first' } })
    )
    await expect(p).resolves.toEqual({ url: 'first', title: 'first' })
    // once settled, the id must be gone from #pending — a late duplicate for
    // the same id must not still be treated as live and overwrite page state
    h.message(
      JSON.stringify({
        id,
        ok: true,
        result: { url: 'second', title: 'second' },
      })
    )
    expect(b.tab).toEqual({ id: 5, title: 'first', url: 'first' })
  })

  test('the response timer is cleared once the response settles', async () => {
    const before = vi.getTimerCount()
    const p = b.send('screenshot', {}, { timeoutMs: 500 })
    const { id } = JSON.parse(sent.at(-1) ?? '{}')
    h.message(JSON.stringify({ id, ok: true, result: { data: 'x' } }))
    await expect(p).resolves.toEqual({ data: 'x' })
    // a timer left running past settlement is a leak, even though its late
    // reject on an already-resolved promise is silently harmless; the
    // heartbeat interval armed on promotion is not itself the thing under
    // test, so compare against the count captured before this send
    expect(vi.getTimerCount()).toBe(before)
    vi.advanceTimersByTime(501)
    await expect(p).resolves.toEqual({ data: 'x' })
  })
})

describe('Bridge close()', () => {
  test('closes the current socket and rejects in-flight', async () => {
    vi.useFakeTimers()
    const b = new Bridge({ logger: quietLogger })
    const { socket, closed } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    const p = b.send('screenshot', {})
    b.close()
    expect(closed.length).toBe(1)
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(b.state).toBe('disconnected')
    // the heartbeat interval armed on promotion must go with the pending
    // send's own timer — a surviving setInterval is a leak in a daemon
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  test('still disconnects and rejects in-flight when the socket throws on close', async () => {
    vi.useFakeTimers()
    const b = new Bridge({ logger: quietLogger })
    const throwingSocket: BridgeSocket = {
      send: () => {},
      close: () => {
        throw new Error('already gone')
      },
    }
    const h = b.accept(throwingSocket)
    h.message(hello)
    const p = b.send('screenshot', {})
    expect(() => b.close()).not.toThrow()
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(b.state).toBe('disconnected')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})

describe('Bridge send failures', () => {
  test('a throw from socket.send rejects DISCONNECTED and clears the pending timer', async () => {
    vi.useFakeTimers()
    const b = new Bridge({ logger: quietLogger })
    const throwingSocket: BridgeSocket = {
      send: () => {
        throw new Error('socket closing')
      },
      close: () => {},
    }
    const h = b.accept(throwingSocket)
    h.message(hello)
    const before = vi.getTimerCount()
    const p = b.send('screenshot', {})
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(vi.getTimerCount()).toBe(before)
    vi.useRealTimers()
  })
})

describe('Bridge events', () => {
  test('on(connected) fires on promotion, unsubscribe stops future calls', () => {
    const b = new Bridge({ logger: quietLogger })
    const calls: string[] = []
    const off = b.on('connected', () => calls.push('connected'))
    const { socket: s1 } = fakeSocket()
    b.accept(s1).message(hello)
    expect(calls).toEqual(['connected'])
    off()
    const { socket: s2 } = fakeSocket()
    b.accept(s2).message(hello)
    expect(calls).toEqual(['connected'])
  })

  test('on(disconnected) fires when the current socket closes', () => {
    const b = new Bridge({ logger: quietLogger })
    const calls: string[] = []
    b.on('disconnected', () => calls.push('disconnected'))
    const { socket } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    h.closed()
    expect(calls).toEqual(['disconnected'])
  })

  test('a throwing listener does not stop other listeners or escape emit', () => {
    const b = new Bridge({ logger: quietLogger })
    const calls: string[] = []
    b.on('connected', () => {
      throw new Error('boom')
    })
    b.on('connected', () => calls.push('second'))
    const { socket } = fakeSocket()
    expect(() => b.accept(socket).message(hello)).not.toThrow()
    expect(calls).toEqual(['second'])
  })
})

describe('Bridge heartbeat', () => {
  afterEach(() => vi.useRealTimers())

  test('pings every 20s and drops after 5s without pong', () => {
    vi.useFakeTimers()
    const b = new Bridge({ logger: quietLogger })
    const { socket, sent, closed } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    vi.advanceTimersByTime(20_000)
    expect(sent.at(-1)).toBe('{"type":"ping"}')
    vi.advanceTimersByTime(5_000)
    expect(closed.at(-1)).toEqual([4002, 'heartbeat timeout'])
    expect(b.state).toBe('disconnected')
  })

  test('pong keeps the connection', () => {
    vi.useFakeTimers()
    const b = new Bridge({ logger: quietLogger })
    const { socket, closed } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    vi.advanceTimersByTime(20_000)
    h.message('{"type":"pong"}')
    vi.advanceTimersByTime(5_000)
    expect(closed).toEqual([])
    expect(b.state).toBe('connected')
  })

  test('a ping that throws is treated as a heartbeat timeout, not retried', () => {
    vi.useFakeTimers()
    const b = new Bridge({ logger: quietLogger })
    const closed: Array<[number | undefined, string | undefined]> = []
    const socket: BridgeSocket = {
      send: (d) => {
        if (d === '{"type":"ping"}') throw new Error('socket closing')
      },
      close: (c, r) => closed.push([c, r]),
    }
    const h = b.accept(socket)
    h.message(hello)
    vi.advanceTimersByTime(20_000)
    expect(closed.at(-1)).toEqual([4002, 'heartbeat timeout'])
    expect(b.state).toBe('disconnected')
  })

  test('a socket dead in both directions is still reaped', () => {
    vi.useFakeTimers()
    const b = new Bridge({ logger: quietLogger })
    const closed: Array<[number | undefined, string | undefined]> = []
    const socket: BridgeSocket = {
      send: () => {
        throw new Error('socket closing')
      },
      close: (c, r) => {
        closed.push([c, r])
        throw new Error('already gone')
      },
    }
    const h = b.accept(socket)
    h.message(hello)
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow()
    expect(closed).toEqual([[4002, 'heartbeat timeout']])
    expect(b.state).toBe('disconnected')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Bridge replace', () => {
  test('newest hello wins; old in-flight rejected', async () => {
    const b = new Bridge({ logger: quietLogger })
    const events: string[] = []
    b.on('connected', () => events.push('connected'))
    b.on('disconnected', () => events.push('disconnected'))
    const a = fakeSocket()
    const ha = b.accept(a.socket)
    ha.message(hello)
    const inflight = b.send('screenshot', {})
    const c = fakeSocket()
    const hc = b.accept(c.socket)
    hc.message(hello)
    expect(events).toEqual(['connected', 'disconnected', 'connected'])
    expect(a.closed.at(-1)).toEqual([4000, 'replaced'])
    await expect(inflight).rejects.toBeInstanceOf(ProtocolError)
    await expect(inflight).rejects.toMatchObject({ code: 'DISCONNECTED' })
    expect(b.state).toBe('connected')
    const p = b.send('screenshot', {})
    expect(c.sent.some((s) => JSON.parse(s).type === 'screenshot')).toBe(true)
    ha.closed() // stale close must not affect the new socket
    expect(b.state).toBe('connected')
    hc.closed()
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })

  test('a previous socket whose close throws does not block promotion', () => {
    const b = new Bridge({ logger: quietLogger })
    const throwingClose: BridgeSocket = {
      send: () => {},
      close: () => {
        throw new Error('already gone')
      },
    }
    const ha = b.accept(throwingClose)
    ha.message(hello)
    const c = fakeSocket()
    const hc = b.accept(c.socket)
    hc.message(hello)
    expect(b.state).toBe('connected')
    expect(b.extensionVersion).toBe('0.0.1')
    b.send('screenshot', {})
    expect(c.sent.some((s) => JSON.parse(s).type === 'screenshot')).toBe(true)
  })
})

describe('Bridge grace window', () => {
  afterEach(() => vi.useRealTimers())

  test('send waits for a reconnect inside the window', async () => {
    vi.useFakeTimers()
    const b = new Bridge({ reconnectGraceMs: 3000, logger: quietLogger })
    const p = b.send('screenshot', {})
    vi.advanceTimersByTime(1000)
    const { socket, sent } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    await vi.advanceTimersByTimeAsync(0)
    const req = JSON.parse(sent.at(-1) ?? '{}')
    expect(req.type).toBe('screenshot')
    h.message(JSON.stringify({ id: req.id, ok: true, result: { data: 'x' } }))
    await expect(p).resolves.toEqual({ data: 'x' })
  })

  test('a send that never had a connection rejects NO_TAB, not DISCONNECTED', async () => {
    vi.useFakeTimers()
    const b = new Bridge({ reconnectGraceMs: 3000, logger: quietLogger })
    const p = b.send('screenshot', {})
    vi.advanceTimersByTime(3001)
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'NO_TAB' })
  })

  test('a send that fails after a connection existed and dropped keeps DISCONNECTED', async () => {
    vi.useFakeTimers()
    const b = new Bridge({ reconnectGraceMs: 3000, logger: quietLogger })
    const { socket } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    h.closed()
    const p = b.send('screenshot', {})
    vi.advanceTimersByTime(3001)
    await expect(p).rejects.toBeInstanceOf(ProtocolError)
    await expect(p).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })

  test('a reconnect inside the window clears the grace timer', async () => {
    vi.useFakeTimers()
    const b = new Bridge({ reconnectGraceMs: 3000, logger: quietLogger })
    const p = b.send('screenshot', {})
    expect(vi.getTimerCount()).toBe(1)
    const { socket, sent } = fakeSocket()
    const h = b.accept(socket)
    h.message(hello)
    // the grace timer must be gone the moment promotion resolves it, leaving
    // only the heartbeat interval armed — not both
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    const req = JSON.parse(sent.at(-1) ?? '{}')
    h.message(JSON.stringify({ id: req.id, ok: true, result: { data: 'x' } }))
    await expect(p).resolves.toEqual({ data: 'x' })
  })
})

describe('Bridge logging', () => {
  test('a malformed frame on an active connection is logged at warn', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.message('not json')
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.level).toBe(40)
    expect(record?.msg).toBe('malformed extension frame')
  })

  test('a malformed frame is logged by shape only, never its content', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    // extra key fails the strict hello schema, so this frame is "malformed"
    // even though it is valid, fully-parseable JSON carrying a secret
    h.message(
      JSON.stringify({ type: 'hello', token: 'secret', pad: 'x'.repeat(300) })
    )
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toEqual(['type'])
    expect(record?.unknownKeyCount).toBe(2)
    expect(record?.frame).toBeUndefined()
    expect(dest.lines.join('')).not.toContain('secret')
  })

  // path-based redaction on a literal key name only ever protects a value
  // sitting at the keys it lists; these four shapes carry one everywhere
  // else and must come through clean now that no frame content is logged
  test('a bare JSON string frame does not leak the token', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.message(JSON.stringify('secret'))
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toBeUndefined()
    expect(record?.unknownKeyCount).toBeUndefined()
    expect(dest.lines.join('')).not.toContain('secret')
  })

  test('the token under a different key name does not leak, and the rename is only a count', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.message(JSON.stringify({ auth: 'secret' }))
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toBeUndefined()
    expect(record?.unknownKeyCount).toBe(1)
    expect(dest.lines.join('')).not.toContain('secret')
  })

  test('the token nested two levels deep does not leak', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.message(JSON.stringify({ type: 'hello', d: { token: 'secret' } }))
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toEqual(['type'])
    expect(record?.unknownKeyCount).toBe(1)
    expect(dest.lines.join('')).not.toContain('secret')
  })

  test('the token inside an array does not leak', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.message(JSON.stringify(['secret']))
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toBeUndefined()
    expect(record?.unknownKeyCount).toBeUndefined()
    expect(dest.lines.join('')).not.toContain('secret')
  })

  // a key name is frame content exactly like a value: only names the
  // schemas define are ever logged, so a client-chosen key — even the
  // secret itself, even one no human would type, even a flood of them —
  // becomes a count instead of text
  test('a key equal to the shared secret is never named, only counted', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    h.message(JSON.stringify({ secret: 1 }))
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toBeUndefined()
    expect(record?.unknownKeyCount).toBe(1)
    expect(dest.lines.join('')).not.toContain('secret')
  })

  test('a long key name never appears in the log', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    const longKey = 'k'.repeat(500)
    h.message(JSON.stringify({ [longKey]: 1 }))
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toBeUndefined()
    expect(record?.unknownKeyCount).toBe(1)
    expect(dest.lines.join('')).not.toContain(longKey)
  })

  test('more than ten unknown keys are counted, not named', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    const frame: Record<string, number> = {}
    for (let i = 0; i < 15; i++) frame[`field${i}`] = i
    h.message(JSON.stringify(frame))
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toBeUndefined()
    expect(record?.unknownKeyCount).toBe(15)
  })

  test('a drifted frame names its known keys and the zod path identifies the missing field', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const h = b.accept(fakeSocket().socket)
    h.message(hello)
    // "typ" instead of "type" — a realistic drift, not an attack
    h.message(
      JSON.stringify({ typ: 'hello', token: 'secret', extensionVersion: '0' })
    )
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.keys).toEqual(['extensionVersion'])
    expect(record?.unknownKeyCount).toBe(2)
    expect(record?.zodPaths).toContain('type')
    expect(dest.lines.join('')).not.toContain('secret')
  })

  test('a throwing listener logs the error at error level', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    b.on('connected', () => {
      throw new Error('boom')
    })
    b.accept(fakeSocket().socket).message(hello)
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.level).toBe(50)
    expect(record?.msg).toBe('listener threw')
  })

  test('a malformed first frame on an unpromoted socket is logged, not silent', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    b.accept(fakeSocket().socket).message('{"garbage":1}')
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.level).toBe(30)
    expect(record?.msg).toBe('handshake rejected')
  })

  test('a rejected handshake carrying a secret does not leak it', () => {
    const dest = captureDestination()
    const b = new Bridge({
      logger: createLogger({ service: 'test', destination: dest }),
    })
    const { socket, closed } = fakeSocket()
    b.accept(socket).message(
      JSON.stringify({ type: 'hello', token: 'nope', extensionVersion: '0' })
    )
    expect(closed[0]?.[0]).toBe(4001)
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.msg).toBe('handshake rejected')
    expect(dest.lines.join('')).not.toContain('nope')
  })
})
