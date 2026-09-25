import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Context } from 'hono'
import type { ToolRegistry } from './registry'

function createMcpHandler(
  registry: ToolRegistry,
  info: { name: string; version: string },
  allowedHosts: readonly string[]
): (c: Context) => Promise<Response> {
  return async (c) => {
    const server = new McpServer(info)
    registry.attach(server)
    // fresh server + transport per request: concurrent clients would
    // otherwise collide on JSON-RPC ids under one shared instance
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      // the app already guards /mcp; this keeps the handler safe if it is
      // ever mounted without that guard
      enableDnsRebindingProtection: true,
      allowedHosts: [...allowedHosts],
    })
    await server.connect(transport)
    try {
      return (await transport.handleRequest(c)) ?? c.body(null, 404)
    } finally {
      // McpServer.close() closes its own transport
      await server.close()
    }
  }
}

export { createMcpHandler }
