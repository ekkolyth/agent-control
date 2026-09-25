import { ProtocolError } from '@agent-control/protocol'
import { describe, expect, test, vi } from 'vitest'
import type { CommandDeps } from './commands'
import { createCommandHandlers, dispatch } from './commands'
import { NavigationTracker } from './navigation'

type NavDetails = { tabId: number; frameId: number; error?: string }
type NavListener = (details: NavDetails) => void

function fakeWebNavigation() {
  const listeners = {
    onBeforeNavigate: [] as NavListener[],
    onCommitted: [] as NavListener[],
    onCompleted: [] as NavListener[],
    onErrorOccurred: [] as NavListener[],
    onHistoryStateUpdated: [] as NavListener[],
    onReferenceFragmentUpdated: [] as NavListener[],
  }
  const api = Object.fromEntries(
    Object.keys(listeners).map((event) => [
      event,
      {
        addListener: (fn: NavListener) =>
          listeners[event as keyof typeof listeners].push(fn),
      },
    ])
  )
  return {
    api,
    fire(event: keyof typeof listeners, details: NavDetails) {
      for (const fn of listeners[event]) fn(details)
    },
  }
}

function deps(
  paired: number | null = 7,
  opts: {
    navPending?: () => boolean
    navMark?: () => number
    traffic?: boolean
  } = {}
) {
  const log: string[] = []

  const session = {
    requireTab: () => {
      if (paired == null) throw new ProtocolError('NO_TAB', 'No tab is paired')
      return paired
    },
  }

  const content = {
    request: vi.fn(async (_tab: number, msg: { kind: string }) => {
      log.push(`content:${msg.kind}`)
      if (msg.kind === 'resolveRef') return { x: 5, y: 6 }
      if (msg.kind === 'snapshot') {
        return { url: 'u', title: 't', snapshot: '- x', hash: 'h' }
      }
      if (msg.kind === 'waitQuiet') return { quiet: true }
      return {}
    }),
  }

  const cdp = {
    ensureAttached: vi.fn(async () => {
      log.push('attach')
    }),
    send: vi.fn(async (_t: number, m: string) => {
      log.push(`cdp:${m}`)
      return m === 'Page.captureScreenshot' ? { data: 'PNG' } : {}
    }),
    onEvent: () => () => {},
  }

  const nav = {
    pending: opts.navPending ?? (() => false),
    mark: opts.navMark ?? vi.fn(() => 0),
    activityMark: vi.fn(() => 0),
    waitForActivity: vi.fn(async () => {
      log.push('nav:grace')
      return false
    }),
    waitForCompleted: vi.fn(async () => {
      log.push('nav:completed')
    }),
  }

  const network = {
    mark: vi.fn(() => 0),
    waitForIdle: vi.fn(async () => {
      if (!opts.traffic) return false
      log.push('net:idle')
      return true
    }),
  }

  const consoleBuffer = {
    drain: () => [{ level: 'log', text: 'a', timestamp: 1 }],
  }

  const tabs = {
    get: vi.fn(async () => {
      log.push('tabs:get')
      return { url: 'u', title: 't' }
    }),
    update: vi.fn(async () => {
      log.push('tabs:update')
    }),
    goBack: vi.fn(async () => {
      log.push('tabs:back')
    }),
    goForward: vi.fn(async () => {
      log.push('tabs:forward')
    }),
  }

  const h = createCommandHandlers({
    session,
    content,
    cdp,
    nav,
    network,
    consoleBuffer,
    tabs,
  } as unknown as CommandDeps)

  return { h, log, content, cdp, nav, network, tabs }
}

