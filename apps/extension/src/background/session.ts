import { ProtocolError } from '@agent-control/protocol'
import { getSessionState, setSessionState } from '../settings'

type ChangeListener = (tabId: number | null, previous: number | null) => void

class Session {
  readonly #tabs: typeof browser.tabs
  #tabId: number | null = null
  readonly #listeners = new Set<ChangeListener>()

  constructor(opts?: { tabs?: typeof browser.tabs }) {
    this.#tabs = opts?.tabs ?? browser.tabs
    this.#tabs.onRemoved.addListener((tabId) => {
      if (tabId === this.#tabId) void this.unpair()
    })
  }

  get tabId(): number | null {
    return this.#tabId
  }

  async load(): Promise<void> {
    const state = await getSessionState()
    this.#tabId = state.pairedTabId
  }

  async pair(tabId: number): Promise<void> {
    const previous = this.#tabId
    this.#tabId = tabId
    await setSessionState({ pairedTabId: tabId })
    this.#notify(tabId, previous)
  }

  async unpair(): Promise<void> {
    const previous = this.#tabId
    this.#tabId = null
    await setSessionState({ pairedTabId: null })
    this.#notify(null, previous)
  }

  requireTab(): number {
    if (this.#tabId == null) {
      throw new ProtocolError('NO_TAB', 'No tab is paired')
    }
    return this.#tabId
  }

  onChange(fn: ChangeListener): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #notify(tabId: number | null, previous: number | null): void {
    for (const fn of this.#listeners) fn(tabId, previous)
  }
}

export { Session }
