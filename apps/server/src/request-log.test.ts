import { Hono } from 'hono'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { captureDestination, parseLogLines } from '../tests/log-capture'
import { createLogger } from './log'
import { createRequestLogger } from './request-log'

function buildApp(logger: ReturnType<typeof createLogger>) {
  const app = new Hono()
  app.use('*', createRequestLogger(logger))
  app.get('/ok', (c) => c.json({ ok: true }))
  app.get('/missing', (c) => c.json({ error: 'nope' }, 404))
  app.get('/broken', (c) => c.json({ error: 'boom' }, 500))
  app.get('/slow', async (c) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    return c.json({ ok: true })
  })
  app.get('/throws', () => {
    throw new Error('kaboom')
  })
  app.get('/ws', (c) => c.json({ error: 'should never be reached' }, 500))
  return app
}

describe('createRequestLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('4xx is always logged at warn', async () => {
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    const res = await app.request('/missing')

    expect(res.status).toBe(404)
    const [line] = parseLogLines(destination.lines)
    expect(line).toMatchObject({
      level: 40,
      method: 'GET',
      path: '/missing',
      status: 404,
      msg: 'request completed',
    })
    expect(typeof line?.duration_ms).toBe('number')
    expect(typeof line?.request_id).toBe('string')
  })

  test('5xx is always logged at error', async () => {
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    const res = await app.request('/broken')

    expect(res.status).toBe(500)
    const [line] = parseLogLines(destination.lines)
    expect(line).toMatchObject({ level: 50, status: 500 })
  })

  test('a thrown handler error is logged at error, carrying the error', async () => {
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    // Hono's own onError converts the throw into a 500 before next()
    // resolves, so this never reaches request-log's own catch branch —
    // it comes back through c.error on the normal completion path.
    const res = await app.request('/throws')

    expect(res.status).toBe(500)
    const [line] = parseLogLines(destination.lines)
    expect(line).toMatchObject({ level: 50, path: '/throws' })
    expect(line?.error).toBeDefined()
  })

  test('slow success (over the threshold) is always logged at warn', async () => {
    vi.useFakeTimers()
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    const pending = app.request('/slow')
    await vi.advanceTimersByTimeAsync(1500)
    const res = await pending

    expect(res.status).toBe(200)
    const [line] = parseLogLines(destination.lines)
    expect(line).toMatchObject({ level: 40, path: '/slow' })
    expect(Number(line?.duration_ms)).toBeGreaterThan(1000)
  })

  test('fast success is sampled: logged when the sample hits', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    const res = await app.request('/ok')

    expect(res.status).toBe(200)
    const [line] = parseLogLines(destination.lines)
    expect(line).toMatchObject({
      level: 30,
      status: 200,
      sample_rate: 0.1,
    })
  })

  test('fast success is sampled: not logged when the sample misses', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    const res = await app.request('/ok')

    expect(res.status).toBe(200)
    expect(destination.lines).toHaveLength(0)
  })

  test('an inbound X-Request-Id is echoed on the response and reused in the log line', async () => {
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    const res = await app.request('/missing', {
      headers: { 'X-Request-Id': 'client-supplied-id' },
    })

    expect(res.headers.get('X-Request-Id')).toBe('client-supplied-id')
    const [line] = parseLogLines(destination.lines)
    expect(line?.request_id).toBe('client-supplied-id')
  })

  test('a missing X-Request-Id is generated and echoed on the response', async () => {
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    const res = await app.request('/missing')

    const echoed = res.headers.get('X-Request-Id')
    expect(typeof echoed).toBe('string')
    expect(echoed?.length).toBeGreaterThan(0)
    const [line] = parseLogLines(destination.lines)
    expect(line?.request_id).toBe(echoed)
  })

  test('the /ws upgrade path is never logged, even on a 5xx', async () => {
    const destination = captureDestination()
    const logger = createLogger({ service: 'test', destination })
    const app = buildApp(logger)

    await app.request('/ws')

    expect(destination.lines).toHaveLength(0)
  })
})
