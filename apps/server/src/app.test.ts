import { healthResponseSchema } from '@agent-control/protocol'
import type { Hono } from 'hono'
import { websocket } from 'hono/bun'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { captureDestination, parseLogLines } from '../tests/log-capture'
import { createApp, loopbackHosts } from './app'
import { Bridge } from './bridge'
import { createLogger } from './log'

const destination = captureDestination()
const quietLogger = createLogger({ service: 'test', destination })

function start(bridge: Bridge) {
  // the allowlist needs the port, and port 0 is only known once bound
  let app: Hono
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (req, srv) => app.fetch(req, srv),
    websocket,
  })
  if (server.port === undefined) throw new Error('no port bound')
  ;({ app } = createApp({
    bridge,
    allowedHosts: loopbackHosts(server.port),
    startedAt: Date.now(),
    logger: quietLogger,
  }))
  return {
    server,
    url: `http://127.0.0.1:${server.port}`,
    ws: `ws://127.0.0.1:${server.port}/ws`,
  }
}

function open(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.onopen = () => resolve(socket)
    socket.onerror = reject
  })
}

function nextClose(socket: WebSocket) {
  return new Promise<CloseEvent>((resolve) => {
    socket.onclose = resolve
  })
}

describe('app', () => {
  let stop: () => void = () => {}
  afterEach(() => {
    stop()
    destination.lines.length = 0
    vi.restoreAllMocks()
  })

  test('health reports disconnected before any extension', async () => {
    const bridge = new Bridge({ logger: quietLogger })
    const s = start(bridge)
    stop = () => s.server.stop(true)

    const body = healthResponseSchema.parse(
      await (await fetch(`${s.url}/health`)).json()
    )
    expect(body.extension).toBe('disconnected')
    expect(body.tab).toBeNull()
  })

  test('the frozen health contract sample parses', async () => {
    const sample = await Bun.file(
      new URL('../../../testdata/contracts/health.json', import.meta.url)
    ).json()
    expect(healthResponseSchema.parse(sample)).toEqual(sample)
  })

  test('/health matches the health contract with a paired tab', async () => {
    const bridge = new Bridge({ logger: quietLogger })
    const s = start(bridge)
    stop = () => s.server.stop(true)

    const tab = { id: 42, url: 'https://example.com/', title: 'Example Domain' }
    const socket = await open(s.ws)
    socket.send(JSON.stringify({ type: 'hello', extensionVersion: '0.0.1' }))
    socket.send(JSON.stringify({ type: 'tab', tab }))
    await vi.waitFor(() => expect(bridge.tab).toEqual(tab))

    const body = healthResponseSchema.parse(
      await (await fetch(`${s.url}/health`)).json()
    )
    expect(body).toMatchObject({ extension: 'connected', tab })

    const closed = nextClose(socket)
    socket.close()
    await closed
  })

  test('a first frame that is not a hello is closed with 4001; a hello connects', async () => {
    const bridge = new Bridge({ logger: quietLogger })
    const s = start(bridge)
    stop = () => s.server.stop(true)

    const bad = await open(s.ws)
    const closing = nextClose(bad)
    bad.send(JSON.stringify({ type: 'pong' }))
    expect((await closing).code).toBe(4001)

    const good = await open(s.ws)
    good.send(JSON.stringify({ type: 'hello', extensionVersion: '0.0.1' }))
    await vi.waitFor(() => expect(bridge.state).toBe('connected'))
    expect((await (await fetch(`${s.url}/health`)).json()).extension).toBe(
      'connected'
    )

    const goodClosed = nextClose(good)
    good.close()
    await goodClosed
    await vi.waitFor(() => expect(bridge.state).toBe('disconnected'))
    expect((await (await fetch(`${s.url}/health`)).json()).extension).toBe(
      'disconnected'
    )
  })

  test('a foreign Host is refused on /health and /mcp, never reaching the handler', async () => {
    const bridge = new Bridge({ logger: quietLogger })
    const s = start(bridge)
    stop = () => s.server.stop(true)
    const spoofed = {
      Host: `attacker.example:${s.server.port}`,
      Origin: `http://attacker.example:${s.server.port}`,
    }

    const health = await fetch(`${s.url}/health`, { headers: spoofed })
    expect(health.status).toBe(403)
    expect(await health.json()).toEqual({ error: 'invalid host' })

    const mcp = await fetch(`${s.url}/mcp`, {
      method: 'POST',
      headers: { ...spoofed, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(mcp.status).toBe(403)
  })

  test('127.0.0.1 and localhost with the bound port are both accepted', async () => {
    const bridge = new Bridge({ logger: quietLogger })
    const s = start(bridge)
    stop = () => s.server.stop(true)

    for (const host of [
      `127.0.0.1:${s.server.port}`,
      `localhost:${s.server.port}`,
    ]) {
      const res = await fetch(`${s.url}/health`, { headers: { Host: host } })
      expect(res.status).toBe(200)
    }
  })

  test('a refused Host is logged at warn with the host it carried', async () => {
    const s = start(new Bridge({ logger: quietLogger }))
    stop = () => s.server.stop(true)

    await fetch(`${s.url}/health`, { headers: { Host: 'attacker.example:1' } })

    const [line] = parseLogLines(destination.lines)
    expect(line).toMatchObject({
      level: 40,
      path: '/health',
      host: 'attacker.example:1',
      status: 403,
    })
  })

  test('mcp returns 503 when not configured', async () => {
    const s = start(new Bridge({ logger: quietLogger }))
    stop = () => s.server.stop(true)

    expect((await fetch(`${s.url}/mcp`, { method: 'POST' })).status).toBe(503)
  })

  test('GET and DELETE /mcp both answer 405 with Allow: POST', async () => {
    const s = start(new Bridge({ logger: quietLogger }))
    stop = () => s.server.stop(true)

    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${s.url}/mcp`, { method })
      expect(res.status).toBe(405)
      expect(res.headers.get('Allow')).toBe('POST')
    }
  })

  test('a 503 is logged at error with the request attrs', async () => {
    const s = start(new Bridge({ logger: quietLogger }))
    stop = () => s.server.stop(true)

    await fetch(`${s.url}/mcp`, { method: 'POST' })

    const [line] = parseLogLines(destination.lines)
    expect(line).toMatchObject({
      level: 50,
      scope: 'http',
      method: 'POST',
      path: '/mcp',
      status: 503,
    })
    expect(typeof line?.duration_ms).toBe('number')
    expect(typeof line?.request_id).toBe('string')
  })

  test('a fast /health request only logs when the sample hits, never for /ws', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const s = start(new Bridge({ logger: quietLogger }))
    stop = () => s.server.stop(true)

    await fetch(`${s.url}/health`)
    expect(destination.lines).toHaveLength(0)

    const ws = await open(s.ws)
    const closed = nextClose(ws)
    ws.close()
    await closed
    expect(destination.lines).toHaveLength(0)
  })
})
