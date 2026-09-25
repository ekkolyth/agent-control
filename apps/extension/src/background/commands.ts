import type {
  CommandName,
  CommandRequest,
  CommandResponse,
  PageState,
  RequestFrame,
  ResponseFrame,
  SnapshotMode,
} from '@agent-control/protocol'
import { commands, ProtocolError } from '@agent-control/protocol'
import type { Cdp } from './cdp'
import type { ConsoleBuffer } from './console-buffer'
import type { ContentClient } from './content-client'
import { Keyboard, Mouse } from './input'
import type { NavigationTracker } from './navigation'
import type { NetworkMonitor } from './network'
import type { Session } from './session'

// how long an action waits for a sign that it navigated, once the dom has
// already gone quiet without one
const NAVIGATION_GRACE_MS = 300

// how long nothing may be in flight before the page counts as done
// fetching; long enough to see a fetch chained off the one before it
const NETWORK_IDLE_MS = 300
const NETWORK_IDLE_CAP_MS = 3000

type CommandDeps = {
  session: Session
  cdp: Cdp
  content: ContentClient
  nav: NavigationTracker
  network: NetworkMonitor
  consoleBuffer: ConsoleBuffer
  tabs: Pick<typeof browser.tabs, 'get' | 'update' | 'goBack' | 'goForward'>
  settle?: (tabId: number) => Promise<void>
}

type CommandHandlers = {
  [N in CommandName]: (
    payload: CommandRequest<N>
  ) => Promise<CommandResponse<N>>
}

function inputFor(
  cdp: Cdp,
  tabId: number
): { mouse: Mouse; keyboard: Keyboard } {
  const send = (method: string, params?: Record<string, unknown>) =>
    cdp.send(tabId, method, params)
  const keyboard = new Keyboard(send)
  const mouse = new Mouse(send, keyboard)
  return { mouse, keyboard }
}

