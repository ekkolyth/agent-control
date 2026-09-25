import type { DestinationStream } from 'pino'

type CapturedDestination = DestinationStream & { lines: string[] }

function captureDestination(): CapturedDestination {
  const lines: string[] = []
  return {
    lines,
    write: (chunk: string) => {
      lines.push(chunk)
    },
  }
}

function parseLogLines(lines: string[]): Record<string, unknown>[] {
  return lines.filter((l) => l.trim().length > 0).map((l) => JSON.parse(l))
}

export { captureDestination, parseLogLines }
