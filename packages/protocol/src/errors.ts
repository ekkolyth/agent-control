import { z } from 'zod'

const errorCodeSchema = z.enum([
  'NO_TAB',
  'STALE_REF',
  'REF_NOT_FOUND',
  'DEBUGGER_FAILED',
  'TIMEOUT',
  'NAVIGATION_FAILED',
  'DISCONNECTED',
  'INTERNAL',
])
export type ErrorCode = z.infer<typeof errorCodeSchema>

const protocolErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
})

class ProtocolError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

export { errorCodeSchema, ProtocolError, protocolErrorSchema }
