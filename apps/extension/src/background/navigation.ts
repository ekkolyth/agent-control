import { ProtocolError } from '@agent-control/protocol'

type Waiter = {
  resolve: () => void
  reject: (error: unknown) => void
}

class NavigationTracker {
  readonly #api: typeof browser.webNavigation
  readonly #pending = new Set<number>()
  readonly #waiters = new Map<number, Set<Waiter>>()
  readonly #lastCompleted = new Map<number, number>()
  // bumped when a navigation starts as well as when one lands, so a caller
  // can wait for the mere sign of one rather than for its completion
  readonly #activity = new Map<number, number>()
  readonly #activityWaiters = new Map<number, Set<() => void>>()
  // documentId of the top-frame document most recently committed per tab
  readonly #committed = new Map<number, string>()
  // the committed document that was current when the tab's newest
  // navigation started — the one that navigation is replacing
  readonly #superseded = new Map<number, string>()
  #completedSeq = 0
  #activitySeq = 0

  constructor(
    api?: typeof browser.webNavigation,
    tabs?: Pick<typeof browser.tabs, 'onRemoved'>
  ) {
    this.#api = api ?? browser.webNavigation
    this.#api.onBeforeNavigate.addListener((details) => {
      if (details.frameId !== 0) return
      this.#pending.add(details.tabId)
      this.#bumpActivity(details.tabId)
      const committed = this.#committed.get(details.tabId)
      if (committed !== undefined) {
        this.#superseded.set(details.tabId, committed)
      }
    })
    this.#api.onCommitted.addListener((details) => {
      if (details.frameId !== 0) return
      this.#committed.set(details.tabId, details.documentId)
    })
    this.#api.onCompleted.addListener((details) => {
      if (details.frameId !== 0) return
      this.#complete(details.tabId)
    })
    this.#api.onErrorOccurred.addListener((details) => {
      if (details.frameId !== 0) return
      // Chrome reports net::ERR_ABORTED both for a navigation that went
      // nowhere (a download, a 204 — no document, so a zero documentId)
      // and for a committed document whose load a newer navigation cut
      // short. Only the second is still going somewhere: that newer
      // navigation's own completion or error settles the wait
      if (
        details.error === 'net::ERR_ABORTED' &&
        details.documentId === this.#superseded.get(details.tabId)
      ) {
        return
      }
      this.#pending.delete(details.tabId)
      this.#settle(details.tabId, (waiter) =>
        waiter.reject(new ProtocolError('NAVIGATION_FAILED', details.error))
      )
    })
    // a fragment change or a history.pushState/replaceState is reported as
    // exactly one of these, with no onBeforeNavigate or onCompleted around
    // it. One landing while a cross-document load is pending is the new
    // page adjusting its own url (a router's replaceState on boot), and the
    // load's real onCompleted is still to come
    const onSameDocument = (details: { tabId: number; frameId: number }) => {
      if (details.frameId !== 0 || this.#pending.has(details.tabId)) return
      this.#complete(details.tabId)
    }
    this.#api.onHistoryStateUpdated.addListener(onSameDocument)
    this.#api.onReferenceFragmentUpdated.addListener(onSameDocument)
    // a closed tab id can be reassigned by Chrome to an unrelated tab; drop
    // its completion count so that tab's first wait can't inherit a mark
    // that has nothing to do with it
    ;(tabs ?? browser.tabs).onRemoved.addListener((tabId) => {
      this.#lastCompleted.delete(tabId)
      this.#activity.delete(tabId)
      this.#committed.delete(tabId)
      this.#superseded.delete(tabId)
    })
  }

  pending(tabId: number): boolean {
    return this.#pending.has(tabId)
  }

  activityMark(tabId: number): number {
    return this.#activity.get(tabId) ?? 0
  }

  // true once a navigation has either started or landed since the mark;
  // false when the cap runs out with neither, meaning the action that just
  // ran is not going anywhere
  waitForActivity(
    tabId: number,
    capMs: number,
    since: number
  ): Promise<boolean> {
    if (this.activityMark(tabId) > since) return Promise.resolve(true)

    return new Promise((resolve) => {
      let settled = false
      const done = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#activityWaiters.get(tabId)?.delete(notify)
        resolve(value)
      }
      const notify = () => done(true)
      const timer = setTimeout(() => done(false), capMs)
      const set = this.#activityWaiters.get(tabId) ?? new Set()
      set.add(notify)
      this.#activityWaiters.set(tabId, set)
    })
  }

  // sample before issuing a navigation; pass the result as `since` so a
  // completion landing between the sample and waitForCompleted still counts
  mark(tabId: number): number {
    return this.#lastCompleted.get(tabId) ?? 0
  }

  // required, not defaulted: a default of 0 would satisfy this the instant
  // any prior navigation had ever completed on the tab — true for almost
  // every call once the agent has navigated there once — and silently skip
  // waiting for the navigation the caller actually means to wait for
  waitForCompleted(tabId: number, capMs: number, since: number): Promise<void> {
    // onCompleted is only observed live via #waiters below, so a completion
    // that already fired in the gap between mark() and this call — the norm
    // for a bfcache restore — would otherwise be missed and block to capMs
    if ((this.#lastCompleted.get(tabId) ?? 0) > since) return Promise.resolve()

    return new Promise((resolve, reject) => {
      let settled = false

      const finish = (run: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#removeWaiter(tabId, waiter)
        run()
      }

      const waiter: Waiter = {
        resolve: () => finish(resolve),
        reject: (error) => finish(() => reject(error)),
      }

      const timer = setTimeout(() => {
        finish(() =>
          reject(new ProtocolError('NAVIGATION_FAILED', 'Navigation timed out'))
        )
      }, capMs)

      this.#addWaiter(tabId, waiter)
    })
  }

  #complete(tabId: number): void {
    this.#pending.delete(tabId)
    this.#lastCompleted.set(tabId, ++this.#completedSeq)
    this.#bumpActivity(tabId)
    this.#settle(tabId, (waiter) => waiter.resolve())
  }

  #bumpActivity(tabId: number): void {
    this.#activity.set(tabId, ++this.#activitySeq)
    const waiters = this.#activityWaiters.get(tabId)
    if (!waiters) return
    this.#activityWaiters.delete(tabId)
    for (const notify of [...waiters]) notify()
  }

  #addWaiter(tabId: number, waiter: Waiter): void {
    const set = this.#waiters.get(tabId) ?? new Set()
    set.add(waiter)
    this.#waiters.set(tabId, set)
  }

  #removeWaiter(tabId: number, waiter: Waiter): void {
    const set = this.#waiters.get(tabId)
    if (!set) return
    set.delete(waiter)
    if (set.size === 0) this.#waiters.delete(tabId)
  }

  #settle(tabId: number, run: (waiter: Waiter) => void): void {
    const waiters = this.#waiters.get(tabId)
    if (!waiters) return
    for (const waiter of [...waiters]) run(waiter)
  }
}

export { NavigationTracker }
