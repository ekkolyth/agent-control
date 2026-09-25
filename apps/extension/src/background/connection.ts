import {
  type HelloFrame,
  type PairedTab,
  ProtocolError,
  parseServerFrame,
  type RequestFrame,
  type ResponseFrame,
  type TabFrame,
} from '@agent-control/protocol'

type SocketLike = {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((e: unknown) => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onclose: ((e: unknown) => void) | null
  onerror: ((e: unknown) => void) | null
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected'

type ConnectionOptions = {
  url: string
  extensionVersion: string
  onRequest: (req: RequestFrame) => Promise<ResponseFrame>
  onStateChange?: (s: ConnectionState) => void
  createSocket?: (url: string) => SocketLike
  pingIntervalMs?: number
  pongTimeoutMs?: number
  backoffMs?: number[]
  backoffCapMs?: number
  random?: () => number
}

const DEFAULT_PING_INTERVAL_MS = 20_000
const DEFAULT_PONG_TIMEOUT_MS = 5_000
const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 4000]
const DEFAULT_BACKOFF_CAP_MS = 5000
const WEBSOCKET_OPEN = 1
// bridge.ts closes with this when the first frame was not a valid hello
const UNAUTHORIZED_CLOSE_CODE = 4001

function closeCode(event: unknown): number | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const { code } = event as { code?: unknown }
  return typeof code === 'number' ? code : undefined
}

class Connection {
  readonly #url: string
  readonly #extensionVersion: string
  readonly #onRequest: (req: RequestFrame) => Promise<ResponseFrame>
  readonly #onStateChange: ((s: ConnectionState) => void) | undefined
  readonly #createSocket: (url: string) => SocketLike
  readonly #pingIntervalMs: number
  readonly #pongTimeoutMs: number
  readonly #backoffMs: number[]
  readonly #backoffCapMs: number
  readonly #random: () => number

