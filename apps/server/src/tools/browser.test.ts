import { commands, ProtocolError } from '@agent-control/protocol'
import { describe, expect, test, vi } from 'vitest'
import { captureDestination, parseLogLines } from '../../tests/log-capture'
import { createLogger, type Logger } from '../log'
import { ToolRegistry } from '../registry'
import { errorText, registerBrowserTools, snapshotPolicy } from './browser'

const page = {
  url: 'https://a.test/',
  title: 'A',
  snapshot: '- button "Go" [ref=s1e1]',
  hash: 'h1',
}
// an unexpected throw now logs at error — keep the assertions on agent-facing
// text from also dumping real JSON into the test run
const quietLogger = createLogger({
  service: 'test',
  destination: captureDestination(),
})

function setup(
  send: (name: string, payload: unknown) => Promise<unknown> = vi.fn(
    async () => page
  ),
  logger: Logger = quietLogger
) {
  const registry = new ToolRegistry()
  const sleep = vi.fn(async () => {})
  registerBrowserTools(registry, { send } as never, { sleep, logger })
  return { registry, send, sleep }
}

describe('browser tools', () => {
  test('registers thirteen tools', () => {
    expect(setup().registry.list().length).toBe(13)
  })

  test('click sends compact mode and formats the page', async () => {
    const { registry, send } = setup()
    const out = await registry.get('browser_click')!({
      element: 'Go',
      ref: 's1e1',
    })
    expect(send).toHaveBeenCalledWith('click', { ref: 's1e1', mode: 'compact' })
    expect(out.content[0]).toEqual({
      type: 'text',
      text:
        '- Page URL: https://a.test/\n' +
        '- Page Title: A\n' +
        '- Page Snapshot\n' +
        '```yaml\n' +
        '- button "Go" [ref=s1e1]\n' +
        '```',
    })
  })

  test('snapshot sends full mode', async () => {
    const { registry, send } = setup()
    await registry.get('browser_snapshot')!({})
    expect(send).toHaveBeenCalledWith('snapshot', { mode: 'full' })
  })

  test('go back sends the back command', async () => {
    const { registry, send } = setup()
    await registry.get('browser_go_back')!({})
    expect(send).toHaveBeenCalledWith('back', { mode: 'compact' })
  })

  test('go forward sends the forward command', async () => {
    const { registry, send } = setup()
    await registry.get('browser_go_forward')!({})
    expect(send).toHaveBeenCalledWith('forward', { mode: 'compact' })
  })

  test('hover omits snapshot when hash unchanged, includes when changed', async () => {
    const send = vi.fn(async () => page)
    const { registry } = setup(send)
    await registry.get('browser_click')!({ element: 'Go', ref: 's1e1' })
    const same = await registry.get('browser_hover')!({
      element: 'Go',
      ref: 's1e1',
    })
    expect((same.content[0] as { text: string }).text).not.toContain(
      'Page Snapshot'
    )

    // Same registry, so lastHash is already 'h1' from the calls above — this
    // is the "hash changed since a prior call" path, not the first-call path.
    send.mockImplementation(async () => ({ ...page, hash: 'h2' }))
    const changed = await registry.get('browser_hover')!({
      element: 'Go',
      ref: 's1e1',
    })
    expect((changed.content[0] as { text: string }).text).toContain(
      'Page Snapshot'
    )
  })

  test('invalid args return isError without calling the bridge', async () => {
    const { registry, send } = setup()
    const out = await registry.get('browser_click')!({ ref: 's1e1' })
    expect(out.isError).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  test('protocol errors map to agent text', async () => {
    const { registry } = setup(
      vi.fn(async () => {
        throw new ProtocolError('STALE_REF', 'old')
      })
    )
    const out = await registry.get('browser_click')!({
      element: 'Go',
      ref: 's1e1',
    })
    expect(out.isError).toBe(true)
    expect((out.content[0] as { text: string }).text).toBe(
      errorText('STALE_REF', 'old')
    )
  })

  test('non-ProtocolError throws map to INTERNAL without double-prefixing', async () => {
    const { registry } = setup(
      vi.fn(async () => {
        throw new Error('boom')
      })
    )
    const out = await registry.get('browser_click')!({
      element: 'Go',
      ref: 's1e1',
    })
    expect(out.isError).toBe(true)
    expect((out.content[0] as { text: string }).text).toBe(
      'Extension error: boom'
    )
  })

  test('an unexpected throw is logged at error with the tool name', async () => {
    const dest = captureDestination()
    const { registry } = setup(
      vi.fn(async () => {
        throw new Error('boom')
      }),
      createLogger({ service: 'test', destination: dest })
    )
    await registry.get('browser_click')!({ element: 'Go', ref: 's1e1' })
    const record = parseLogLines(dest.lines).at(-1)
    expect(record?.level).toBe(50)
    expect(record?.msg).toBe('tool handler threw')
    expect(record?.tool).toBe('browser_click')
    expect(record?.error).toMatchObject({ message: 'boom' })
  })

  test('a protocol error is an expected outcome and is never logged at error', async () => {
    const dest = captureDestination()
    const { registry } = setup(
      vi.fn(async () => {
        throw new ProtocolError('STALE_REF', 'old')
      }),
      createLogger({ service: 'test', destination: dest })
    )
    await registry.get('browser_click')!({ element: 'Go', ref: 's1e1' })
    expect(parseLogLines(dest.lines).some((r) => r.level === 50)).toBe(false)
  })

  test('a payload that fails its own command schema surfaces as isError instead of reaching the bridge', async () => {
    const { registry, send } = setup()
    const parseSpy = vi
      .spyOn(commands.click.request, 'parse')
      .mockImplementation(() => {
        throw new Error('wire schema rejected this payload')
      })
    try {
      const out = await registry.get('browser_click')!({
        element: 'Go',
        ref: 's1e1',
      })
      expect(out.isError).toBe(true)
      expect((out.content[0] as { text: string }).text).toBe(
        'Extension error: wire schema rejected this payload'
      )
      expect(send).not.toHaveBeenCalled()
    } finally {
      parseSpy.mockRestore()
    }
  })

  test('every error code has agent-facing text matching the spec table', () => {
    expect(errorText('NO_TAB', '')).toBe(
      'No tab is paired. Click the extension icon on the tab you want to control and press Connect.'
    )
    expect(errorText('STALE_REF', '')).toBe(
      'Element reference is stale or missing. Call browser_snapshot and retry with a fresh ref.'
    )
    expect(errorText('REF_NOT_FOUND', '')).toBe(
      'Element reference is stale or missing. Call browser_snapshot and retry with a fresh ref.'
    )
    expect(errorText('DEBUGGER_FAILED', '')).toBe(
      'Could not attach the debugger. Close DevTools on the paired tab and retry.'
    )
    expect(errorText('TIMEOUT', '')).toBe(
      'The extension did not respond in time. Call browser_snapshot to check page state.'
    )
    expect(errorText('NAVIGATION_FAILED', 'net::ERR_X')).toBe(
      'Navigation failed: net::ERR_X'
    )
    expect(errorText('DISCONNECTED', '')).toBe(
      'Connection to the extension dropped mid-action. The action may have landed. Call browser_snapshot to check state.'
    )
    expect(errorText('INTERNAL', 'boom')).toBe('Extension error: boom')
  })

  test('screenshot returns image content', async () => {
    const { registry } = setup(vi.fn(async () => ({ data: 'iVBOR' })))
    const out = await registry.get('browser_screenshot')!({})
    expect(out.content[0]).toEqual({
      type: 'image',
      data: 'iVBOR',
      mimeType: 'image/png',
    })
  })

  test('console logs are one json line per entry', async () => {
    const { registry } = setup(
      vi.fn(async () => ({
        entries: [
          { level: 'log', text: 'a', timestamp: 1 },
          { level: 'error', text: 'b', timestamp: 2 },
        ],
      }))
    )
    const out = await registry.get('browser_get_console_logs')!({})
    expect((out.content[0] as { text: string }).text.split('\n').length).toBe(2)
  })

  test('empty console logs return an actionable message, not blank text', async () => {
    const { registry } = setup(vi.fn(async () => ({ entries: [] })))
    const out = await registry.get('browser_get_console_logs')!({})
    expect((out.content[0] as { text: string }).text).toBe(
      'No console logs captured.'
    )
  })

  test('wait sleeps locally and never touches the bridge', async () => {
    const { registry, send, sleep } = setup()
    const out = await registry.get('browser_wait')!({ time: 2 })
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(send).not.toHaveBeenCalled()
    expect((out.content[0] as { text: string }).text).toBe(
      'Waited for 2 seconds'
    )
  })

  test('policy table matches the spec for all thirteen tools', () => {
    expect(snapshotPolicy).toEqual({
      browser_navigate: { mode: 'compact', include: 'always' },
      browser_go_back: { mode: 'compact', include: 'always' },
      browser_go_forward: { mode: 'compact', include: 'always' },
      browser_snapshot: { mode: 'full', include: 'always' },
      browser_click: { mode: 'compact', include: 'always' },
      browser_hover: { mode: 'compact', include: 'ifChanged' },
      browser_type: { mode: 'compact', include: 'always' },
      browser_press_key: { mode: 'compact', include: 'ifChanged' },
      browser_select_option: { mode: 'compact', include: 'always' },
      browser_drag: { mode: 'compact', include: 'always' },
      browser_screenshot: { mode: 'none', include: 'never' },
      browser_get_console_logs: { mode: 'none', include: 'never' },
      browser_wait: { mode: 'none', include: 'never' },
    })
  })
})
