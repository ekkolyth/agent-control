import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { BackgroundMessage, Status } from '../messages'
import { statusSchema } from '../messages'
import { setLocalSettings } from '../settings'

const STATUS_POLL_MS = 1000

const initialStatus: Status = { state: 'disconnected', tabId: null }

type Connection = {
  connect: (serverUrl: string) => Promise<void>
  disconnect: () => Promise<void>
  status: Status
  tabTitle: string | null
}

async function send(message: BackgroundMessage): Promise<unknown> {
  return browser.runtime.sendMessage(message)
}

async function readTabTitle(tabId: number | null): Promise<string | null> {
  if (tabId == null) return null
  try {
    const tab = await browser.tabs.get(tabId)
    return tab.title ?? null
  } catch {
    // tab closed between the status read and this lookup
    return null
  }
}

function useConnection(): Connection {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [tabTitle, setTabTitle] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const parsed = statusSchema.safeParse(await send({ kind: 'status' }))
    if (!parsed.success) {
      console.error('failed to parse status', parsed.error)
      return
    }
    setStatus(parsed.data)
    setTabTitle(await readTabTitle(parsed.data.tabId))
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const connect = useCallback(
    async (serverUrl: string) => {
      await setLocalSettings({ serverUrl })
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (tab?.id != null) await send({ kind: 'pair', tabId: tab.id })
      await refresh()
    },
    [refresh]
  )

  const disconnect = useCallback(async () => {
    await send({ kind: 'unpair' })
    await refresh()
  }, [refresh])

  return { connect, disconnect, status, tabTitle }
}

export type { Connection }
export { useConnection }
