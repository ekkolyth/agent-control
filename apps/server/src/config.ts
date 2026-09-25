const DEFAULT_PORT = 3660
const DEFAULT_RECONNECT_GRACE_MS = 3000

type ParsedArgs = {
  port: number
  reconnectGraceMs: number
}

function parseNumericFlag(flag: string, raw: string | undefined): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`invalid value for ${flag}: ${raw}`)
  }
  return value
}

function parseArgs(argv: string[]): ParsedArgs {
  let port = DEFAULT_PORT
  let reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--port':
        port = parseNumericFlag(flag, argv[++i])
        break
      case '--reconnect-grace':
        reconnectGraceMs = parseNumericFlag(flag, argv[++i])
        break
      default:
        throw new Error(`unknown flag ${flag}`)
    }
  }

  return { port, reconnectGraceMs }
}

export type { ParsedArgs }
export { parseArgs }
