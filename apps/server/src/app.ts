import type { HealthResponse } from '@agent-control/protocol'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import type { Bridge, BridgeHandle } from './bridge'
import { createLogger, type Logger, scope } from './log'
import { createRequestLogger } from './request-log'

type AppDeps = {
  bridge: Bridge
  allowedHosts: readonly string[]
  mcp?: (c: Context) => Promise<Response>
  startedAt?: number
  logger?: Logger
}

// the Host header a local client sends, port included: the check is an
// exact string match, so `127.0.0.1` alone would reject `127.0.0.1:3660`
function loopbackHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`]
}

// a DNS-rebound page reaches loopback same-origin, so its Host is the
// attacker's name rather than ours; nothing else tells it apart
function rejectForeignHost(allowedHosts: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header('host')
    if (!host || !allowedHosts.includes(host)) {
      return c.json({ error: 'invalid host' }, 403)
    }
    await next()
  }
}

const EXTENSION_ORIGIN_SCHEMES = ['chrome-extension://', 'moz-extension://']

// browsers always send Origin on a WebSocket handshake, so a missing one
// can't be a web page; a present one must be an extension's own
function rejectWebPageOrigin(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin')
    if (
      origin !== undefined &&
      !EXTENSION_ORIGIN_SCHEMES.some((scheme) => origin.startsWith(scheme))
    ) {
      return c.json({ error: 'invalid origin' }, 403)
    }
    await next()
  }
}

function createApp(deps: AppDeps): { app: Hono; websocket: typeof websocket } {
  const { bridge, mcp, allowedHosts } = deps
  const startedAt = deps.startedAt ?? Date.now()
  const logger =
    deps.logger ?? createLogger({ service: 'agent-control-server' })
  const app = new Hono()

  app.use('*', createRequestLogger(logger))
  // the request logger skips /ws, so a refusal is logged here
  const httpLog = scope(logger, 'http')
  app.use('/ws', async (c, next) => {
    await next()
    if (c.res.status === 403) {
      httpLog.warn(
        {
          method: c.req.method,
          path: c.req.path,
          host: c.req.header('host'),
          origin: c.req.header('origin'),
          status: 403,
        },
        'request completed'
      )
    }
  })
  app.use('/ws', rejectForeignHost(allowedHosts), rejectWebPageOrigin())
  app.use('/health', rejectForeignHost(allowedHosts))
  app.use('/mcp', rejectForeignHost(allowedHosts))

  app.get(
    '/ws',
    upgradeWebSocket(() => {
      let handle: BridgeHandle | undefined

      return {
        onOpen(_evt, ws) {
          handle = bridge.accept({
            send: (data) => ws.send(data),
            close: (code, reason) => ws.close(code, reason),
          })
        },
        onMessage(evt) {
          handle?.message(String(evt.data))
        },
        onClose() {
          handle?.closed()
        },
      }
    })
  )

  app.get('/health', (c) =>
    c.json({
      extension: bridge.state,
      tab: bridge.tab,
      uptime: Date.now() - startedAt,
    } satisfies HealthResponse)
  )

  // stateless mode never issues a session, so GET (SSE stream) and DELETE
  // (session teardown) have nothing to do here; routing them into the
  // transport opens/aborts a stream per request, which an MCP client's own
  // reconnect logic turns into an unbounded per-client loop
  app.on(['GET', 'DELETE'], '/mcp', (c) => {
    c.header('Allow', 'POST')
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      },
      405
    )
  })

  app.post('/mcp', async (c) => {
    if (!mcp) return c.json({ error: 'mcp not configured' }, 503)
    return mcp(c)
  })

  return { app, websocket }
}

export type { AppDeps }
export { createApp, loopbackHosts }
