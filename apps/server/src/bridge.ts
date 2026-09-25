import {
  type CommandName,
  type CommandRequest,
  type CommandResponse,
  commands,
  extensionFrameSchema,
  helloFrameSchema,
  type PairedTab,
  ProtocolError,
  parseExtensionFrame,
  pingFrameSchema,
  pongFrameSchema,
  type RequestFrame,
  type ResponseFrame,
  requestFrameSchema,
  responseFrameSchema,
  tabFrameSchema,
} from '@agent-control/protocol'
import type { z } from 'zod'
import { createLogger, type Logger, scope } from './log'

const MAX_LOGGED_ZOD_PATHS = 6
const MAX_ZOD_UNION_DEPTH = 3

// only key names our own wire schemas define are ever logged; a
// client-chosen key is frame content exactly like a client-chosen value, so
// anything outside this set is counted rather than named
const KNOWN_FRAME_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(requestFrameSchema.shape),
  ...responseFrameSchema.options.flatMap((option) => Object.keys(option.shape)),
  ...Object.keys(pingFrameSchema.shape),
  ...Object.keys(pongFrameSchema.shape),
  ...Object.keys(helloFrameSchema.shape),
  ...Object.keys(tabFrameSchema.shape),
])

function describeKeys(objectKeys: readonly string[]): {
  keys: string[] | undefined
  unknownKeyCount: number | undefined
} {
  const known = objectKeys.filter((key) => KNOWN_FRAME_KEYS.has(key))
  const unknownCount = objectKeys.length - known.length
  return {
    keys: known.length > 0 ? known : undefined,
    unknownKeyCount: unknownCount > 0 ? unknownCount : undefined,
  }
}

// walks into invalid_union branches for a path that actually names the field
// zod tripped on (e.g. "extensionVersion"); a top-level union failure alone only
// reports code "invalid_union" with an empty path
function collectZodPaths(
  issues: readonly z.core.$ZodIssue[],
  depth: number,
  paths: Set<string>
): void {
  for (const issue of issues) {
    if (paths.size >= MAX_LOGGED_ZOD_PATHS) return
    if (issue.path.length > 0) paths.add(issue.path.map(String).join('.'))
    if (depth > 0 && issue.code === 'invalid_union') {
      for (const branch of issue.errors)
        collectZodPaths(branch, depth - 1, paths)
    }
  }
}

// identifies a drifted or malformed frame without reproducing any of its
// content: byte length, schema-known key names present, a count of
// whatever else, and where zod tripped. A client-controlled value a drifted
// or hostile frame carries must never appear in a log line, and path-based
// redaction on a literal key name cannot protect against a frame that
// renames, nests, or arrays that value away from the keys it lists. A
// renamed key still shows up as an unknown-key count plus the zod path
// naming the field that went missing.
function frameForLog(text: string): Record<string, unknown> {
  const byteLength = Buffer.byteLength(text, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { byteLength }
  }
  const { keys, unknownKeyCount } =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? describeKeys(Object.keys(parsed))
      : { keys: undefined, unknownKeyCount: undefined }
  const result = extensionFrameSchema.safeParse(parsed)
  if (result.success) return { byteLength, keys, unknownKeyCount }
  const zodPaths = new Set<string>()
  collectZodPaths(result.error.issues, MAX_ZOD_UNION_DEPTH, zodPaths)
  return {
    byteLength,
    keys,
    unknownKeyCount,
    zodPaths: zodPaths.size > 0 ? [...zodPaths] : undefined,
  }
}

type BridgeSocket = {
  send(data: string): void
  close(code?: number, reason?: string): void
}

type BridgeState = 'disconnected' | 'connected'

type BridgeOptions = {
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  reconnectGraceMs?: number
  defaultTimeoutMs?: number
  logger?: Logger
}

type BridgeHandle = {
  message(text: string): void
  closed(): void
}

type BridgeEvent = 'connected' | 'disconnected'

type Pending = {
  name: CommandName
  resolve: (value: unknown) => void
  reject: (error: ProtocolError) => void
  timer: ReturnType<typeof setTimeout>
}

type Heartbeat = {
  interval: ReturnType<typeof setInterval>
  timeout: ReturnType<typeof setTimeout> | null
}

function hasPageFields(
  value: unknown
): value is { url: string; title: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).url === 'string' &&
    typeof (value as Record<string, unknown>).title === 'string'
  )
}

