import { z } from 'zod'
import { commandNameSchema } from './commands'
import { protocolErrorSchema } from './errors'

const requestFrameSchema = z.strictObject({
  id: z.string(),
  type: commandNameSchema,
  payload: z.unknown(),
})
export type RequestFrame = z.infer<typeof requestFrameSchema>

const responseFrameSchema = z.discriminatedUnion('ok', [
  z.strictObject({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.strictObject({
    id: z.string(),
    ok: z.literal(false),
    error: protocolErrorSchema,
  }),
])
export type ResponseFrame = z.infer<typeof responseFrameSchema>

const pingFrameSchema = z.strictObject({ type: z.literal('ping') })
const pongFrameSchema = z.strictObject({ type: z.literal('pong') })

const helloFrameSchema = z.strictObject({
  type: z.literal('hello'),
  extensionVersion: z.string(),
})
export type HelloFrame = z.infer<typeof helloFrameSchema>

const pairedTabSchema = z.strictObject({
  id: z.number(),
  url: z.string(),
  title: z.string(),
})
export type PairedTab = z.infer<typeof pairedTabSchema>

const healthResponseSchema = z.strictObject({
  extension: z.enum(['connected', 'disconnected']),
  tab: pairedTabSchema.nullable(),
  uptime: z.number(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

// pushed, not requested: only the extension knows which tab is paired, and
// the url and title change under it without the server asking anything
const tabFrameSchema = z.strictObject({
  type: z.literal('tab'),
  tab: pairedTabSchema.nullable(),
})
export type TabFrame = z.infer<typeof tabFrameSchema>

const serverFrameSchema = z.union([
  requestFrameSchema,
  pingFrameSchema,
  pongFrameSchema,
])
export type ServerFrame = z.infer<typeof serverFrameSchema>

const extensionFrameSchema = z.union([
  responseFrameSchema,
  pingFrameSchema,
  pongFrameSchema,
  helloFrameSchema,
  tabFrameSchema,
])
export type ExtensionFrame = z.infer<typeof extensionFrameSchema>

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseServerFrame(text: string): ServerFrame | null {
  const result = serverFrameSchema.safeParse(safeJson(text))
  return result.success ? result.data : null
}

function parseExtensionFrame(text: string): ExtensionFrame | null {
  const result = extensionFrameSchema.safeParse(safeJson(text))
  return result.success ? result.data : null
}

export {
  extensionFrameSchema,
  healthResponseSchema,
  helloFrameSchema,
  pairedTabSchema,
  parseExtensionFrame,
  parseServerFrame,
  pingFrameSchema,
  pongFrameSchema,
  requestFrameSchema,
  responseFrameSchema,
  serverFrameSchema,
  tabFrameSchema,
}
