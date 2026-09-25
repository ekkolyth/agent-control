import type {
  PairedTab,
  RequestFrame,
  ResponseFrame,
} from '@agent-control/protocol'
import type { Status } from '../messages'
import { getLocalSettings } from '../settings'
import type { Cdp } from './cdp'
import type {
  Connection,
  ConnectionOptions,
  ConnectionState,
} from './connection'
import type { Session } from './session'

const KEEPALIVE_ALARM = 'keepalive'
const KEEPALIVE_PERIOD_MINUTES = 0.5

type BackgroundConnection = Pick<
  Connection,
  'start' | 'stop' | 'tick' | 'state' | 'reportTab'
>

type BackgroundDeps = {
  session: Session
  cdp: Cdp
  onRequest: (f: RequestFrame) => Promise<ResponseFrame>
  createConnection: (opts: ConnectionOptions) => BackgroundConnection
  extensionVersion: string
  tabs?: typeof browser.tabs
  alarms?: typeof browser.alarms
}

type Background = {
  boot(): Promise<void>
  pair(tabId: number): Promise<void>
  unpair(): Promise<void>
  status(): Status
}

function createBackground(deps: BackgroundDeps): Background {
  const { session, cdp, onRequest, createConnection, extensionVersion } = deps
  const alarms = deps.alarms ?? browser.alarms
  const tabs = deps.tabs ?? browser.tabs

  let connection: BackgroundConnection | null = null
  let state: ConnectionState = 'disconnected'
  // mirrors the connection lifecycle, not session.tabId directly: Session
  // clears its field synchronously, ahead of the persist + notify that
  // actually drives disconnect() below, so reading it live here would
  // report "unpaired" before the connection has actually stopped
  let pairedTabId: number | null = null

  async function connect(
    tabId: number,
    previous: number | null = null
  ): Promise<void> {
    pairedTabId = tabId
    const { serverUrl } = await getLocalSettings()
    connection?.stop()
    if (previous != null && previous !== tabId) {
      void cdp.detach(previous).catch(() => {})
    }
    connection = createConnection({
      url: serverUrl,
      extensionVersion,
      onRequest,
      onStateChange: (s) => {
        state = s
      },
    })
    connection.start()
    void reportTab(tabId)
    try {
      await cdp.ensureAttached(tabId)
    } catch {
      // surfaces as DEBUGGER_FAILED on the tab's first command instead
    }
  }

  async function reportTab(tabId: number): Promise<void> {
    const active = connection
    if (!active) return
    try {
      const tab = await tabs.get(tabId)
      if (connection !== active || pairedTabId !== tabId) return
      const paired: PairedTab = {
        id: tabId,
        title: tab.title ?? '',
        url: tab.url ?? '',
      }
      active.reportTab(paired)
    } catch {
      // the tab went away between pairing and this lookup; onRemoved
      // unpairs, which drops the connection and clears it server-side
    }
  }

  function disconnect(previous: number | null): void {
    connection?.stop()
    connection = null
    pairedTabId = null
    if (previous != null) cdp.detach(previous).catch(() => {})
  }

  return {
    async boot() {
      // Chrome only wakes a suspended MV3 worker for a listener that was
      // registered during this synchronous startup turn — one added after
      // an await can miss the very event it exists to catch. Register
      // everything first, so a rejected session.load() below can't take
      // any of it out with it.
      alarms.create(KEEPALIVE_ALARM, {
        periodInMinutes: KEEPALIVE_PERIOD_MINUTES,
      })
      alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === KEEPALIVE_ALARM) connection?.tick()
      })
      // the url and title change under a paired tab without anything
      // asking, and /health is what the user reads to see where it points
      tabs.onUpdated.addListener((tabId) => {
        if (tabId === pairedTabId) void reportTab(tabId)
      })
      session.onChange((tabId, previous) => {
        if (tabId != null) {
          // e.g. a bad server URL throws before ensureAttached runs, which
          // would otherwise leave status() reporting connecting forever
          void connect(tabId, previous).catch(() => {
            state = 'disconnected'
          })
        } else {
          disconnect(previous)
        }
      })
      await session.load()
      if (session.tabId != null) await connect(session.tabId)
    },

    async pair(tabId) {
      await session.pair(tabId)
    },

    async unpair() {
      await session.unpair()
    },

    status() {
      return { state, tabId: pairedTabId }
    },
  }
}

export type { Background, BackgroundConnection, BackgroundDeps }
export { createBackground }
