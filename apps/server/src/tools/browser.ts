import { homedir } from 'node:os'
import path from 'node:path'
import {
  type CommandName,
  type CommandRequest,
  type CommandResponse,
  commands,
  type ErrorCode,
  type PageState,
  ProtocolError,
  type SnapshotMode,
  type ToolName,
  toolDefinitions,
  toolInputSchemas,
} from '@agent-control/protocol'
import type { z } from 'zod'
import type { Bridge } from '../bridge'
import { createLogger, type Logger, scope } from '../log'
import type { ToolHandler, ToolRegistry } from '../registry'

type BridgeLike = Pick<Bridge, 'send'>

type SnapshotInclude = 'always' | 'ifChanged' | 'never'

const snapshotPolicy: Record<
  ToolName,
  { mode: SnapshotMode; include: SnapshotInclude }
> = {
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
}

function formatPage(state: PageState, includeSnapshot: boolean): string {
  const lines = [`- Page URL: ${state.url}`, `- Page Title: ${state.title}`]
  if (includeSnapshot && state.snapshot !== undefined) {
    lines.push('- Page Snapshot', '```yaml', state.snapshot, '```')
  }
  return lines.join('\n')
}

function errorText(code: ErrorCode, message: string): string {
  switch (code) {
    case 'NO_TAB':
      return 'No tab is paired. Click the extension icon on the tab you want to control and press Connect.'
    case 'STALE_REF':
    case 'REF_NOT_FOUND':
      return 'Element reference is stale or missing. Call browser_snapshot and retry with a fresh ref.'
    case 'DEBUGGER_FAILED':
      return 'Could not attach the debugger. Close DevTools on the paired tab and retry.'
    case 'TIMEOUT':
      return 'The extension did not respond in time. Call browser_snapshot to check page state.'
    case 'NAVIGATION_FAILED':
      return `Navigation failed: ${message}`
    case 'DISCONNECTED':
      return 'Connection to the extension dropped mid-action. The action may have landed. Call browser_snapshot to check state.'
    case 'INTERNAL':
      return `Extension error: ${message}`
  }
}

// relative paths would land under the daemon's cwd, not the agent's repo
function resolveSavePath(filename: string): string | undefined {
  if (filename === '~' || filename.startsWith('~/')) {
    return path.join(homedir(), filename.slice(1))
  }
  return path.isAbsolute(filename) ? filename : undefined
}

function formatZodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message
    )
    .join('; ')
}

function textResult(text: string): {
  content: [{ type: 'text'; text: string }]
} {
  return { content: [{ type: 'text', text }] }
}

function errorResult(text: string): {
  isError: true
  content: [{ type: 'text'; text: string }]
} {
  return { isError: true, content: [{ type: 'text', text }] }
}

type PageCommandName = Exclude<
  CommandName,
  'tabInfo' | 'screenshot' | 'consoleLogs'
>

type PageToolEntry<
  N extends ToolName,
  C extends PageCommandName = PageCommandName,
> = {
  kind: 'page'
  command: C
  buildPayload: (
    args: z.infer<(typeof toolInputSchemas)[N]>,
    mode: SnapshotMode
  ) => CommandRequest<C>
}
type ImageToolEntry = { kind: 'image' }
type ConsoleLogsToolEntry = { kind: 'consoleLogs' }
type WaitToolEntry = { kind: 'wait' }

type BrowserToolEntry<N extends ToolName> =
  | PageToolEntry<N>
  | ImageToolEntry
  | ConsoleLogsToolEntry
  | WaitToolEntry

const browserToolTable: { [N in ToolName]: BrowserToolEntry<N> } = {
  browser_navigate: {
    kind: 'page',
    command: 'navigate',
    buildPayload: (args, mode) => ({ url: args.url, mode }),
  } satisfies PageToolEntry<'browser_navigate', 'navigate'>,
  browser_go_back: {
    kind: 'page',
    command: 'back',
    buildPayload: (_args, mode) => ({ mode }),
  } satisfies PageToolEntry<'browser_go_back', 'back'>,
  browser_go_forward: {
    kind: 'page',
    command: 'forward',
    buildPayload: (_args, mode) => ({ mode }),
  } satisfies PageToolEntry<'browser_go_forward', 'forward'>,
  browser_snapshot: {
    kind: 'page',
    command: 'snapshot',
    buildPayload: (_args, mode) => ({ mode }),
  } satisfies PageToolEntry<'browser_snapshot', 'snapshot'>,
  browser_click: {
    kind: 'page',
    command: 'click',
    buildPayload: (args, mode) => ({ ref: args.ref, mode }),
  } satisfies PageToolEntry<'browser_click', 'click'>,
  browser_hover: {
    kind: 'page',
    command: 'hover',
    buildPayload: (args, mode) => ({ ref: args.ref, mode }),
  } satisfies PageToolEntry<'browser_hover', 'hover'>,
  browser_type: {
    kind: 'page',
    command: 'type',
    buildPayload: (args, mode) => ({
      ref: args.ref,
      text: args.text,
      submit: args.submit,
      mode,
    }),
  } satisfies PageToolEntry<'browser_type', 'type'>,
  browser_press_key: {
    kind: 'page',
    command: 'press',
    buildPayload: (args, mode) => ({ key: args.key, mode }),
  } satisfies PageToolEntry<'browser_press_key', 'press'>,
  browser_select_option: {
    kind: 'page',
    command: 'select',
    buildPayload: (args, mode) => ({
      ref: args.ref,
      values: args.values,
      mode,
    }),
  } satisfies PageToolEntry<'browser_select_option', 'select'>,
  browser_drag: {
    kind: 'page',
    command: 'drag',
    buildPayload: (args, mode) => ({
      startRef: args.startRef,
      endRef: args.endRef,
      mode,
    }),
  } satisfies PageToolEntry<'browser_drag', 'drag'>,
  browser_screenshot: { kind: 'image' },
  browser_get_console_logs: { kind: 'consoleLogs' },
  browser_wait: { kind: 'wait' },
}