function createCommandHandlers(deps: CommandDeps): CommandHandlers {
  const { session, cdp, content, nav, network, consoleBuffer, tabs } = deps

  function snapshotAfter(
    tabId: number,
    mode: SnapshotMode
  ): Promise<PageState> {
    return content.request<PageState>(tabId, { kind: 'snapshot', mode })
  }

  const settle =
    deps.settle ??
    (async (tabId: number) => {
      // sampled once so the catch below and the completion wait share the
      // same baseline, whichever of them onCompleted races against
      const since = nav.mark(tabId)
      const activitySince = nav.activityMark(tabId)
      const trafficSince = network.mark(tabId)
      const waitQuiet = () =>
        content.request(tabId, { kind: 'waitQuiet', quietMs: 150, capMs: 1500 })
      // dom quiet alone ends in the lull between one fetch and the render it
      // feeds, handing back a page that is a fraction built. Only an action
      // that actually caused traffic pays for the network wait and the
      // second quiet that lets its results render
      const waitReady = async () => {
        await waitQuiet()
        const hadTraffic = await network.waitForIdle(
          tabId,
          NETWORK_IDLE_MS,
          NETWORK_IDLE_CAP_MS,
          trafficSince
        )
        if (hadTraffic) await waitQuiet()
      }
      try {
        await waitReady()
      } catch (error) {
        // an action that triggers navigation tears the document down mid-wait;
        // Chrome rejects the pending sendMessage instead of resolving it. The
        // rejection can be observed after onCompleted already cleared
        // `pending`, so also tolerate it when a completion landed since the
        // mark above — otherwise a real navigation surfaces as INTERNAL
        if (!nav.pending(tabId) && nav.mark(tabId) === since) throw error
      }
      // a router's pushState routinely lands after the dom has already gone
      // quiet, so an action that navigates would otherwise report the page it
      // started on. Only paid when nothing has moved yet — an action that
      // navigated promptly skips it
      if (!nav.pending(tabId) && nav.mark(tabId) === since) {
        await nav.waitForActivity(tabId, NAVIGATION_GRACE_MS, activitySince)
      }
      if (nav.pending(tabId)) {
        await nav.waitForCompleted(tabId, 10_000, since)
        await waitReady()
      } else if (nav.mark(tabId) !== since) {
        // a same-document route change lands as a completion with nothing
        // pending; the router still has a view to render
        await waitReady()
      }
    })

  async function afterAction(
    tabId: number,
    mode: SnapshotMode
  ): Promise<PageState> {
    await settle(tabId)
    return snapshotAfter(tabId, mode)
  }

  async function resolvePoint(
    tabId: number,
    ref: string
  ): Promise<{ x: number; y: number }> {
    return content.request<{ x: number; y: number }>(tabId, {
      kind: 'resolveRef',
      ref,
    })
  }

  return {
    async tabInfo() {
      const tabId = session.requireTab()
      const tab = await tabs.get(tabId)
      return { url: tab.url ?? '', title: tab.title ?? '' }
    },

    async snapshot({ mode }) {
      const tabId = session.requireTab()
      return snapshotAfter(tabId, mode)
    },

    async navigate({ url, mode }) {
      const tabId = session.requireTab()
      // sample before issuing the navigation so a completion landing before
      // waitForCompleted is registered still satisfies the wait
      const since = nav.mark(tabId)
      await tabs.update(tabId, { url })
      await nav.waitForCompleted(tabId, 10_000, since)
      return afterAction(tabId, mode)
    },

    async back({ mode }) {
      const tabId = session.requireTab()
      const since = nav.mark(tabId)
      await tabs.goBack(tabId)
      await nav.waitForCompleted(tabId, 10_000, since)
      return afterAction(tabId, mode)
    },

    async forward({ mode }) {
      const tabId = session.requireTab()
      const since = nav.mark(tabId)
      await tabs.goForward(tabId)
      await nav.waitForCompleted(tabId, 10_000, since)
      return afterAction(tabId, mode)
    },

    async click({ ref, mode }) {
      const tabId = session.requireTab()
      const pt = await resolvePoint(tabId, ref)
      await cdp.ensureAttached(tabId)
      const { mouse } = inputFor(cdp, tabId)
      await mouse.click(pt.x, pt.y)
      return afterAction(tabId, mode)
    },

    async hover({ ref, mode }) {
      const tabId = session.requireTab()
      const pt = await resolvePoint(tabId, ref)
      await cdp.ensureAttached(tabId)
      const { mouse } = inputFor(cdp, tabId)
      await mouse.move(pt.x, pt.y)
      return afterAction(tabId, mode)
    },

    async drag({ startRef, endRef, mode }) {
      const tabId = session.requireTab()
      const from = await resolvePoint(tabId, startRef)
      const to = await resolvePoint(tabId, endRef)
      await cdp.ensureAttached(tabId)
      const { mouse } = inputFor(cdp, tabId)
      await mouse.drag(from, to)
      return afterAction(tabId, mode)
    },

    async type({ ref, text, submit, mode }) {
      const tabId = session.requireTab()
      const pt = await resolvePoint(tabId, ref)
      await cdp.ensureAttached(tabId)
      const { mouse, keyboard } = inputFor(cdp, tabId)
      await mouse.click(pt.x, pt.y)
      await content.request(tabId, { kind: 'clearValue', ref })
      await keyboard.type(text)
      if (submit) await keyboard.press('Enter')
      return afterAction(tabId, mode)
    },

    async press({ key, mode }) {
      const tabId = session.requireTab()
      await cdp.ensureAttached(tabId)
      const { keyboard } = inputFor(cdp, tabId)
      await keyboard.press(key)
      return afterAction(tabId, mode)
    },

    async select({ ref, values, mode }) {
      const tabId = session.requireTab()
      await content.request(tabId, { kind: 'selectOptions', ref, values })
      return afterAction(tabId, mode)
    },

    async screenshot() {
      const tabId = session.requireTab()
      await cdp.ensureAttached(tabId)
      const result = await cdp.send(tabId, 'Page.captureScreenshot', {
        format: 'png',
      })
      return result as CommandResponse<'screenshot'>
    },

    async consoleLogs() {
      const tabId = session.requireTab()
      return { entries: consoleBuffer.drain(tabId) }
    },
  }
}

async function dispatch(
  handlers: CommandHandlers,
  frame: RequestFrame
): Promise<ResponseFrame> {
  const spec = commands[frame.type]
  const parsed = spec.request.safeParse(frame.payload)
  if (!parsed.success) {
    return {
      id: frame.id,
      ok: false,
      error: { code: 'INTERNAL', message: parsed.error.message },
    }
  }

  try {
    const handler = handlers[frame.type] as (
      payload: unknown
    ) => Promise<unknown>
    const result = await handler(parsed.data)
    return { id: frame.id, ok: true, result }
  } catch (error) {
    if (error instanceof ProtocolError) {
      return {
        id: frame.id,
        ok: false,
        error: { code: error.code, message: error.message },
      }
    }
    return {
      id: frame.id,
      ok: false,
      error: {
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export type { CommandDeps, CommandHandlers }
export { createCommandHandlers, dispatch }
