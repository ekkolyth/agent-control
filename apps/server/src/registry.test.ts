import { describe, expect, test, vi } from 'vitest'
import { ToolRegistry } from './registry'

describe('ToolRegistry', () => {
  test('register, list, get, duplicate throws, attach calls registerTool', () => {
    const r = new ToolRegistry()
    const def = {
      name: 'browser_wait' as const,
      description: 'd',
      inputShape: {},
    }
    const handler = vi.fn(async () => ({ content: [] }))
    r.register(def, handler)
    expect(r.list()).toEqual([def])
    expect(r.get('browser_wait')).toBe(handler)
    expect(() => r.register(def, handler)).toThrow(/duplicate/i)
    const server = { registerTool: vi.fn() }
    r.attach(server as never)
    expect(server.registerTool).toHaveBeenCalledWith(
      'browser_wait',
      { description: 'd', inputSchema: {} },
      expect.any(Function)
    )
  })
})