class Bridge {
  readonly #defaultTimeoutMs: number
  readonly #heartbeatIntervalMs: number
  readonly #heartbeatTimeoutMs: number
  readonly #reconnectGraceMs: number
  readonly #log: Logger
  #current: BridgeSocket | null = null
  #heartbeat: Heartbeat | null = null
  // once true, stays true — distinguishes a send with nothing ever paired
  // (NO_TAB, the agent needs to pair a tab) from one that raced a drop
  // (DISCONNECTED, the action may have landed)
  #everConnected = false
  #extensionVersion: string | null = null
  #tab: PairedTab | null = null
  readonly #pending = new Map<string, Pending>()
  readonly #listeners: Record<BridgeEvent, Set<() => void>> = {
    connected: new Set(),
    disconnected: new Set(),
  }

  constructor(opts: BridgeOptions) {
    this.#defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000
    this.#heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 20_000
    this.#heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 5_000
    this.#reconnectGraceMs = opts.reconnectGraceMs ?? 3_000
    this.#log = scope(
      opts.logger ?? createLogger({ service: 'agent-control-server' }),
      'bridge'
    )
  }

  get state(): BridgeState {
    return this.#current ? 'connected' : 'disconnected'
  }

  get extensionVersion(): string | null {
    return this.#extensionVersion
  }

  get tab(): PairedTab | null {
    return this.#tab
  }

  accept(socket: BridgeSocket): BridgeHandle {
    let promoted = false
    let rejected = false

    return {
      message: (text) => {
        if (rejected) return
        if (!promoted) {
          const frame = parseExtensionFrame(text)
          if (frame && 'type' in frame && frame.type === 'hello') {
            promoted = true
            this.#promote(socket, frame.extensionVersion)
            return
          }
          rejected = true
          this.#log.info(frameForLog(text), 'handshake rejected')
          try {
            socket.close(4001, 'unauthorized')
          } catch {
            // never promoted, so there is no connection state to reap
            // if the socket is already gone
          }
          return
        }
        if (socket !== this.#current) return
        this.#handleFrame(socket, text)
      },
      closed: () => {
        if (!promoted || socket !== this.#current) return
        this.#disconnect()
      },
    }
  }

  async send<N extends CommandName>(
    name: N,
    payload: CommandRequest<N>,
    opts?: { timeoutMs?: number }
  ): Promise<CommandResponse<N>> {
    if (!this.#current) {
      const reconnected = await this.#waitForConnected(this.#reconnectGraceMs)
      if (!reconnected) {
        throw this.#everConnected
          ? new ProtocolError('DISCONNECTED', 'extension not connected')
          : new ProtocolError('NO_TAB', 'no extension has ever connected')
      }
    }
    const socket = this.#current
    if (!socket) {
      throw new ProtocolError('DISCONNECTED', 'extension not connected')
    }

    const id = crypto.randomUUID()
    const frame: RequestFrame = { id, type: name, payload }

    return new Promise((resolve, reject) => {
      const timeoutMs = opts?.timeoutMs ?? this.#defaultTimeoutMs
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new ProtocolError('TIMEOUT', `timed out waiting for ${name}`))
      }, timeoutMs)
      this.#pending.set(id, {
        name,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      try {
        socket.send(JSON.stringify(frame))
      } catch {
        this.#pending.delete(id)
        clearTimeout(timer)
        reject(new ProtocolError('DISCONNECTED', 'failed to send to extension'))
      }
    })
  }

  on(event: BridgeEvent, fn: () => void): () => void {
    this.#listeners[event].add(fn)
    return () => this.#listeners[event].delete(fn)
  }

  close(): void {
    if (!this.#current) return
    try {
      this.#current.close()
    } catch {
      // the socket may already be gone; the disconnect below must still
      // run to clear state and reject in-flight requests
    }
    this.#disconnect()
  }

  #handleFrame(socket: BridgeSocket, text: string): void {
    const frame = parseExtensionFrame(text)
    if (!frame) {
      this.#log.warn(frameForLog(text), 'malformed extension frame')
      return
    }
    if ('ok' in frame) {
      this.#handleResponse(frame)
      return
    }
    if (frame.type === 'ping') {
      try {
        socket.send('{"type":"pong"}')
      } catch {
        // the socket is broken in the send direction; the next
        // heartbeat cycle reaps it the same as any other dead socket
      }
      return
    }
    if (frame.type === 'pong') {
      this.#clearHeartbeatTimeout()
      return
    }
    if (frame.type === 'tab') {
      this.#tab = frame.tab
      return
    }
    // a stray hello needs no reply
  }

  #handleResponse(frame: ResponseFrame): void {
    const pending = this.#pending.get(frame.id)
    if (!pending) return
    this.#pending.delete(frame.id)
    clearTimeout(pending.timer)

    if (!frame.ok) {
      pending.reject(new ProtocolError(frame.error.code, frame.error.message))
      return
    }

    const parsed = commands[pending.name].response.safeParse(frame.result)
    if (!parsed.success) {
      pending.reject(
        new ProtocolError('INTERNAL', `malformed response for ${pending.name}`)
      )
      return
    }
    if (hasPageFields(parsed.data) && this.#tab) {
      this.#tab = {
        ...this.#tab,
        title: parsed.data.title,
        url: parsed.data.url,
      }
    }
    pending.resolve(parsed.data)
  }

  #disconnect(): void {
    this.#stopHeartbeat()
    this.#current = null
    this.#tab = null
    this.#log.info(
      { extension_version: this.#extensionVersion },
      'extension disconnected'
    )
    const error = new ProtocolError(
      'DISCONNECTED',
      'connection to the extension dropped'
    )
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
    this.#emit('disconnected')
  }

  #promote(socket: BridgeSocket, extensionVersion: string): void {
    if (this.#current) {
      const previous = this.#current
      try {
        previous.close(4000, 'replaced')
      } catch {
        // the outgoing socket is exactly the one that has already gone —
        // laptop sleep, extension reload — and newest-hello-wins must still
        // promote the new one regardless
      }
      this.#disconnect()
    }
    this.#extensionVersion = extensionVersion
    this.#current = socket
    this.#everConnected = true
    this.#startHeartbeat(socket)
    this.#log.info(
      { extension_version: extensionVersion },
      'extension connected'
    )
    this.#emit('connected')
  }

  #startHeartbeat(socket: BridgeSocket): void {
    // referenced by the closure below instead of `this.#heartbeat` so a
    // stopped cycle's own interval (already cleared) is what stands between
    // this callback and `this.#current`, not a null check on a field that
    // is only ever null when this very interval has already been cleared
    const heartbeat: Heartbeat = {
      interval: setInterval(() => {
        try {
          socket.send('{"type":"ping"}')
        } catch {
          this.#onHeartbeatTimeout(socket)
          return
        }
        if (heartbeat.timeout) clearTimeout(heartbeat.timeout)
        heartbeat.timeout = setTimeout(
          () => this.#onHeartbeatTimeout(socket),
          this.#heartbeatTimeoutMs
        )
      }, this.#heartbeatIntervalMs),
      timeout: null,
    }
    this.#heartbeat = heartbeat
  }

  #stopHeartbeat(): void {
    if (!this.#heartbeat) return
    clearInterval(this.#heartbeat.interval)
    if (this.#heartbeat.timeout) clearTimeout(this.#heartbeat.timeout)
    this.#heartbeat = null
  }

  #clearHeartbeatTimeout(): void {
    if (!this.#heartbeat?.timeout) return
    clearTimeout(this.#heartbeat.timeout)
    this.#heartbeat.timeout = null
  }

  #onHeartbeatTimeout(socket: BridgeSocket): void {
    if (socket !== this.#current) return
    try {
      socket.close(4002, 'heartbeat timeout')
    } catch {
      // the ping that got us here may already have failed to send, so
      // the socket can be dead in both directions — the reap below must
      // still run to clear state and stop the interval
    }
    this.#disconnect()
  }

  #waitForConnected(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>
      const off = this.on('connected', () => {
        clearTimeout(timer)
        off()
        resolve(true)
      })
      timer = setTimeout(() => {
        off()
        resolve(false)
      }, timeoutMs)
    })
  }

  #emit(event: BridgeEvent): void {
    for (const fn of this.#listeners[event]) {
      try {
        fn()
      } catch (error) {
        // a listener's own defect must never take down the socket handler
        this.#log.error({ error }, 'listener threw')
      }
    }
  }
}

export type { BridgeHandle, BridgeOptions, BridgeSocket, BridgeState }
export { Bridge }
