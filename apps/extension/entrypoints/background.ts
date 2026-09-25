import { Cdp } from '../src/background/cdp'
import { createCommandHandlers, dispatch } from '../src/background/commands'
import { Connection } from '../src/background/connection'
import { ConsoleBuffer } from '../src/background/console-buffer'
import { ContentClient } from '../src/background/content-client'
import type { Background } from '../src/background/main'
import { createBackground } from '../src/background/main'
import { NavigationTracker } from '../src/background/navigation'
import { NetworkMonitor } from '../src/background/network'
import { Session } from '../src/background/session'
import type { BackgroundMessage } from '../src/messages'

export default defineBackground(() => {
  const session = new Session()
  const cdp = new Cdp()
  const content = new ContentClient()
  const nav = new NavigationTracker()
  const consoleBuffer = new ConsoleBuffer()
  consoleBuffer.attach(cdp)
  const network = new NetworkMonitor()
  network.attach(cdp)

  const handlers = createCommandHandlers({
    session,
    cdp,
    content,
    nav,
    network,
    consoleBuffer,
    tabs: browser.tabs,
  })

  const bg = createBackground({
    session,
    cdp,
    onRequest: (f) => dispatch(handlers, f),
    createConnection: (o) => new Connection(o),
    extensionVersion: browser.runtime.getManifest().version,
  })

  ;(
    globalThis as typeof globalThis & { __agentControl: Background }
  ).__agentControl = bg

  browser.runtime.onMessage.addListener(
    (message: BackgroundMessage, _sender, sendResponse) => {
      if (message.kind === 'pair') {
        void bg.pair(message.tabId).then(() => sendResponse(undefined))
      } else if (message.kind === 'unpair') {
        void bg.unpair().then(() => sendResponse(undefined))
      } else if (message.kind === 'status') {
        sendResponse(bg.status())
      }
      return true
    }
  )

  void bg.boot()
})
