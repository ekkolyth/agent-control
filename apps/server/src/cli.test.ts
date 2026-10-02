import { fileURLToPath } from 'node:url'
import type { Subprocess } from 'bun'
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

const STAYS_RUNNING_WAIT_MS = 500
const PORT_IN_USE_EXIT_CODE = 3
const serverDir = fileURLToPath(new URL('..', import.meta.url))

function spawnCli(extraArgs: string[]) {
  return Bun.spawn(
    [process.execPath, 'src/cli.ts', '--port', '0', ...extraArgs],
    {
      cwd: serverDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      env: { ...process.env, LOG_LEVEL: 'silent' },
    }
  )
}

async function waitForListening(stdout: ReadableStream<Uint8Array>) {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let seen = ''
  while (!seen.includes('agent-control server on')) {
    const { value, done } = await reader.read()
    if (done) throw new Error('server exited before listening')
    seen += decoder.decode(value)
  }
  reader.releaseLock()
}

const children: Pick<Subprocess, 'kill' | 'exited'>[] = []
// a red run times out with the child still listening; never leave it behind
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill()
    await child.exited
  }
})

describe('--exit-on-stdin-close', () => {
  test('the server exits 0 when stdin closes', async () => {
    const child = spawnCli(['--exit-on-stdin-close'])
    children.push(child)
    await waitForListening(child.stdout)
    child.stdin.end()
    expect(await child.exited).toBe(0)
  })

  test('without the flag, closing stdin leaves the server running', async () => {
    const child = spawnCli([])
    children.push(child)
    await waitForListening(child.stdout)
    child.stdin.end()
    await Bun.sleep(STAYS_RUNNING_WAIT_MS)
    expect(child.exitCode).toBeNull()
  })
})

describe('port already in use', () => {
  test('the server exits with status 3', async () => {
    const holder = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response(''),
    })
    try {
      const child = Bun.spawn(
        [process.execPath, 'src/cli.ts', '--port', String(holder.port)],
        {
          cwd: serverDir,
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
          env: { ...process.env, LOG_LEVEL: 'silent' },
        }
      )
      children.push(child)
      expect(await child.exited).toBe(PORT_IN_USE_EXIT_CODE)
    } finally {
      holder.stop(true)
    }
  })
})
