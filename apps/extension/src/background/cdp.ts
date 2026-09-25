import { ProtocolError } from '@agent-control/protocol'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class Cdp {
  readonly #api: typeof browser.debugger
  readonly #attachedTabs = new Set<number>()
  #detachSubscribed = false

  constructor(opts?: { api?: typeof browser.debugger }) {
    this.#api = opts?.api ?? browser.debugger
  }

  isAttached(tabId: number): boolean {
    return this.#attachedTabs.has(tabId)
  }

  async ensureAttached(tabId: number): Promise<void> {
    if (this.#attachedTabs.has(tabId)) return

    try {
      await this.#api.attach({ tabId }, '1.3')
    } catch (error) {
      const message = errorMessage(error)
      // Chrome's real wording is "Another debugger is already attached to
      // the tab with id: <N>." — lowercase, not a prefix. This is the MV3
      // recovery path: the service worker restarted and lost #attachedTabs,
      // but Chrome's own attachment survived, so treat it as success rather
      // than a dead end. Distinct from the DevTools-open case ("an attached
      // client"), which has no "already attached" substring and still throws.
      if (!/already attached/i.test(message)) {
        throw new ProtocolError('DEBUGGER_FAILED', message)
      }
    }

    this.#subscribeDetach()
    // mark attached only once Runtime.enable actually succeeds — otherwise a
    // failed enable leaves the tab wrongly marked attached, and every later
    // call short-circuits on the `has(tabId)` check above and never retries
    await this.send(tabId, 'Runtime.enable')
    // settle reads in-flight requests off these events to tell a page that
    // is still fetching from one that has merely gone quiet for a moment
    await this.send(tabId, 'Network.enable')
    this.#attachedTabs.add(tabId)
  }

  #subscribeDetach(): void {
    if (this.#detachSubscribed) return
    this.#detachSubscribed = true
    this.#api.onDetach.addListener((source) => {
      if (source.tabId !== undefined) this.#attachedTabs.delete(source.tabId)
    })
  }

  async detach(tabId: number): Promise<void> {
    this.#attachedTabs.delete(tabId)
    try {
      await this.#api.detach({ tabId })
    } catch (error) {
      throw new ProtocolError('DEBUGGER_FAILED', errorMessage(error))
    }
  }

  async send(
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    try {
      return await this.#api.sendCommand({ tabId }, method, params)
    } catch (error) {
      throw new ProtocolError('DEBUGGER_FAILED', errorMessage(error))
    }
  }

  onEvent(
    fn: (tabId: number, method: string, params: unknown) => void
  ): () => void {
    const listener = (
      source: { tabId?: number },
      method: string,
      params?: object
    ) => {
      if (source.tabId !== undefined) fn(source.tabId, method, params)
    }
    this.#api.onEvent.addListener(listener)
    return () => this.#api.onEvent.removeListener(listener)
  }
}

export { Cdp }