  #socket: SocketLike | null = null
  #tab: PairedTab | null = null
  #state: ConnectionState = 'disconnected'
  #started = false
  #attempt = 0
  #pingTimer: ReturnType<typeof setInterval> | null = null
  #pongTimer: ReturnType<typeof setTimeout> | null = null
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: ConnectionOptions) {
    this.#url = opts.url
    this.#extensionVersion = opts.extensionVersion
    this.#onRequest = opts.onRequest
    this.#onStateChange = opts.onStateChange
    this.#createSocket =
      opts.createSocket ??
      ((url) => new WebSocket(url) as unknown as SocketLike)
    this.#pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS
    this.#pongTimeoutMs = opts.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS
    this.#backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS
    this.#backoffCapMs = opts.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS
    this.#random = opts.random ?? Math.random
  }

  get state(): ConnectionState {
    return this.#state
  }

  start(): void {
    this.#started = true
    this.#connect()
  }

  // held rather than fired and forgotten: the server drops what it knows
  // about the tab whenever the socket dies, so every reconnect has to say
  // it again
  reportTab(tab: PairedTab | null): void {
    this.#tab = tab
    this.#sendTab()
  }

  stop(): void {
    this.#started = false
    this.#clearReconnectTimer()
    this.#stopPing()
    const socket = this.#socket
    this.#socket = null
    if (socket) {
      try {
        socket.close()
      } catch {
        // already gone; state below still needs to settle
      }
    }
    if (this.#state !== 'disconnected') this.#setState('disconnected')
  }

  // alarm hook: catches the MV3-suspension case where the socket dies
  // without ever firing onclose, so no reconnect timer got scheduled
  tick(): void {
    if (!this.#started) return
    if (this.#reconnectTimer) return
    if (this.#socket && this.#socket.readyState === WEBSOCKET_OPEN) return
    this.#connect()
  }

  #connect(): void {
    this.#clearReconnectTimer()
    this.#stopPing()
    this.#setState('connecting')
    const previous = this.#socket
    this.#socket = null
    if (previous) {
      try {
        previous.close()
      } catch {
        // already gone; replacing it below regardless
      }
    }
    const socket = this.#createSocket(this.#url)
    this.#socket = socket
    socket.onopen = () => this.#handleOpen(socket)
    socket.onmessage = (e) => this.#handleMessage(socket, e)
    socket.onclose = (e) => this.#handleClose(socket, e)
    socket.onerror = () => this.#handleClose(socket)
  }

  #handleOpen(socket: SocketLike): void {
    if (socket !== this.#socket) return
    const hello: HelloFrame = {
      type: 'hello',
      extensionVersion: this.#extensionVersion,
    }
    socket.send(JSON.stringify(hello))
    if (this.#tab) this.#sendTab()
    this.#setState('connected')
    this.#startPing(socket)
  }

  #sendTab(): void {
    const socket = this.#socket
    if (!socket || socket.readyState !== WEBSOCKET_OPEN) return
    const frame: TabFrame = { type: 'tab', tab: this.#tab }
    try {
      socket.send(JSON.stringify(frame))
    } catch {
      // the socket is already dying; the reconnect resends from #handleOpen
    }
  }

  #handleMessage(socket: SocketLike, e: { data: unknown }): void {
    if (socket !== this.#socket) return
    if (typeof e.data !== 'string') return
    const frame = parseServerFrame(e.data)
    if (!frame) return
    // the server answers a hello by closing or by staying silent, never by
    // replying, so a frame arriving is the only proof the handshake landed —
    // resetting on open instead pins the backoff at its first step forever
    this.#attempt = 0
    if (frame.type === 'pong') {
      this.#clearPongTimer()
      return
    }
    if (frame.type === 'ping') {
      socket.send('{"type":"pong"}')
      return
    }
    void this.#onRequest(frame)
      .then((response) => {
        if (socket !== this.#socket) return
        socket.send(JSON.stringify(response))
      })
      .catch((error: unknown) => {
        if (socket !== this.#socket) return
        const response: ResponseFrame = {
          id: frame.id,
          ok: false,
          error: {
            code: error instanceof ProtocolError ? error.code : 'INTERNAL',
            message: error instanceof Error ? error.message : String(error),
          },
        }
        socket.send(JSON.stringify(response))
      })
  }

  #handleClose(socket: SocketLike, event?: unknown): void {
    if (socket !== this.#socket) return
    this.#stopPing()
    this.#socket = null
    this.#setState('disconnected')
    if (!this.#started) return
    if (closeCode(event) === UNAUTHORIZED_CLOSE_CODE) {
      // the server refused the handshake itself, so every retry sends the
      // same frame and gets the same answer — the versions have drifted
      this.#started = false
      return
    }
    this.#scheduleReconnect()
  }

  #scheduleReconnect(): void {
    this.#clearReconnectTimer()
    const base = this.#backoffMs[this.#attempt] ?? this.#backoffCapMs
    this.#attempt += 1
    const jitter = 0.8 + 0.4 * this.#random()
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      this.#connect()
    }, base * jitter)
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
  }

  #startPing(socket: SocketLike): void {
    this.#stopPing()
    this.#pingTimer = setInterval(() => {
      socket.send('{"type":"ping"}')
      this.#armPongTimeout(socket)
    }, this.#pingIntervalMs)
  }

  #armPongTimeout(socket: SocketLike): void {
    this.#clearPongTimer()
    this.#pongTimer = setTimeout(() => {
      if (socket === this.#socket) socket.close()
    }, this.#pongTimeoutMs)
  }

  #clearPongTimer(): void {
    if (this.#pongTimer) {
      clearTimeout(this.#pongTimer)
      this.#pongTimer = null
    }
  }

  #stopPing(): void {
    if (this.#pingTimer) {
      clearInterval(this.#pingTimer)
      this.#pingTimer = null
    }
    this.#clearPongTimer()
  }

  #setState(state: ConnectionState): void {
    this.#state = state
    this.#onStateChange?.(state)
  }
}

export type { ConnectionOptions, ConnectionState, SocketLike }
export { Connection }
