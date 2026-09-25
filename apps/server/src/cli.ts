import { createApp, loopbackHosts } from './app'
import { Bridge } from './bridge'
import { parseArgs } from './config'
import { createLogger, scope } from './log'
import { createMcpHandler } from './mcp'
import { ToolRegistry } from './registry'
import { registerBrowserTools } from './tools/browser'

const SERVER_NAME = 'agent-control'
const SERVER_VERSION = '0.0.0'

type StartServerOptions = {
  port: number
  reconnectGraceMs: number
  serve?: typeof Bun.serve
}

type ServerHandle = { stop(): void; port: number }

function startServer(opts: StartServerOptions): ServerHandle {
  const logger = createLogger({ service: 'agent-control-server' })
  const bridge = new Bridge({
    reconnectGraceMs: opts.reconnectGraceMs,
    logger,
  })
  const registry = new ToolRegistry()
  registerBrowserTools(registry, bridge)
  const allowedHosts = loopbackHosts(opts.port)
  const mcp = createMcpHandler(
    registry,
    { name: SERVER_NAME, version: SERVER_VERSION },
    allowedHosts
  )
  const { app, websocket } = createApp({ bridge, mcp, logger, allowedHosts })

  const serve = opts.serve ?? Bun.serve
  const server = serve({
    hostname: '127.0.0.1',
    port: opts.port,
    fetch: app.fetch,
    websocket,
  })

  return {
    stop: () => server.stop(),
    port: server.port ?? opts.port,
  }
}

function main(): void {
  const log = scope(createLogger({ service: 'agent-control-server' }), 'cli')
  const args = parseArgs(process.argv.slice(2))

  startServer({
    port: args.port,
    reconnectGraceMs: args.reconnectGraceMs,
  })

  console.log(`agent-control server on http://127.0.0.1:${args.port}/mcp`)
  log.info({ port: args.port }, 'server listening')

  process.on('unhandledRejection', (reason) => {
    log.error({ error: reason }, 'unhandled rejection')
  })
  process.on('uncaughtException', (error) => {
    log.error({ error }, 'uncaught exception')
  })
}

if (import.meta.main) {
  main()
}

export type { ServerHandle, StartServerOptions }
export { startServer }
