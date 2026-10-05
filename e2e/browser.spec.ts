import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Worker,
} from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(
  dirname,
  '../apps/extension/.output/chrome-mv3'
)
const SERVER_ENTRY = path.resolve(dirname, '../apps/server/src/cli.ts')

const SERVER_PORT = 9109
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`
const MCP_URL = `${SERVER_URL}/mcp`
const HTTP_OK = 200
const STOP_PROCESS_TIMEOUT_MS = 5000

type HealthResponse = {
  extension: 'connected' | 'disconnected'
  tab: { id: number; url: string; title: string } | null
}

function isPairedTab(value: unknown): value is HealthResponse['tab'] {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const tab = value as Record<string, unknown>
  return (
    typeof tab.id === 'number' &&
    typeof tab.url === 'string' &&
    typeof tab.title === 'string'
  )
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null || !('extension' in value)) {
    return false
  }
  const { extension, tab } = value as { extension: unknown; tab?: unknown }
  return (
    (extension === 'connected' || extension === 'disconnected') &&
    isPairedTab(tab)
  )
}

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${SERVER_URL}/health`)
  const body: unknown = await response.json()
  if (!isHealthResponse(body)) {
    throw new Error(`unexpected /health response: ${JSON.stringify(body)}`)
  }
  return body
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const killTimer = setTimeout(
      () => child.kill('SIGKILL'),
      STOP_PROCESS_TIMEOUT_MS
    )
    child.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractRef(text: string, label: string): string {
  const match = text.match(
    new RegExp(`${escapeRegExp(label)} \\[ref=([^\\]]+)\\]`)
  )
  const ref = match?.[1]
  if (ref === undefined) {
    throw new Error(`no ref found for ${label} in snapshot:\n${text}`)
  }
  return ref
}

type TextBlock = { type: 'text'; text: string }
type ImageBlock = { type: 'image'; data: string }

// the mcp sdk's own return type widens `content` to `unknown` because one
// branch of its result union has no `content` field, only an index
// signature — narrow it back once here instead of at every call site
function firstContentBlock(result: unknown): unknown {
  if (typeof result !== 'object' || result === null || !('content' in result)) {
    throw new Error('expected a tool result with a content array')
  }
  const content = (result as { content: unknown }).content
  if (!Array.isArray(content)) {
    throw new Error('expected a tool result with a content array')
  }
  return content[0]
}

function isTextBlock(value: unknown): value is TextBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  )
}

function isImageBlock(value: unknown): value is ImageBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'image' &&
    typeof (value as { data?: unknown }).data === 'string'
  )
}

type Fixtures = {
  serverProcess: ChildProcess
  fixtureUrl: string
  context: BrowserContext
  serviceWorker: Worker
  pairedPage: Page
  mcpClient: Client
}

const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: playwright's fixture parser requires this literal `{}` shape
  serverProcess: async ({}, use) => {
    const child = spawn(
      'bun',
      ['run', SERVER_ENTRY, '--port', String(SERVER_PORT)],
      { stdio: 'inherit' }
    )

    try {
      await expect
        .poll(
          async () => {
            try {
              return (await fetch(`${SERVER_URL}/health`)).status
            } catch {
              return null
            }
          },
          { timeout: 20_000 }
        )
        .toBe(HTTP_OK)
    } catch (error) {
      await stopProcess(child)
      throw error
    }

    await use(child)

    await stopProcess(child)
  },

  // biome-ignore lint/correctness/noEmptyPattern: playwright's fixture parser requires this literal `{}` shape
  fixtureUrl: async ({}, use) => {
    const html = readFileSync(path.join(dirname, 'fixtures/page.html'))
    const second = readFileSync(path.join(dirname, 'fixtures/second.html'))
    const server: Server = createServer((req, res) => {
      res.writeHead(HTTP_OK, { 'content-type': 'text/html' })
      res.end(req.url === '/second' ? second : html)
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('fixture server did not bind to a network address')
    }

    await use(`http://127.0.0.1:${address.port}/`)

    // the browser outlives this fixture and still holds its connection open;
    // node 22's close() waits on it, so drop it rather than hang until timeout
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  },

  // biome-ignore lint/correctness/noEmptyPattern: playwright's fixture parser requires this literal `{}` shape
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    })
    await use(context)
    await context.close()
  },

  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'))
    await use(worker)
  },

  pairedPage: async (
    { context, serviceWorker, fixtureUrl, serverProcess },
    use
  ) => {
    if (serverProcess.exitCode !== null) {
      throw new Error('server process exited before pairing could begin')
    }

    const page = await context.newPage()
    await page.goto(fixtureUrl)

    await serviceWorker.evaluate(
      async (args: { url: string; serverUrl: string }) => {
        const global = globalThis as unknown as {
          chrome: {
            storage: {
              local: { set: (items: Record<string, unknown>) => Promise<void> }
            }
            tabs: {
              query: (info: { url: string }) => Promise<Array<{ id?: number }>>
            }
          }
          __agentControl: { pair: (tabId: number) => Promise<void> }
        }
        await global.chrome.storage.local.set({
          settings: { serverUrl: args.serverUrl },
        })
        const [tab] = await global.chrome.tabs.query({ url: `${args.url}*` })
        if (tab?.id === undefined) throw new Error('fixture tab not found')
        await global.__agentControl.pair(tab.id)
      },
      {
        url: fixtureUrl,
        serverUrl: `ws://127.0.0.1:${SERVER_PORT}/ws`,
      }
    )

    await expect
      .poll(async () => (await fetchHealth()).extension, { timeout: 15_000 })
      .toBe('connected')

    // the extension pushes this; nothing has run a command yet, so a url
    // here proves the tab frame arrived rather than a response scrape
    await expect
      .poll(async () => (await fetchHealth()).tab?.url, { timeout: 5000 })
      .toBe(fixtureUrl)

    await use(page)
  },

  mcpClient: async ({ serverProcess }, use) => {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        'server process exited before the mcp client could connect'
      )
    }
    const client = new Client({ name: 'e2e', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))
    await use(client)
    await client.close()
  },
})

