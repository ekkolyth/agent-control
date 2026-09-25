import { ProtocolError } from '@agent-control/protocol'
import { _keyDefinitions, type KeyInput } from './vendor/USKeyboardLayout'

type CdpSend = (
  method: string,
  params?: Record<string, unknown>
) => Promise<unknown>

type KeyDescription = {
  key: string
  keyCode: number
  code: string
  text: string
  location: number
}

function modifierBit(key: string): number {
  switch (key) {
    case 'Alt':
      return 1
    case 'Control':
      return 2
    case 'Meta':
      return 4
    case 'Shift':
      return 8
    default:
      return 0
  }
}

class Keyboard {
  readonly #send: CdpSend
  #modifiers = 0

  constructor(send: CdpSend) {
    this.#send = send
  }

  get modifiers(): number {
    return this.#modifiers
  }

  #describe(key: string): KeyDescription {
    const definition = Object.hasOwn(_keyDefinitions, key)
      ? _keyDefinitions[key as KeyInput]
      : undefined
    if (!definition) {
      throw new ProtocolError('INTERNAL', `Unknown key: ${key}`)
    }

    const shift = this.#modifiers & 8
    const resultKey =
      (shift ? definition.shiftKey : undefined) ?? definition.key ?? ''
    const keyCode =
      (shift ? definition.shiftKeyCode : undefined) ?? definition.keyCode ?? 0
    const code = definition.code ?? ''
    const location = definition.location ?? 0

    let text = resultKey.length === 1 ? resultKey : ''
    if (definition.text) text = definition.text
    if (shift && definition.shiftText) text = definition.shiftText
    // Puppeteer clears text when any modifier besides Shift is held.
    if (this.#modifiers & ~8) text = ''

    return { key: resultKey, keyCode, code, text, location }
  }

  async down(key: string): Promise<void> {
    const description = this.#describe(key)
    this.#modifiers |= modifierBit(description.key)
    await this.#send('Input.dispatchKeyEvent', {
      type: description.text ? 'keyDown' : 'rawKeyDown',
      modifiers: this.#modifiers,
      windowsVirtualKeyCode: description.keyCode,
      code: description.code,
      key: description.key,
      text: description.text,
      unmodifiedText: description.text,
      location: description.location,
      isKeypad: description.location === 3,
    })
  }

  async up(key: string): Promise<void> {
    const description = this.#describe(key)
    this.#modifiers &= ~modifierBit(description.key)
    await this.#send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: this.#modifiers,
      windowsVirtualKeyCode: description.keyCode,
      code: description.code,
      key: description.key,
      location: description.location,
    })
  }

  async press(key: string): Promise<void> {
    const parts = key.split('+')
    const finalKey = parts.at(-1)!
    const modifierKeys = parts.slice(0, -1)
    for (const modifier of modifierKeys) await this.down(modifier)
    await this.down(finalKey)
    await this.up(finalKey)
    for (const modifier of [...modifierKeys].reverse()) await this.up(modifier)
  }

  async type(text: string): Promise<void> {
    for (const char of text) {
      if (Object.hasOwn(_keyDefinitions, char)) {
        // go straight to down/up, not press(char) — press splits on `+` for
        // combo syntax, and `+` is itself a key definition (NumpadAdd), so
        // press('+') would parse a literal plus sign as an empty combo
        await this.down(char)
        await this.up(char)
      } else {
        await this.#send('Input.insertText', { text: char })
      }
    }
  }
}

type Point = { x: number; y: number }

class Mouse {
  readonly #send: CdpSend
  readonly #keyboard: Keyboard
  #position: Point = { x: 0, y: 0 }
  #buttons = 0

  constructor(send: CdpSend, keyboard: Keyboard) {
    this.#send = send
    this.#keyboard = keyboard
  }

  get position(): Point {
    return { ...this.#position }
  }

  async move(x: number, y: number, opts?: { steps?: number }): Promise<void> {
    const steps = opts?.steps ?? 1
    const from = { ...this.#position }
    for (let i = 1; i <= steps; i++) {
      this.#position = {
        x: from.x + (x - from.x) * (i / steps),
        y: from.y + (y - from.y) * (i / steps),
      }
      await this.#send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: this.#position.x,
        y: this.#position.y,
        modifiers: this.#keyboard.modifiers,
        buttons: this.#buttons,
      })
    }
  }

  async down(): Promise<void> {
    this.#buttons = 1
    await this.#send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: this.#position.x,
      y: this.#position.y,
      modifiers: this.#keyboard.modifiers,
      button: 'left',
      buttons: this.#buttons,
      clickCount: 1,
    })
  }

  async up(): Promise<void> {
    this.#buttons = 0
    await this.#send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: this.#position.x,
      y: this.#position.y,
      modifiers: this.#keyboard.modifiers,
      button: 'left',
      buttons: this.#buttons,
      clickCount: 1,
    })
  }

  async click(x: number, y: number): Promise<void> {
    await this.move(x, y)
    await this.down()
    await this.up()
  }

  async drag(from: Point, to: Point): Promise<void> {
    await this.move(from.x, from.y)
    await this.down()
    await this.move(to.x, to.y, { steps: 10 })
    await this.up()
  }
}

export type { CdpSend }
export { Keyboard, Mouse }
