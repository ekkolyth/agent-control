import type { ToolDefinition } from '@agent-control/protocol'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>

type Entry = { def: ToolDefinition; handler: ToolHandler }

class ToolRegistry {
  readonly #entries = new Map<string, Entry>()

  register(def: ToolDefinition, handler: ToolHandler): void {
    if (this.#entries.has(def.name)) {
      throw new Error(`duplicate tool registration: ${def.name}`)
    }
    this.#entries.set(def.name, { def, handler })
  }

  list(): ToolDefinition[] {
    return [...this.#entries.values()].map((entry) => entry.def)
  }

  get(name: string): ToolHandler | undefined {
    return this.#entries.get(name)?.handler
  }

  attach(server: McpServer): void {
    for (const { def, handler } of this.#entries.values()) {
      server.registerTool(
        def.name,
        { description: def.description, inputSchema: def.inputShape },
        (args) => handler(args)
      )
    }
  }
}

export type { ToolHandler }
export { ToolRegistry }