// Each table entry above is pinned to its own command literal via `satisfies
// PageToolEntry<tool, command>`, so buildPayload's return type is checked
// against that one command's request shape at the point of definition. Here
// entry.command has widened back to the PageCommandName union, so nothing at
// this call site can prove payload matches whichever command it actually is
// at runtime — parsing it through that command's own schema settles that.
//
// The parse result still needs one cast: inside a generic function body,
// `(typeof commands)[N]['request']` does not distribute over the abstract N,
// so `.parse()`'s inferred return collapses to `Record<string, never> | {
// mode: SnapshotMode }` regardless of N, and tsc reports "Type '... is not
// assignable to type CommandRequest<N>'" on the bare call. By this point
// `.parse` has already thrown on any mismatch, so the cast asserts a fact the
// runtime check just proved, not an unvalidated shape.
function sendCommand<N extends CommandName>(
  bridge: BridgeLike,
  command: N,
  payload: unknown
): Promise<CommandResponse<N>> {
  const request = commands[command].request.parse(payload) as CommandRequest<N>
  return bridge.send(command, request)
}

function registerBrowserTools(
  registry: ToolRegistry,
  bridge: BridgeLike,
  opts?: { sleep?: (ms: number) => Promise<void>; logger?: Logger }
): void {
  const sleep = opts?.sleep ?? ((ms: number) => Bun.sleep(ms))
  const log = scope(
    opts?.logger ?? createLogger({ service: 'agent-control-server' }),
    'tools'
  )
  let lastHash: string | undefined

  for (const def of toolDefinitions) {
    const handler: ToolHandler = async (args) => {
      const schema = toolInputSchemas[def.name]
      const parsed = schema.safeParse(args)
      if (!parsed.success) {
        return errorResult(
          `Invalid arguments for ${def.name}: ${formatZodMessage(parsed.error)}`
        )
      }

      const entry = browserToolTable[def.name]
      try {
        if (entry.kind === 'wait') {
          const { time } = toolInputSchemas.browser_wait.parse(args)
          await sleep(time * 1000)
          return textResult(`Waited for ${time} seconds`)
        }

        if (entry.kind === 'image') {
          const { filename } = toolInputSchemas.browser_screenshot.parse(args)
          const target =
            filename === undefined ? undefined : resolveSavePath(filename)
          if (filename !== undefined && target === undefined) {
            return errorResult(
              `filename must be an absolute or ~/ path, got: ${filename}`
            )
          }
          const result = await sendCommand(bridge, 'screenshot', {})
          const image = {
            type: 'image' as const,
            data: result.data,
            mimeType: 'image/png',
          }
          if (target === undefined) {
            return { content: [image] }
          }
          try {
            // creates missing parent directories
            await Bun.write(target, Buffer.from(result.data, 'base64'))
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            return errorResult(`Could not save to ${target}: ${message}`)
          }
          return {
            content: [image, { type: 'text', text: `Saved to ${target}` }],
          }
        }

        if (entry.kind === 'consoleLogs') {
          const result = await sendCommand(bridge, 'consoleLogs', {})
          return textResult(
            result.entries.length > 0
              ? result.entries
                  .map((logEntry) => JSON.stringify(logEntry))
                  .join('\n')
              : 'No console logs captured.'
          )
        }

        const policy = snapshotPolicy[def.name]
        // Same correlated-union limitation as sendCommand above: parsed.data
        // is the union of all thirteen tools' argument shapes here, but at
        // runtime it is exactly the shape toolInputSchemas[def.name] parsed,
        // which is what buildPayload for this def.name was written against.
        const payload = entry.buildPayload(parsed.data as never, policy.mode)
        const state = await sendCommand(bridge, entry.command, payload)

        const includeSnapshot =
          policy.include === 'always' ||
          (policy.include === 'ifChanged' && lastHash !== state.hash)
        lastHash = state.hash

        return textResult(formatPage(state, includeSnapshot))
      } catch (error) {
        if (error instanceof ProtocolError) {
          return errorResult(errorText(error.code, error.message))
        }
        // the isError result below is a 2xx to the request logger, so this
        // line is the daemon's only record of a defect
        log.error({ error, tool: def.name }, 'tool handler threw')
        const message = error instanceof Error ? error.message : String(error)
        return errorResult(errorText('INTERNAL', message))
      }
    }

    registry.register(def, handler)
  }
}

export type { BridgeLike }
export { errorText, registerBrowserTools, snapshotPolicy }
