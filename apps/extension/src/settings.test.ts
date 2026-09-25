import { beforeEach, describe, expect, test } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  getLocalSettings,
  getSessionState,
  setLocalSettings,
  setSessionState,
} from './settings'

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset())

  test('local defaults and patch', async () => {
    expect(await getLocalSettings()).toEqual({
      serverUrl: 'ws://127.0.0.1:3660/ws',
    })
    await setLocalSettings({ serverUrl: 'ws://h/ws' })
    expect(await getLocalSettings()).toEqual({ serverUrl: 'ws://h/ws' })
  })

  test('session defaults and patch', async () => {
    expect(await getSessionState()).toEqual({ pairedTabId: null })
    await setSessionState({ pairedTabId: 7 })
    expect(await getSessionState()).toEqual({ pairedTabId: 7 })
  })

  test('local and session storage are separate areas', async () => {
    await setLocalSettings({ serverUrl: 'ws://local-only/ws' })
    await setSessionState({ pairedTabId: 3 })

    const rawLocal = await fakeBrowser.storage.local.get(null)
    const rawSession = await fakeBrowser.storage.session.get(null)

    expect(rawLocal).toEqual({
      settings: { serverUrl: 'ws://local-only/ws' },
    })
    expect(rawSession).toEqual({ session: { pairedTabId: 3 } })
  })

  test('corrupt stored settings fall back to defaults', async () => {
    await fakeBrowser.storage.local.set({ settings: { serverUrl: 42 } })
    expect(await getLocalSettings()).toEqual({
      serverUrl: 'ws://127.0.0.1:3660/ws',
    })
  })

  test('corrupt stored session falls back to defaults', async () => {
    await fakeBrowser.storage.session.set({
      session: { pairedTabId: 'seven' },
    })
    expect(await getSessionState()).toEqual({ pairedTabId: null })
  })
})
