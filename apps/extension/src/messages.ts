import type { ErrorCode } from '@agent-control/protocol'
import { snapshotModeSchema } from '@agent-control/protocol'
import { z } from 'zod'

const contentRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot'), mode: snapshotModeSchema }),
  z.object({ kind: z.literal('resolveRef'), ref: z.string() }),
  z.object({
    kind: z.literal('waitQuiet'),
    quietMs: z.number(),
    capMs: z.number(),
  }),
  z.object({ kind: z.literal('clearValue'), ref: z.string() }),
  z.object({
    kind: z.literal('selectOptions'),
    ref: z.string(),
    values: z.array(z.string()),
  }),
])
type ContentRequest = z.infer<typeof contentRequestSchema>

type ContentResponse =
  | { ok: true; result: unknown }
  | { ok: false; code: ErrorCode; message: string }

type BackgroundMessage =
  | { kind: 'pair'; tabId: number }
  | { kind: 'unpair' }
  | { kind: 'status' }

const statusSchema = z.object({
  state: z.enum(['disconnected', 'connecting', 'connected']),
  tabId: z.number().nullable(),
})
type Status = z.infer<typeof statusSchema>

export type { BackgroundMessage, ContentRequest, ContentResponse, Status }
export { contentRequestSchema, statusSchema }
