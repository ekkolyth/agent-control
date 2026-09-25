import { afterEach, describe, expect, test, vi } from 'vitest'
import { createQuietDetector } from './quiet'

describe('quiet detector', () => {
  afterEach(() => vi.useRealTimers())

  test('resolves true after quietMs without mutations', async () => {
    vi.useFakeTimers()
    let fire: () => void = () => {}
    const q = createQuietDetector({} as Node, {
      observe: (cb) => {
        fire = cb
        return () => {}
      },
    })
    const p = q.waitQuiet(150, 1500)
    vi.advanceTimersByTime(100)
    fire()
    vi.advanceTimersByTime(150)
    await expect(p).resolves.toBe(true)
  })

  test('resolves false at the cap under constant mutation', async () => {
    vi.useFakeTimers()
    let fire: () => void = () => {}
    const q = createQuietDetector({} as Node, {
      observe: (cb) => {
        fire = cb
        return () => {}
      },
    })
    const p = q.waitQuiet(150, 1500)
    for (let t = 0; t < 1500; t += 100) {
      vi.advanceTimersByTime(100)
      fire()
    }
    await expect(p).resolves.toBe(false)
  })
})
