import { describe, expect, test } from 'vitest'
import type { Cdp } from './cdp'
import { ConsoleBuffer } from './console-buffer'

describe('ConsoleBuffer', () => {
  test('caps at 500 and drains per tab', () => {
    const b = new ConsoleBuffer(500)
    for (let i = 0; i < 600; i++) {
      b.push(1, { level: 'log', text: String(i), timestamp: i })
    }
    b.push(2, { level: 'warn', text: 'other', timestamp: 0 })

    const d = b.drain(1)
    expect(d.length).toBe(500)
    expect(d[0]!.text).toBe('100')
    expect(b.drain(1)).toEqual([])
    expect(b.drain(2)).toEqual([{ level: 'warn', text: 'other', timestamp: 0 }])
  })

  test('maps Runtime events', () => {
    const b = new ConsoleBuffer()
    let handler: (tabId: number, method: string, params: unknown) => void =
      () => {}
    b.attach({
      onEvent: (fn: typeof handler) => {
        handler = fn
        return () => {}
      },
    } as unknown as Cdp)

    handler(3, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ value: 'boom' }, { description: 'Obj' }],
      timestamp: 5,
    })
    handler(3, 'Runtime.exceptionThrown', {
      timestamp: 6,
      exceptionDetails: {
        text: 'Uncaught',
        exception: { description: 'TypeError: x' },
      },
    })

    expect(b.drain(3)).toEqual([
      { level: 'error', text: 'boom Obj', timestamp: 5 },
      { level: 'error', text: 'Uncaught TypeError: x', timestamp: 6 },
    ])
  })
})