test('drives the real extension and server through the mcp client', async ({
  pairedPage,
  mcpClient,
  fixtureUrl,
}) => {
  const goRef =
    await test.step('browser_snapshot returns a ref for the button', async () => {
      const result = await mcpClient.callTool({
        name: 'browser_snapshot',
        arguments: {},
      })
      const first = firstContentBlock(result)
      if (!isTextBlock(first)) throw new Error('expected a text snapshot')
      expect(first.text).toContain('button "Go" [ref=')
      return extractRef(first.text, 'button "Go"')
    })

  await test.step('browser_click clicks the button', async () => {
    await mcpClient.callTool({
      name: 'browser_click',
      arguments: { element: 'Go button', ref: goRef },
    })
    await expect(pairedPage.locator('#out')).toHaveText('clicked')
  })

  const nameRef =
    await test.step('re-snapshot for the textbox ref', async () => {
      const result = await mcpClient.callTool({
        name: 'browser_snapshot',
        arguments: {},
      })
      const first = firstContentBlock(result)
      if (!isTextBlock(first)) throw new Error('expected a text snapshot')
      return extractRef(first.text, 'textbox "Name"')
    })

  await test.step('browser_type types into the textbox', async () => {
    await mcpClient.callTool({
      name: 'browser_type',
      arguments: {
        element: 'Name textbox',
        ref: nameRef,
        text: 'hello',
        submit: false,
      },
    })
    await expect(pairedPage.locator('#out')).toHaveText('hello')
  })

  const pickRef =
    await test.step('re-snapshot for the combobox ref', async () => {
      const result = await mcpClient.callTool({
        name: 'browser_snapshot',
        arguments: {},
      })
      const first = firstContentBlock(result)
      if (!isTextBlock(first)) throw new Error('expected a text snapshot')
      return extractRef(first.text, 'combobox "Pick"')
    })

  await test.step('browser_select_option selects a value', async () => {
    await mcpClient.callTool({
      name: 'browser_select_option',
      arguments: { element: 'Pick dropdown', ref: pickRef, values: ['two'] },
    })
    await expect(pairedPage.locator('select')).toHaveValue('two')
  })

  await test.step('browser_screenshot returns an image', async () => {
    const result = await mcpClient.callTool({
      name: 'browser_screenshot',
      arguments: {},
    })
    const first = firstContentBlock(result)
    if (!isImageBlock(first)) throw new Error('expected an image result')
    expect(first.data.length).toBeGreaterThan(0)
  })

  await test.step('browser_get_console_logs returns the fixture log', async () => {
    const result = await mcpClient.callTool({
      name: 'browser_get_console_logs',
      arguments: {},
    })
    const first = firstContentBlock(result)
    if (!isTextBlock(first)) throw new Error('expected text content')
    expect(first.text).toContain('e2e')
  })

  await test.step('browser_navigate lands the tab on the second fixture page', async () => {
    const secondUrl = `${fixtureUrl}second`
    const result = await mcpClient.callTool({
      name: 'browser_navigate',
      arguments: { url: secondUrl },
    })
    const first = firstContentBlock(result)
    if (!isTextBlock(first)) throw new Error('expected text content')
    expect(first.text).toContain(`- Page URL: ${secondUrl}`)
    expect(first.text).toContain('heading "Second"')
    await expect(pairedPage).toHaveURL(secondUrl)
    await expect(pairedPage.locator('h1')).toHaveText('Second')
  })
})
