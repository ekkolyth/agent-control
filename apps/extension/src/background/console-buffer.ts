import type { Cdp } from './cdp'

type ConsoleEntry = { level: string; text: string; timestamp: number }

type ConsoleApiCalledParams = {
  type: string
  args: Array<{ value?: unknown; description?: string }>
  timestamp: number
}

type ExceptionThrownParams = {
  timestamp: number
  exceptionDetails: { text: string; exception?: { description?: string } }
}

class ConsoleBuffer {
  readonly #cap: number
  readonly #entries = new Map<number, ConsoleEntry[]>()

  constructor(cap = 500) {
    this.#cap = cap
  }

  push(tabId: number, entry: ConsoleEntry): void {
    const list = this.#entries.get(tabId) ?? []
    list.push(entry)
    if (list.length > this.#cap) list.shift()
    this.#entries.set(tabId, list)
  }

  drain(tabId: number): ConsoleEntry[] {
    const list = this.#entries.get(tabId) ?? []
    this.#entries.delete(tabId)
    return list
  }

  attach(cdp: Cdp): () => void {
    return cdp.onEvent((tabId, method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const p = params as ConsoleApiCalledParams
        const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ')
        this.push(tabId, { level: p.type, text, timestamp: p.timestamp })
      } else if (method === 'Runtime.exceptionThrown') {
        const p = params as ExceptionThrownParams
        const description = p.exceptionDetails.exception?.description
        const text = description
          ? `${p.exceptionDetails.text} ${description}`
          : p.exceptionDetails.text
        this.push(tabId, { level: 'error', text, timestamp: p.timestamp })
      }
    })
  }
}

export type { ConsoleEntry }
export { ConsoleBuffer }
