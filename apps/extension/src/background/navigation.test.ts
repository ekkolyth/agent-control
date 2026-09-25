import { ProtocolError } from '@agent-control/protocol'
import { describe, expect, test, vi } from 'vitest'
import { NavigationTracker } from './navigation'

type NavDetails = {
  tabId: number
  frameId: number
  url?: string
  error?: string
  documentId?: string
}
type Listener = (details: NavDetails) => void

// what Chrome sends when the navigation never produced a document: a
// download, a 204, a load that never committed
const NO_DOCUMENT = '00000000000000000000000000000000'

function fakeWebNavigation() {
  const listeners = {
    onBeforeNavigate: [] as Listener[],
    onCommitted: [] as Listener[],
    onCompleted: [] as Listener[],
    onErrorOccurred: [] as Listener[],
    onHistoryStateUpdated: [] as Listener[],
    onReferenceFragmentUpdated: [] as Listener[],
  }
  const api = Object.fromEntries(
    Object.keys(listeners).map((event) => [
      event,
      {
        addListener: (fn: Listener) =>
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

function fakeTabs() {
  const listeners: Array<(tabId: number) => void> = []
  return {
    api: {
      onRemoved: {
        addListener: (fn: (tabId: number) => void) => listeners.push(fn),
      },
    },
    remove(tabId: number) {
      for (const fn of listeners) fn(tabId)
    },
  }
}

// drains microtasks without advancing any timer, so a wait that is still
// parked stays parked and a wait that settled is observed as settled
async function observe(p: Promise<void>): Promise<'pending' | 'settled'> {
  let state: 'pending' | 'settled' = 'pending'
  p.then(
    () => {
      state = 'settled'
    },
    () => {
      state = 'settled'
    }
  )
  await vi.advanceTimersByTimeAsync(0)
  return state
}

describe('NavigationTracker', () => {
  test('resolves when the top frame completes', async () => {
    const { api, fire } = fakeWebNavigation()
    const nav = new NavigationTracker(api as never)
    const p = nav.waitForCompleted(5, 10_000, 0)
    fire('onCompleted', { tabId: 5, frameId: 0 })
    await expect(p).resolves.toBeUndefined()
  })

  test('ignores a completion in a sub-frame', async () => {
    const { api, fire } = fakeWebNavigation()
    const nav = new NavigationTracker(api as never)
    const p = nav.waitForCompleted(5, 10_000, 0)
    fire('onCompleted', { tabId: 5, frameId: 3 })
    fire('onCompleted', { tabId: 5, frameId: 0 })
    await expect(p).resolves.toBeUndefined()
  })

  test('rejects with NAVIGATION_FAILED when the top frame errors', async () => {
    const { api, fire } = fakeWebNavigation()
    const nav = new NavigationTracker(api as never)
    const p = nav.waitForCompleted(5, 10_000, 0)
    fire('onErrorOccurred', {
      tabId: 5,
      frameId: 0,
      error: 'net::ERR_CONNECTION_REFUSED',
      documentId: NO_DOCUMENT,
    })
    await expect(p).rejects.toThrow(ProtocolError)
    await expect(p).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
  })

  test('rejects with NAVIGATION_FAILED after the cap elapses', async () => {
    vi.useFakeTimers()
    try {
      const { api } = fakeWebNavigation()
      const nav = new NavigationTracker(api as never)
      const p = nav.waitForCompleted(5, 10_000, 0)
      const assertion = expect(p).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  test('a completion recorded before the wait began still satisfies it', async () => {
    vi.useFakeTimers()
    try {
      const { api, fire } = fakeWebNavigation()
      const nav = new NavigationTracker(api as never)
      const since = nav.mark(5)
      fire('onCompleted', { tabId: 5, frameId: 0 })

      let settled = false
      nav.waitForCompleted(5, 10_000, since).then(() => {
        settled = true
      })
      // the short-circuit resolves via a plain Promise.resolve(), not the
      // capMs timer, so this must observe it without advancing time — a
      // regression that drops the short-circuit would otherwise only show
      // up as a 10s timeout instead of a failed assertion
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  test('drops the completion mark when the tab closes', () => {
    const { api, fire } = fakeWebNavigation()
    const tabs = fakeTabs()
    const nav = new NavigationTracker(api as never, tabs.api as never)
    fire('onCompleted', { tabId: 5, frameId: 0 })
    expect(nav.mark(5)).toBeGreaterThan(0)

    tabs.remove(5)

    expect(nav.mark(5)).toBe(0)
  })

  test('a mark taken after the completion does not satisfy a later wait', async () => {
    vi.useFakeTimers()
    try {
      const { api, fire } = fakeWebNavigation()
      const nav = new NavigationTracker(api as never)
      fire('onCompleted', { tabId: 5, frameId: 0 })
      const since = nav.mark(5)

      const p = nav.waitForCompleted(5, 10_000, since)
      const assertion = expect(p).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  describe('same-document navigation', () => {
    test.each([
      ['onReferenceFragmentUpdated', 'http://x/#frag'],
      ['onHistoryStateUpdated', 'http://x/route'],
    ] as const)(
      '%s in the top frame completes the wait',
      async (event, url) => {
        const { api, fire } = fakeWebNavigation()
        const nav = new NavigationTracker(api as never)
        const p = nav.waitForCompleted(5, 10_000, nav.mark(5))
        fire(event, { tabId: 5, frameId: 3, url })
        fire(event, { tabId: 5, frameId: 0, url })
        await expect(p).resolves.toBeUndefined()
      }
    )

    test('one recorded before the wait began still satisfies it', async () => {
      vi.useFakeTimers()
      try {
        const { api, fire } = fakeWebNavigation()
        const nav = new NavigationTracker(api as never)
        const since = nav.mark(5)
        fire('onReferenceFragmentUpdated', {
          tabId: 5,
          frameId: 0,
          url: 'http://x/#frag',
        })
        expect(await observe(nav.waitForCompleted(5, 10_000, since))).toBe(
          'settled'
        )
      } finally {
        vi.useRealTimers()
      }
    })

    test('one landing during a cross-document load is not that load completing', async () => {
      vi.useFakeTimers()
      try {
        const { api, fire } = fakeWebNavigation()
        const nav = new NavigationTracker(api as never)
        const p = nav.waitForCompleted(5, 10_000, nav.mark(5))
        fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/boot' })
        // a router's replaceState on boot, before the page has loaded
        fire('onHistoryStateUpdated', {
          tabId: 5,
          frameId: 0,
          url: 'http://x/boot?x=1',
        })
        expect(await observe(p)).toBe('pending')
        expect(nav.pending(5)).toBe(true)

        fire('onCompleted', { tabId: 5, frameId: 0, url: 'http://x/boot?x=1' })
        expect(await observe(p)).toBe('settled')
        expect(nav.pending(5)).toBe(false)
        await expect(p).resolves.toBeUndefined()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('net::ERR_ABORTED', () => {
    const abort = (
      fire: ReturnType<typeof fakeWebNavigation>['fire'],
      url: string,
      documentId: string
    ) =>
      fire('onErrorOccurred', {
        tabId: 5,
        frameId: 0,
        url,
        error: 'net::ERR_ABORTED',
        documentId,
      })

    test('a navigation that never committed rejects', async () => {
      const { api, fire } = fakeWebNavigation()
      const nav = new NavigationTracker(api as never)
      fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/' })
      fire('onCommitted', { tabId: 5, frameId: 0, documentId: 'doc-home' })
      fire('onCompleted', { tabId: 5, frameId: 0 })

      const p = nav.waitForCompleted(5, 10_000, nav.mark(5))
      // a download or a 204: Chrome starts the navigation, then abandons it
      // without a document
      fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/dl' })
      abort(fire, 'http://x/dl', NO_DOCUMENT)
      await expect(p).rejects.toThrow('net::ERR_ABORTED')
      expect(nav.pending(5)).toBe(false)
    })

    test('a committed load cut short by a newer navigation waits for that navigation', async () => {
      vi.useFakeTimers()
      try {
        const { api, fire } = fakeWebNavigation()
        const nav = new NavigationTracker(api as never)
        const p = nav.waitForCompleted(5, 10_000, nav.mark(5))
        // the measured sequence for a head script doing location.href
        // while a slow image still holds the first page's load open
        fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/a' })
        fire('onCommitted', { tabId: 5, frameId: 0, documentId: 'doc-a' })
        fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/b' })
        abort(fire, 'http://x/a', 'doc-a')
        expect(await observe(p)).toBe('pending')
        expect(nav.pending(5)).toBe(true)

        fire('onCommitted', { tabId: 5, frameId: 0, documentId: 'doc-b' })
        fire('onCompleted', { tabId: 5, frameId: 0, url: 'http://x/b' })
        await expect(p).resolves.toBeUndefined()
        expect(nav.pending(5)).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    test('the newer navigation failing rejects with its own error', async () => {
      const { api, fire } = fakeWebNavigation()
      const nav = new NavigationTracker(api as never)
      const p = nav.waitForCompleted(5, 10_000, nav.mark(5))
      fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/a' })
      fire('onCommitted', { tabId: 5, frameId: 0, documentId: 'doc-a' })
      fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/b' })
      abort(fire, 'http://x/a', 'doc-a')
      fire('onErrorOccurred', {
        tabId: 5,
        frameId: 0,
        url: 'http://x/b',
        error: 'net::ERR_CONNECTION_REFUSED',
        documentId: NO_DOCUMENT,
      })
      await expect(p).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
    })

    test('a committed load stopped with no newer navigation rejects', async () => {
      const { api, fire } = fakeWebNavigation()
      const nav = new NavigationTracker(api as never)
      const p = nav.waitForCompleted(5, 10_000, nav.mark(5))
      fire('onBeforeNavigate', { tabId: 5, frameId: 0, url: 'http://x/a' })
      fire('onCommitted', { tabId: 5, frameId: 0, documentId: 'doc-a' })
      // the user hit stop: same error, same document, nothing replacing it
      abort(fire, 'http://x/a', 'doc-a')
      await expect(p).rejects.toThrow('net::ERR_ABORTED')
    })
  })
})

describe('NavigationTracker activity', () => {
  test('a navigation that starts after the mark counts as activity', async () => {
    vi.useFakeTimers()
    const nav = fakeWebNavigation()
    const tracker = new NavigationTracker(
      nav.api as never,
      fakeTabs().api as never
    )
    const since = tracker.activityMark(1)

    const waiting = tracker.waitForActivity(1, 300, since)
    nav.fire('onBeforeNavigate', { tabId: 1, frameId: 0 })
    await expect(waiting).resolves.toBe(true)
    vi.useRealTimers()
  })

  test('a same-document route change counts as activity', async () => {
    vi.useFakeTimers()
    const nav = fakeWebNavigation()
    const tracker = new NavigationTracker(
      nav.api as never,
      fakeTabs().api as never
    )
    const since = tracker.activityMark(1)

    const waiting = tracker.waitForActivity(1, 300, since)
    nav.fire('onHistoryStateUpdated', { tabId: 1, frameId: 0 })
    await expect(waiting).resolves.toBe(true)
    vi.useRealTimers()
  })

  test('nothing moving resolves false at the cap', async () => {
    vi.useFakeTimers()
    const nav = fakeWebNavigation()
    const tracker = new NavigationTracker(
      nav.api as never,
      fakeTabs().api as never
    )

    const waiting = tracker.waitForActivity(1, 300, tracker.activityMark(1))
    await vi.advanceTimersByTimeAsync(299)
    let settled = false
    void waiting.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBe(false)
    vi.useRealTimers()
  })

  test('activity already past the mark resolves without waiting', async () => {
    vi.useFakeTimers()
    const nav = fakeWebNavigation()
    const tracker = new NavigationTracker(
      nav.api as never,
      fakeTabs().api as never
    )
    const since = tracker.activityMark(1)
    nav.fire('onBeforeNavigate', { tabId: 1, frameId: 0 })

    await expect(tracker.waitForActivity(1, 300, since)).resolves.toBe(true)
    vi.useRealTimers()
  })

  test('a subframe navigation is not activity on the tab', async () => {
    vi.useFakeTimers()
    const nav = fakeWebNavigation()
    const tracker = new NavigationTracker(
      nav.api as never,
      fakeTabs().api as never
    )
    const since = tracker.activityMark(1)
    nav.fire('onBeforeNavigate', { tabId: 1, frameId: 3 })

    expect(tracker.activityMark(1)).toBe(since)
    vi.useRealTimers()
  })

  test('a closed tab drops its activity count', () => {
    const nav = fakeWebNavigation()
    const tabs = fakeTabs()
    const tracker = new NavigationTracker(nav.api as never, tabs.api as never)
    nav.fire('onBeforeNavigate', { tabId: 1, frameId: 0 })
    expect(tracker.activityMark(1)).toBeGreaterThan(0)

    tabs.remove(1)
    expect(tracker.activityMark(1)).toBe(0)
  })
})
