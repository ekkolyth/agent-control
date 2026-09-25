import { afterEach, describe, expect, test, vi } from 'vitest'

describe('module import', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('importing cli.ts does not start the server', async () => {
    const serveSpy = vi
      .spyOn(Bun, 'serve')
      .mockImplementation(
        () => ({ stop: () => {}, port: 3660 }) as ReturnType<typeof Bun.serve>
      )

    vi.resetModules()
    await import('./cli')

    expect(serveSpy).not.toHaveBeenCalled()
  })
})
