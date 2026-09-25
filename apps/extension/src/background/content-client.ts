import { ProtocolError } from '@agent-control/protocol'
import type { ContentRequest, ContentResponse } from '../messages'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class ContentClient {
  readonly #tabs: typeof browser.tabs
  readonly #scripting: typeof browser.scripting

  constructor(api?: {
    tabs: typeof browser.tabs
    scripting: typeof browser.scripting
  }) {
    this.#tabs = api?.tabs ?? browser.tabs
    this.#scripting = api?.scripting ?? browser.scripting
  }

  async request<T>(tabId: number, msg: ContentRequest): Promise<T> {
    let response: ContentResponse
    try {
      response = await this.#tabs.sendMessage<ContentRequest, ContentResponse>(
        tabId,
        msg
      )
    } catch (error) {
      if (!/Receiving end does not exist/.test(errorMessage(error))) {
        throw error
      }
      await this.#scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/content.js'],
      })
      try {
        response = await this.#tabs.sendMessage<
          ContentRequest,
          ContentResponse
        >(tabId, msg)
      } catch {
        throw new ProtocolError(
          'INTERNAL',
          'content script unavailable on this page'
        )
      }
    }

    if (!response.ok) {
      throw new ProtocolError(response.code, response.message)
    }
    return response.result as T
  }
}

export { ContentClient }
