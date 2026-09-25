import pino, { type DestinationStream, type Logger } from 'pino'
import pretty from 'pino-pretty'

const REDACT_PATHS = [
  'token',
  '*.token',
  '*.password',
  '*.authorization',
  '*.cookie',
]

type CreateLoggerOptions = {
  service: string
  pretty?: boolean
  destination?: DestinationStream
}

function resolvePretty(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit
  if (process.env.LOG_PRETTY === 'true') return true
  if (process.env.LOG_PRETTY === 'false') return false
  return Boolean(process.stdout.isTTY)
}

function createLogger(opts: CreateLoggerOptions): Logger {
  const options: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: opts.service },
    serializers: { error: pino.stdSerializers.err },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  }
  if (opts.destination) {
    return pino(options, opts.destination)
  }
  if (!resolvePretty(opts.pretty)) {
    return pino(options)
  }
  return pino(
    options,
    pretty({ colorize: Boolean(process.stdout.isTTY), ignore: 'pid,hostname' })
  )
}

function scope(logger: Logger, name: string): Logger {
  return logger.child({ scope: name })
}

export type { Logger }
export { createLogger, scope }
