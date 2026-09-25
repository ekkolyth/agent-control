import type { Cdp } from './cdp'

// open for as long as the page is, so waiting on them would never end
const IGNORED_TYPES: ReadonlySet<string> = new Set([
  'EventSource',
  'Media',
  'WebSocket',
])

// a request still open after this long is a stream or a long poll rather
// than the page loading, and is left out of the count from then on
const LONG_LIVED_MS = 2000

type Busy = { count: number; nextExpiry: number | null }

function stringField(params: unknown, key: string): string | null {
  if (typeof params !== 'object' || params === null) return null
  const value = (params as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

class NetworkMonitor {
  // requestId -> when it started, per tab
  readonly #inFlight = new Map<number, Map<string, number>>()
  readonly #started = new Map<number, number>()
  readonly #listeners = new Map<number, Set<() => void>>()
  #seq = 0

  attach(cdp: Cdp): () => void {
    return cdp.onEvent((tabId, method, params) => {
      const requestId = stringField(params, 'requestId')
      if (requestId === null) return
      if (method === 'Network.requestWillBeSent') {
        const type = stringField(params, 'type')
        if (type !== null && IGNORED_TYPES.has(type)) return
        this.#begin(tabId, requestId)
      } else if (
        method === 'Network.loadingFinished' ||
        method === 'Network.loadingFailed'
      ) {
        this.#end(tabId, requestId)
      }
    })
  }

  // sample before waiting; a request starting after this is traffic the
  // wait has to see through, even if it already finished by then
  mark(tabId: number): number {
    return this.#started.get(tabId) ?? 0
  }

  // resolves true once nothing has been in flight for idleMs, or at capMs,
  // whichever comes first — and false straight away when there was no
  // traffic since the mark and none is open, so an action that fetched
  // nothing pays nothing
  waitForIdle(
    tabId: number,
    idleMs: number,
    capMs: number,
    since: number
  ): Promise<boolean> {
    if (this.mark(tabId) === since && this.#busy(tabId).count === 0) {
      return Promise.resolve(false)
    }

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = () => {
        clearTimeout(timer)
        clearTimeout(capTimer)
        unsubscribe()
        resolve(true)
      }
      const check = () => {
        clearTimeout(timer)
        timer = undefined
        const { count, nextExpiry } = this.#busy(tabId)
        if (count === 0) {
          timer = setTimeout(finish, idleMs)
        } else if (nextExpiry !== null) {
          // the oldest open request ages out without an event to say so
          timer = setTimeout(check, Math.max(0, nextExpiry - Date.now()))
        }
      }
      const capTimer = setTimeout(finish, capMs)
      const unsubscribe = this.#subscribe(tabId, check)
      check()
    })
  }

  #begin(tabId: number, requestId: string): void {
    const open = this.#inFlight.get(tabId) ?? new Map<string, number>()
    open.set(requestId, Date.now())
    this.#inFlight.set(tabId, open)
    this.#started.set(tabId, ++this.#seq)
    this.#notify(tabId)
  }

  #end(tabId: number, requestId: string): void {
    const open = this.#inFlight.get(tabId)
    if (!open?.delete(requestId)) return
    if (open.size === 0) this.#inFlight.delete(tabId)
    this.#notify(tabId)
  }

  #busy(tabId: number): Busy {
    const open = this.#inFlight.get(tabId)
    if (!open) return { count: 0, nextExpiry: null }
    const now = Date.now()
    let count = 0
    let nextExpiry: number | null = null
    for (const [requestId, startedAt] of open) {
      const expiresAt = startedAt + LONG_LIVED_MS
      if (expiresAt <= now) {
        // never going to report back in a way that matters; drop it so a
        // detach or a lost event can't pin every later wait at its cap
        open.delete(requestId)
        continue
      }
      count++
      if (nextExpiry === null || expiresAt < nextExpiry) nextExpiry = expiresAt
    }
    if (open.size === 0) this.#inFlight.delete(tabId)
    return { count, nextExpiry }
  }

  #subscribe(tabId: number, fn: () => void): () => void {
    const set = this.#listeners.get(tabId) ?? new Set()
    set.add(fn)
    this.#listeners.set(tabId, set)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.#listeners.delete(tabId)
    }
  }

  #notify(tabId: number): void {
    const set = this.#listeners.get(tabId)
    if (!set) return
    for (const fn of [...set]) fn()
  }
}

export { NetworkMonitor }
