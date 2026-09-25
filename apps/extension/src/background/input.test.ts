import { describe, expect, test } from 'vitest'
import { Keyboard, Mouse } from './input'

function recorder() {
  const calls: Array<[string, Record<string, unknown> | undefined]> = []
  return {
    calls,
    send: async (m: string, p?: Record<string, unknown>) => {
      calls.push([m, p])
      return {}
    },
  }
}

describe('Keyboard', () => {
  test('press a: keyDown with text then keyUp', async () => {
    const r = recorder()
    const k = new Keyboard(r.send)
    await k.press('a')
    expect(r.calls.map(([m]) => m)).toEqual([
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
    ])
    expect(r.calls[0]![1]).toMatchObject({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      text: 'a',
      windowsVirtualKeyCode: 65,
      modifiers: 0,
    })
    expect(r.calls[1]![1]).toMatchObject({ type: 'keyUp', key: 'a' })
  })

  test('ArrowLeft is rawKeyDown without text', async () => {
    const r = recorder()
    await new Keyboard(r.send).press('ArrowLeft')
    expect(r.calls[0]![1]).toMatchObject({
      type: 'rawKeyDown',
      key: 'ArrowLeft',
      code: 'ArrowLeft',
    })
  })

  test('Control+a holds the modifier', async () => {
    const r = recorder()
    await new Keyboard(r.send).press('Control+a')
    const types = r.calls.map(([, p]) => [p!.type, p!.key, p!.modifiers])
    // Puppeteer clears `text` when any modifier other than Shift is held
    // (cdp/Input.ts:143-146), so "a" is rawKeyDown here.
    expect(types).toEqual([
      ['rawKeyDown', 'Control', 2],
      ['rawKeyDown', 'a', 2],
      ['keyUp', 'a', 2],
      ['keyUp', 'Control', 0],
    ])
  })

  test('type mixes key presses and insertText for non-layout chars', async () => {
    const r = recorder()
    await new Keyboard(r.send).type('aé')
    expect(r.calls.map(([m]) => m)).toEqual([
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
      'Input.insertText',
    ])
    expect(r.calls[2]![1]).toEqual({ text: 'é' })
  })

  test('type handles a literal plus sign without splitting it as a combo', async () => {
    const r = recorder()
    await new Keyboard(r.send).type('+')
    expect(r.calls.map(([, p]) => [p!.type, p!.key])).toEqual([
      ['keyDown', '+'],
      ['keyUp', '+'],
    ])
  })

  test('type handles a plus sign inside a longer string, e.g. an email', async () => {
    const r = recorder()
    await new Keyboard(r.send).type('a+b')
    expect(r.calls.map(([, p]) => [p!.type, p!.key])).toEqual([
      ['keyDown', 'a'],
      ['keyUp', 'a'],
      ['keyDown', '+'],
      ['keyUp', '+'],
      ['keyDown', 'b'],
      ['keyUp', 'b'],
    ])
  })

  test('unknown key throws INTERNAL', async () => {
    await expect(
      new Keyboard(recorder().send).press('NotAKey')
    ).rejects.toMatchObject({ code: 'INTERNAL' })
  })
})

describe('Mouse', () => {
  test('click is moved, pressed, released at the point', async () => {
    const r = recorder()
    const m = new Mouse(r.send, new Keyboard(r.send))
    await m.click(10, 20)
    expect(r.calls.map(([, p]) => [p!.type, p!.x, p!.y, p!.buttons])).toEqual([
      ['mouseMoved', 10, 20, 0],
      ['mousePressed', 10, 20, 1],
      ['mouseReleased', 10, 20, 0],
    ])
    expect(r.calls[1]![1]).toMatchObject({ button: 'left', clickCount: 1 })
    expect(m.position).toEqual({ x: 10, y: 20 })
  })

  test('drag interpolates ten moves while pressed', async () => {
    const r = recorder()
    const m = new Mouse(r.send, new Keyboard(r.send))
    await m.drag({ x: 0, y: 0 }, { x: 100, y: 0 })
    const moves = r.calls.filter(([, p]) => p!.type === 'mouseMoved')
    expect(moves.length).toBe(11)
    expect(moves.slice(1).every(([, p]) => p!.buttons === 1)).toBe(true)
    expect(moves.at(-1)![1]).toMatchObject({ x: 100, y: 0 })
  })
})