describe('commands', () => {
  test('click: resolve → attach → mouse events → settle → snapshot', async () => {
    const { h, log } = deps()
    const r = await h.click({ ref: 's1e1', mode: 'compact' })
    expect(r).toEqual({ url: 'u', title: 't', snapshot: '- x', hash: 'h' })
    expect(log).toEqual([
      'content:resolveRef',
      'attach',
      'cdp:Input.dispatchMouseEvent',
      'cdp:Input.dispatchMouseEvent',
      'cdp:Input.dispatchMouseEvent',
      'content:waitQuiet',
      'nav:grace',
      'content:snapshot',
    ])
  })

  test('navigate waits for completion before settling', async () => {
    const { h, log } = deps()
    await h.navigate({ url: 'https://a.test/', mode: 'compact' })
    expect(log.slice(0, 3)).toEqual([
      'tabs:update',
      'nav:completed',
      'content:waitQuiet',
    ])
  })

  test('type clears then types then submits', async () => {
    const { h, log } = deps()
    await h.type({ ref: 's1e1', text: 'ab', submit: true, mode: 'none' })
    expect(log.filter((l) => l.startsWith('content:'))).toEqual([
      'content:resolveRef',
      'content:clearValue',
      'content:waitQuiet',
      'content:snapshot',
    ])
    expect(log).toContain('nav:grace')
    const keyEvents = log.filter(
      (l) => l === 'cdp:Input.dispatchKeyEvent'
    ).length
    expect(keyEvents).toBe(6) // a down/up, b down/up, Enter down/up
  })

  test('screenshot attaches before capturing, and consoleLogs drains', async () => {
    const { h, log } = deps()
    expect(await h.screenshot({})).toEqual({ data: 'PNG' })
    expect(log).toEqual(['attach', 'cdp:Page.captureScreenshot'])
    expect(await h.consoleLogs({})).toEqual({
      entries: [{ level: 'log', text: 'a', timestamp: 1 }],
    })
  })

  test('settle: waits for the pending navigation between the two waitQuiet calls', async () => {
    const { h, log } = deps(7, { navPending: () => true })
    await h.click({ ref: 's1e1', mode: 'compact' })
    expect(log).toEqual([
      'content:resolveRef',
      'attach',
      'cdp:Input.dispatchMouseEvent',
      'cdp:Input.dispatchMouseEvent',
      'cdp:Input.dispatchMouseEvent',
      'content:waitQuiet',
      'nav:completed',
      'content:waitQuiet',
      'content:snapshot',
    ])
  })

  test('settle: nothing navigated, so one waitQuiet and no completion wait', async () => {
    const { h, log } = deps(7, { navPending: () => false })
    await h.click({ ref: 's1e1', mode: 'compact' })
    expect(
      log.filter((l) => l.startsWith('content:') || l === 'nav:completed')
    ).toEqual(['content:resolveRef', 'content:waitQuiet', 'content:snapshot'])
  })

  test('settle: traffic from the action is waited out, then the dom settles again', async () => {
    const { h, log } = deps(7, { traffic: true })
    await h.click({ ref: 's1e1', mode: 'compact' })
    const tail = log.slice(log.indexOf('content:waitQuiet'))
    expect(tail).toEqual([
      'content:waitQuiet',
      'net:idle',
      'content:waitQuiet',
      'nav:grace',
      'content:snapshot',
    ])
  })

  test('settle: the network wait is measured from before the action settled', async () => {
    const { h, network } = deps(7, { traffic: true })
    network.mark.mockReturnValue(41)
    await h.click({ ref: 's1e1', mode: 'compact' })
    expect(network.waitForIdle).toHaveBeenCalledWith(7, 300, 3000, 41)
  })

  test('settle: the grace is skipped when a navigation is already pending', async () => {
    const { h, nav } = deps(7, { navPending: () => true })
    await h.click({ ref: 's1e1', mode: 'compact' })
    expect(nav.waitForActivity).not.toHaveBeenCalled()
  })

  test('settle: a same-document route change gets a second waitQuiet', async () => {
    let marks = 0
    const { h, log } = deps(7, {
      navPending: () => false,
      // 0 at the sample, then non-zero: a pushState landed as a completion
      // with nothing ever pending
      navMark: () => marks++,
    })
    await h.click({ ref: 's1e1', mode: 'compact' })
    expect(log.filter((l) => l === 'content:waitQuiet')).toHaveLength(2)
  })

  test('settle tolerates a waitQuiet that dies with a navigating document', async () => {
    let waitQuietCalls = 0
    let navPendingNow = false

    const session = { requireTab: () => 7 }
    const content = {
      request: vi.fn(async (_tab: number, msg: { kind: string }) => {
        if (msg.kind === 'resolveRef') return { x: 5, y: 6 }
        if (msg.kind === 'waitQuiet') {
          waitQuietCalls++
          if (waitQuietCalls === 1) {
            // the click itself navigated the tab; Chrome fires
            // onBeforeNavigate (which flips nav.pending) before the
            // document actually tears down and the port closes
            navPendingNow = true
            throw new Error(
              'The message port closed before a response was received.'
            )
          }
          return { quiet: true }
        }
        if (msg.kind === 'snapshot') {
          return { url: 'new', title: 'new', snapshot: '- y', hash: 'h2' }
        }
        return {}
      }),
    }
    const cdp = {
      ensureAttached: vi.fn(async () => {}),
      send: vi.fn(async () => ({})),
      onEvent: () => () => {},
    }
    const nav = {
      pending: () => navPendingNow,
      mark: vi.fn(() => 0),
      activityMark: vi.fn(() => 0),
      waitForActivity: vi.fn(async () => false),
      waitForCompleted: vi.fn(async () => {
        navPendingNow = false
      }),
    }
    const h = createCommandHandlers({
      session,
      content,
      cdp,
      nav,
      network: { mark: () => 0, waitForIdle: async () => false },
      consoleBuffer: { drain: () => [] },
      tabs: {},
    } as unknown as CommandDeps)

    const result = await h.click({ ref: 's1e1', mode: 'compact' })

    expect(result).toEqual({
      url: 'new',
      title: 'new',
      snapshot: '- y',
      hash: 'h2',
    })
    expect(waitQuietCalls).toBe(2)
    expect(nav.waitForCompleted).toHaveBeenCalledTimes(1)
  })

  test('settle rethrows a waitQuiet failure when no navigation is in flight', async () => {
    const session = { requireTab: () => 7 }
    const content = {
      request: vi.fn(async (_tab: number, msg: { kind: string }) => {
        if (msg.kind === 'resolveRef') return { x: 5, y: 6 }
        if (msg.kind === 'waitQuiet') throw new Error('boom')
        return {}
      }),
    }
    const cdp = {
      ensureAttached: vi.fn(async () => {}),
      send: vi.fn(async () => ({})),
      onEvent: () => () => {},
    }
    const nav = {
      pending: () => false,
      mark: vi.fn(() => 0),
      activityMark: vi.fn(() => 0),
      waitForActivity: vi.fn(async () => false),
      waitForCompleted: vi.fn(async () => {}),
    }
    const h = createCommandHandlers({
      session,
      content,
      cdp,
      nav,
      network: { mark: () => 0, waitForIdle: async () => false },
      consoleBuffer: { drain: () => [] },
      tabs: {},
    } as unknown as CommandDeps)

    await expect(h.click({ ref: 's1e1', mode: 'compact' })).rejects.toThrow(
      'boom'
    )
  })

  test('settle tolerates a port-closed rejection when onCompleted already cleared pending', async () => {
    let waitQuietCalls = 0
    const session = { requireTab: () => 7 }
    const content = {
      request: vi.fn(async (_tab: number, msg: { kind: string }) => {
        if (msg.kind === 'resolveRef') return { x: 5, y: 6 }
        if (msg.kind === 'waitQuiet') {
          waitQuietCalls++
          // the document the click tore down takes the first wait with it;
          // the replacement answers the second
          if (waitQuietCalls === 1) {
            throw new Error(
              'The message port closed before a response was received.'
            )
          }
          return { quiet: true }
        }
        if (msg.kind === 'snapshot') {
          return { url: 'new', title: 'new', snapshot: '- y', hash: 'h2' }
        }
        return {}
      }),
    }
    const cdp = {
      ensureAttached: vi.fn(async () => {}),
      send: vi.fn(async () => ({})),
      onEvent: () => () => {},
    }
    // onCompleted fired, and cleared `pending`, between the mark settle
    // samples and the catch reading it back — the residual window fix 2
    // closes. First call is the initial sample, every call after is the
    // catch observing the completion that landed in between.
    let markCalls = 0
    const nav = {
      pending: () => false,
      mark: vi.fn(() => (++markCalls === 1 ? 0 : 1)),
      activityMark: vi.fn(() => 0),
      waitForActivity: vi.fn(async () => false),
      waitForCompleted: vi.fn(async () => {}),
    }
    const h = createCommandHandlers({
      session,
      content,
      cdp,
      nav,
      network: { mark: () => 0, waitForIdle: async () => false },
      consoleBuffer: { drain: () => [] },
      tabs: {},
    } as unknown as CommandDeps)

    await expect(h.click({ ref: 's1e1', mode: 'compact' })).resolves.toEqual({
      url: 'new',
      title: 'new',
      snapshot: '- y',
      hash: 'h2',
    })
  })

  test('settle drives a real NavigationTracker: a prior completion does not let it skip the new one', async () => {
    const { api, fire } = fakeWebNavigation()
    const nav = new NavigationTracker(api as never)
    // the tab already has a completion on record before the click — the
    // regression this guards let `since` default away and treat that as
    // satisfying the wait for the navigation the click is about to cause
    fire('onCompleted', { tabId: 7, frameId: 0 })

    let waitQuietCalls = 0
    const session = { requireTab: () => 7 }
    const content = {
      request: vi.fn(async (_tab: number, msg: { kind: string }) => {
        if (msg.kind === 'resolveRef') return { x: 5, y: 6 }
        if (msg.kind === 'waitQuiet') {
          waitQuietCalls++
          if (waitQuietCalls === 1) {
            fire('onBeforeNavigate', { tabId: 7, frameId: 0 })
            throw new Error(
              'The message port closed before a response was received.'
            )
          }
          return { quiet: true }
        }
        if (msg.kind === 'snapshot') {
          return { url: 'new', title: 'new', snapshot: '- y', hash: 'h2' }
        }
        return {}
      }),
    }
    const cdp = {
      ensureAttached: vi.fn(async () => {}),
      send: vi.fn(async () => ({})),
      onEvent: () => () => {},
    }
    const h = createCommandHandlers({
      session,
      content,
      cdp,
      nav,
      network: { mark: () => 0, waitForIdle: async () => false },
      consoleBuffer: { drain: () => [] },
      tabs: {},
    } as unknown as CommandDeps)

    const clickPromise = h.click({ ref: 's1e1', mode: 'compact' })
    let settled = false
    clickPromise.then(() => {
      settled = true
    })

    // drain the microtask queue without advancing any timer; correct code
    // parks on the real tracker's promise here and stays parked no matter
    // how long this runs, since only a fresh onCompleted resolves it
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(settled).toBe(false)
    expect(waitQuietCalls).toBe(1)

    fire('onCompleted', { tabId: 7, frameId: 0 })
    const result = await clickPromise

    expect(result).toEqual({
      url: 'new',
      title: 'new',
      snapshot: '- y',
      hash: 'h2',
    })
    expect(waitQuietCalls).toBe(2)
  })

  type HandlerCase = {
    name: string
    run: (h: ReturnType<typeof deps>['h']) => Promise<unknown>
    expectedLog: string[]
  }

  const dragMouseEvents = Array<string>(13).fill('cdp:Input.dispatchMouseEvent')

  const handlerCases: HandlerCase[] = [
    {
      name: 'tabInfo reads the tab',
      run: (h) => h.tabInfo({}),
      expectedLog: ['tabs:get'],
    },
    {
      name: 'snapshot reads the content script directly',
      run: (h) => h.snapshot({ mode: 'compact' }),
      expectedLog: ['content:snapshot'],
    },
    {
      name: 'back waits for completion then settles',
      run: (h) => h.back({ mode: 'compact' }),
      expectedLog: [
        'tabs:back',
        'nav:completed',
        'content:waitQuiet',
        'nav:grace',
        'content:snapshot',
      ],
    },
    {
      name: 'forward waits for completion then settles',
      run: (h) => h.forward({ mode: 'compact' }),
      expectedLog: [
        'tabs:forward',
        'nav:completed',
        'content:waitQuiet',
        'nav:grace',
        'content:snapshot',
      ],
    },
    {
      name: 'hover resolves the ref, attaches, then moves the mouse',
      run: (h) => h.hover({ ref: 's1e1', mode: 'compact' }),
      expectedLog: [
        'content:resolveRef',
        'attach',
        'cdp:Input.dispatchMouseEvent',
        'content:waitQuiet',
        'nav:grace',
        'content:snapshot',
      ],
    },
    {
      name: 'drag resolves both refs, attaches, then drags',
      run: (h) => h.drag({ startRef: 's1e1', endRef: 's1e2', mode: 'compact' }),
      expectedLog: [
        'content:resolveRef',
        'content:resolveRef',
        'attach',
        ...dragMouseEvents,
        'content:waitQuiet',
        'nav:grace',
        'content:snapshot',
      ],
    },
    {
      name: 'press attaches before dispatching the key',
      run: (h) => h.press({ key: 'Enter', mode: 'compact' }),
      expectedLog: [
        'attach',
        'cdp:Input.dispatchKeyEvent',
        'cdp:Input.dispatchKeyEvent',
        'content:waitQuiet',
        'nav:grace',
        'content:snapshot',
      ],
    },
    {
      name: 'select applies values then settles',
      run: (h) => h.select({ ref: 's1e1', values: ['a'], mode: 'compact' }),
      expectedLog: [
        'content:selectOptions',
        'content:waitQuiet',
        'nav:grace',
        'content:snapshot',
      ],
    },
  ]

  test.each(handlerCases)('$name', async ({ run, expectedLog }) => {
    const { h, log } = deps()
    await run(h)
    expect(log).toEqual(expectedLog)
  })

  test('dispatch wraps NO_TAB into an error frame', async () => {
    const { h } = deps(null)
    const r = await dispatch(h, {
      id: '1',
      type: 'snapshot',
      payload: { mode: 'full' },
    })
    expect(r).toEqual({
      id: '1',
      ok: false,
      error: { code: 'NO_TAB', message: expect.stringMatching(/paired/) },
    })
  })

  test('dispatch rejects bad payloads as INTERNAL', async () => {
    const { h } = deps()
    const r = await dispatch(h, {
      id: '2',
      type: 'navigate',
      payload: { url: 'nope', mode: 'compact' },
    })
    expect(r).toMatchObject({ id: '2', ok: false, error: { code: 'INTERNAL' } })
  })
})
