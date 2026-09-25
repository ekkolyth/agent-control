import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { setLocalSettings, setSessionState } from '../settings'
import type { ConnectionOptions } from './connection'
import { createBackground } from './main'
import { Session } from './session'

function fakeConnection() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    tick: vi.fn(),
    reportTab: vi.fn(),
    state: 'disconnected' as const,
  }
}

function make() {
  const conn = fakeConnection()
  const createConnection = vi.fn((_opts: ConnectionOptions) => conn)
  const cdp = {
    ensureAttached: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
  }
  const session = new Session()
  const bg = createBackground({
    session,
    cdp: cdp as never,
    onRequest: vi.fn(),
    createConnection: createConnection as never,
    extensionVersion: '0.0.1',
    alarms: fakeBrowser.alarms,
    tabs: fakeBrowser.tabs,
  })
  return { bg, conn, createConnection, cdp, session }
}

describe('createBackground', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    await setLocalSettings({ serverUrl: 'ws://h/ws' })
  })

  test('boot restores a paired tab: connects and attaches', async () => {
    await setSessionState({ pairedTabId: 5 })
    const { bg, conn, createConnection, cdp } = make()
    await bg.boot()
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'ws://h/ws',
        extensionVersion: '0.0.1',
      })
    )
    expect(conn.start).toHaveBeenCalled()
    expect(cdp.ensureAttached).toHaveBeenCalledWith(5)
    expect(bg.status().tabId).toBe(5)
  })

  test('pairing reports the tab, and a navigation reports it again', async () => {
    await fakeBrowser.tabs.create({ url: 'https://a.example/' })
    const { bg, conn } = make()
    await bg.boot()
    await bg.pair(1)
    await vi.waitFor(() =>
      expect(conn.reportTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, url: 'https://a.example/' })
      )
    )

    await fakeBrowser.tabs.update(1, { url: 'https://b.example/' })
    await vi.waitFor(() =>
      expect(conn.reportTab).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, url: 'https://b.example/' })
      )
    )
  })

  test('an update to an unpaired tab reports nothing', async () => {
    await fakeBrowser.tabs.create({ url: 'https://a.example/' })
    await fakeBrowser.tabs.create({ url: 'https://other.example/' })
    const { bg, conn } = make()
    await bg.boot()
    await bg.pair(1)
    await vi.waitFor(() => expect(conn.reportTab).toHaveBeenCalledTimes(1))

    await fakeBrowser.tabs.update(2, { url: 'https://moved.example/' })
    await new Promise((r) => setTimeout(r, 10))
    expect(conn.reportTab).toHaveBeenCalledTimes(1)
  })

  test('boot with nothing paired creates no connection', async () => {
    const { bg, createConnection } = make()
    await bg.boot()
    expect(createConnection).not.toHaveBeenCalled()
  })

  test('registers the alarm, keepalive listener, and session listener in the synchronous boot turn', async () => {
    const { bg, session } = make()
    const create = vi.spyOn(fakeBrowser.alarms, 'create')
    const addListener = vi.spyOn(fakeBrowser.alarms.onAlarm, 'addListener')
    const onChange = vi.spyOn(session, 'onChange')
    const booted = bg.boot()
    expect(create).toHaveBeenCalled()
    expect(addListener).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
    await booted
  })

  test('pair then unpair starts and stops the connection and detaches', async () => {
    const { bg, conn, cdp } = make()
    await bg.boot()
    await bg.pair(9)
    expect(conn.start).toHaveBeenCalled()
    expect(cdp.ensureAttached).toHaveBeenCalledWith(9)
    await bg.unpair()
    expect(conn.stop).toHaveBeenCalled()
    expect(cdp.detach).toHaveBeenCalledWith(9)
    expect(bg.status().tabId).toBeNull()
  })

  test('re-pairing to a different tab detaches the previous tab', async () => {
    const { bg, cdp } = make()
    await bg.boot()
    await bg.pair(1)
    await bg.pair(2)
    await vi.waitFor(() => expect(cdp.detach).toHaveBeenCalledWith(1))
    expect(cdp.ensureAttached).toHaveBeenCalledWith(2)
  })

  test('keepalive alarm is scheduled at the 30s floor and only ticks on its own name', async () => {
    await setSessionState({ pairedTabId: 5 })
    const { bg, conn } = make()
    await bg.boot()

    expect(await fakeBrowser.alarms.getAll()).toEqual([
      expect.objectContaining({ name: 'keepalive', periodInMinutes: 0.5 }),
    ])

    fakeBrowser.alarms.onAlarm.trigger({
      name: 'some-other-alarm',
      scheduledTime: 0,
      persistAcrossSessions: false,
    })
    expect(conn.tick).not.toHaveBeenCalled()

    fakeBrowser.alarms.onAlarm.trigger({
      name: 'keepalive',
      scheduledTime: 0,
      persistAcrossSessions: false,
    })
    expect(conn.tick).toHaveBeenCalled()
  })

  test('status().state reflects the connection state', async () => {
    const { bg, createConnection } = make()
    await bg.boot()
    await bg.pair(7)
    const opts = createConnection.mock.calls[0][0]
    opts.onStateChange?.('connected')
    expect(bg.status().state).toBe('connected')
  })

  test('a failed connect settles status() into disconnected rather than sticking at connecting', async () => {
    const cdp = {
      ensureAttached: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
    }
    const createConnection = vi.fn((opts: ConnectionOptions) => ({
      start: vi.fn(() => {
        opts.onStateChange?.('connecting')
        throw new Error('bad server url')
      }),
      stop: vi.fn(),
      tick: vi.fn(),
      state: 'disconnected' as const,
    }))
    const bg = createBackground({
      session: new Session(),
      cdp: cdp as never,
      onRequest: vi.fn(),
      createConnection: createConnection as never,
      extensionVersion: '0.0.1',
      alarms: fakeBrowser.alarms,
    })
    await bg.boot()
    await bg.pair(7)
    await vi.waitFor(() => expect(bg.status().state).toBe('disconnected'))
  })

  test('closing the paired tab unpairs and detaches', async () => {
    const { bg, conn, cdp } = make()
    await bg.boot()
    await bg.pair(11)
    fakeBrowser.tabs.onRemoved.trigger(11, {
      windowId: 1,
      isWindowClosing: false,
    })
    await vi.waitFor(() => expect(cdp.detach).toHaveBeenCalledWith(11))
    expect(bg.status().tabId).toBeNull()
    expect(conn.stop).toHaveBeenCalled()
  })
})
