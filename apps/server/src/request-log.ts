import type { MiddlewareHandler } from 'hono'
import { type Logger, scope } from './log'

const SLOW_REQUEST_MS = 1000
const SUCCESS_SAMPLE_RATE = 0.1

type RequestLogLevel = 'error' | 'warn' | 'info'

type RequestLogDecision =
  | { log: false }
  | { log: true; level: RequestLogLevel; sampleRate?: number }

function classifyRequest(
  status: number,
  durationMs: number,
  random: () => number
): RequestLogDecision {
  if (status >= 500) return { log: true, level: 'error' }
  if (status >= 400) return { log: true, level: 'warn' }
  if (durationMs > SLOW_REQUEST_MS) return { log: true, level: 'warn' }
  if (random() < SUCCESS_SAMPLE_RATE) {
    return { log: true, level: 'info', sampleRate: SUCCESS_SAMPLE_RATE }
  }
  return { log: false }
}

function createRequestLogger(logger: Logger): MiddlewareHandler {
  const log = scope(logger, 'http')

  return async (c, next) => {
    if (c.req.path === '/ws') {
      await next()
      return
    }

    const start = Date.now()
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID()
    c.header('X-Request-Id', requestId)

    try {
      await next()
    } catch (error) {
      log.error(
        {
          method: c.req.method,
          path: c.req.path,
          host: c.req.header('host'),
          status: 500,
          duration_ms: Date.now() - start,
          request_id: requestId,
          error,
        },
        'request completed'
      )
      throw error
    }

    const durationMs = Date.now() - start
    const status = c.res.status
    const decision = classifyRequest(status, durationMs, Math.random)
    if (!decision.log) return

    const attrs: Record<string, unknown> = {
      method: c.req.method,
      path: c.req.path,
      host: c.req.header('host'),
      status,
      duration_ms: durationMs,
      request_id: requestId,
    }
    if (decision.sampleRate !== undefined)
      attrs.sample_rate = decision.sampleRate
    // Hono's own onError already turns a thrown handler error into a
    // response before next() resolves, stashing the original on c.error
    if (c.error) attrs.error = c.error
    log[decision.level](attrs, 'request completed')
  }
}

export { createRequestLogger }
