import { z } from 'zod'
import { httpUrlSchema } from './url'

const snapshotModeSchema = z.enum(['none', 'compact', 'full'])
export type SnapshotMode = z.infer<typeof snapshotModeSchema>

const pageStateSchema = z.object({
  url: z.string(),
  title: z.string(),
  snapshot: z.string().optional(),
  hash: z.string(),
})
export type PageState = z.infer<typeof pageStateSchema>

const consoleEntrySchema = z.object({
  level: z.string(),
  text: z.string(),
  timestamp: z.number(),
})

const withMode = z.object({ mode: snapshotModeSchema })
const ref = z.string().min(1)

const commands = {
  tabInfo: {
    request: z.object({}),
    response: z.object({ url: z.string(), title: z.string() }),
  },
  snapshot: { request: withMode, response: pageStateSchema },
  navigate: {
    request: withMode.extend({ url: httpUrlSchema }),
    response: pageStateSchema,
  },
  back: { request: withMode, response: pageStateSchema },
  forward: { request: withMode, response: pageStateSchema },
  click: { request: withMode.extend({ ref }), response: pageStateSchema },
  hover: { request: withMode.extend({ ref }), response: pageStateSchema },
  type: {
    request: withMode.extend({ ref, text: z.string(), submit: z.boolean() }),
    response: pageStateSchema,
  },
  press: {
    request: withMode.extend({ key: z.string().min(1) }),
    response: pageStateSchema,
  },
  select: {
    request: withMode.extend({ ref, values: z.array(z.string()).min(1) }),
    response: pageStateSchema,
  },
  drag: {
    request: withMode.extend({ startRef: ref, endRef: ref }),
    response: pageStateSchema,
  },
  screenshot: {
    request: z.object({}),
    response: z.object({ data: z.string() }),
  },
  consoleLogs: {
    request: z.object({}),
    response: z.object({ entries: z.array(consoleEntrySchema) }),
  },
} as const

export type CommandName = keyof typeof commands
export type CommandRequest<N extends CommandName> = z.infer<
  (typeof commands)[N]['request']
>
export type CommandResponse<N extends CommandName> = z.infer<
  (typeof commands)[N]['response']
>

const commandNameSchema = z.enum(
  Object.keys(commands) as [CommandName, ...CommandName[]]
)

export {
  commandNameSchema,
  commands,
  consoleEntrySchema,
  pageStateSchema,
  snapshotModeSchema,
}
