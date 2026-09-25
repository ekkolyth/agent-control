import { browser } from 'wxt/browser'
import { z } from 'zod'

const localSettingsSchema = z.object({
  serverUrl: z.string(),
})

const sessionStateSchema = z.object({
  pairedTabId: z.number().nullable(),
})

type LocalSettings = z.infer<typeof localSettingsSchema>
type SessionState = z.infer<typeof sessionStateSchema>

type StoredSettings = { settings?: LocalSettings }
type StoredSession = { session?: SessionState }

const defaultLocalSettings: LocalSettings = {
  serverUrl: 'ws://127.0.0.1:3660/ws',
}

const defaultSessionState: SessionState = {
  pairedTabId: null,
}

async function getLocalSettings(): Promise<LocalSettings> {
  const { settings } =
    await browser.storage.local.get<StoredSettings>('settings')
  const parsed = localSettingsSchema.safeParse(settings)
  return parsed.success ? parsed.data : defaultLocalSettings
}

async function setLocalSettings(patch: Partial<LocalSettings>): Promise<void> {
  const current = await getLocalSettings()
  await browser.storage.local.set<StoredSettings>({
    settings: { ...current, ...patch },
  })
}

async function getSessionState(): Promise<SessionState> {
  const { session } =
    await browser.storage.session.get<StoredSession>('session')
  const parsed = sessionStateSchema.safeParse(session)
  return parsed.success ? parsed.data : defaultSessionState
}

async function setSessionState(patch: Partial<SessionState>): Promise<void> {
  const current = await getSessionState()
  await browser.storage.session.set<StoredSession>({
    session: { ...current, ...patch },
  })
}

export type { LocalSettings, SessionState }
export { getLocalSettings, getSessionState, setLocalSettings, setSessionState }
