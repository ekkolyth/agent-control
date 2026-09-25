import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Hono } from 'hono'
import { websocket } from 'hono/bun'
import { afterEach, describe, expect, test } from 'vitest'
import { captureDestination } from '../tests/log-capture'
import { createApp, loopbackHosts } from './app'
import { Bridge } from './bridge'
import { createLogger } from './log'
import { createMcpHandler } from './mcp'
import { ToolRegistry } from './registry'
import { registerBrowserTools } from './tools/browser'

const quietLogger = createLogger({
  service: 'test',
  destination: captureDestination(),
})

describe('/mcp', () => {
  let stop = () => {}
  afterEach(() => stop())

  async function boot() {
    const bridge = new Bridge({
      reconnectGraceMs: 10,
      logger: quietLogger,
    })
    const registry = new ToolRegistry()
    // a real macrotask yield, not an instant resolve: two concurrent POSTs
    // must both be in flight for the interleaving test below to mean
    // anything, which an instantly-settling sleep can never open a window for
    registerBrowserTools(registry, bridge, {
      sleep: () => new Promise((resolve) => setTimeout(resolve, 40)),
    })
    // the allowlist needs the port, and port 0 is only known once bound
    let app: Hono
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req, srv) => app.fetch(req, srv),
      websocket,
    })
    if (server.port === undefined) throw new Error('no port bound')
    const allowedHosts = loopbackHosts(server.port)
    ;({ app } = createApp({
      bridge,
      allowedHosts,
      mcp: createMcpHandler(
        registry,
        { name: 'test', version: '0' },
        allowedHosts
      ),
      logger: quietLogger,
    }))
    stop = () => server.stop(true)
    const url = new URL(`http://127.0.0.1:${server.port}/mcp`)
    const client = await connect(url)
    return Object.assign(client, { url })
  }
  async function connect(url: URL) {
    const client = new Client({ name: 't', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(url))
    return client
  }

  test('lists thirteen tools', async () => {
    const client = await boot()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toHaveLength(13)
    expect(
      tools.find((t) => t.name === 'browser_click')?.inputSchema
    ).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['element', 'ref']),
    })
  })

  test('browser_wait works without an extension', async () => {
    const client = await boot()
    const r = await client.callTool({
      name: 'browser_wait',
      arguments: { time: 1 },
    })
    expect(r.content).toEqual([{ type: 'text', text: 'Waited for 1 seconds' }])
  })

  test('browser_click with nothing ever paired is a NO_TAB error result', async () => {
    const client = await boot()
    const r = await client.callTool({
      name: 'browser_click',
      arguments: { element: 'x', ref: 's1e1' },
    })
    expect(r.isError).toBe(true)
    expect(String((r.content as Array<{ text: string }>)[0]?.text)).toContain(
      'Click the extension icon'
    )
  })

  test('GET /mcp is 405, not routed into the transport', async () => {
    const client = await boot()
    const res = await fetch(client.url, { method: 'GET' })
    expect(res.status).toBe(405)
  })

  test('DELETE /mcp is 405, not routed into the transport', async () => {
    const client = await boot()
    const res = await fetch(client.url, { method: 'DELETE' })
    expect(res.status).toBe(405)
  })

  test('the transport itself refuses a foreign Host, without the app guard', async () => {
    const registry = new ToolRegistry()
    const handler = createMcpHandler(registry, { name: 'test', version: '0' }, [
      '127.0.0.1:1',
    ])
    const bare = new Hono().post('/mcp', (c) => handler(c))
    const call = (host: string) =>
      bare.request('/mcp', {
        method: 'POST',
        headers: { Host: host, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })

    expect((await call('attacker.example:1')).status).toBe(403)
    expect((await call('127.0.0.1:1')).status).toBe(200)
  })

  test('two clients interleave without id collisions', async () => {
    const a = await boot()
    const b = await connect(a.url)
    const results = await Promise.all(
      [a, b, a, b].map((c) =>
        c.callTool({ name: 'browser_wait', arguments: { time: 1 } })
      )
    )
    expect(results.every((r) => !r.isError)).toBe(true)
    expect(
      results.map((r) => (r.content as Array<{ text: string }>)[0]?.text)
    ).toEqual(Array(4).fill('Waited for 1 seconds'))
  })
})
