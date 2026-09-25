import {
  commandNameSchema,
  commands,
  pageStateSchema,
  snapshotModeSchema,
} from '@agent-control/protocol'
import { describe, expect, test } from 'vitest'

describe('commands', () => {
  test('names match the spec table', () => {
    expect(Object.keys(commands).sort()).toEqual([
      'back',
      'click',
      'consoleLogs',
      'drag',
      'forward',
      'hover',
      'navigate',
      'press',
      'screenshot',
      'select',
      'snapshot',
      'tabInfo',
      'type',
    ])
    expect(commandNameSchema.options.length).toBe(13)
  })

  test('every action response is a page state', () => {
    const state = {
      url: 'https://a.test/',
      title: 'A',
      snapshot: '- button',
      hash: 'abc',
    }
    for (const name of [
      'snapshot',
      'navigate',
      'back',
      'forward',
      'click',
      'hover',
      'type',
      'press',
      'select',
      'drag',
    ] as const) {
      expect(commands[name].response.safeParse(state).success).toBe(true)
    }
    expect(
      pageStateSchema.safeParse({ url: 'u', title: 't', hash: 'h' }).success
    ).toBe(true)
    // hash is required: the snapshot policy's "only if changed" rule reads it
    expect(pageStateSchema.safeParse({ url: 'u', title: 't' }).success).toBe(
      false
    )
    expect(pageStateSchema.safeParse({ title: 't', hash: 'h' }).success).toBe(
      false
    )
  })

  test('ref-bearing requests reject empty refs and pin their field names', () => {
    for (const name of ['click', 'hover'] as const) {
      expect(
        commands[name].request.safeParse({ ref: '', mode: 'compact' }).success
      ).toBe(false)
      expect(
        commands[name].request.safeParse({ ref: 'ab12e1', mode: 'compact' })
          .success
      ).toBe(true)
    }
    expect(
      commands.drag.request.safeParse({
        startRef: 'ab12e1',
        endRef: 'ab12e2',
        mode: 'compact',
      }).success
    ).toBe(true)
    expect(
      commands.drag.request.safeParse({
        start: 'ab12e1',
        end: 'ab12e2',
        mode: 'compact',
      }).success
    ).toBe(false)
    for (const name of ['snapshot', 'back', 'forward'] as const) {
      expect(commands[name].request.safeParse({}).success).toBe(false)
    }
  })

  test('requests validate their fields', () => {
    expect(
      commands.navigate.request.safeParse({ url: 'not a url', mode: 'compact' })
        .success
    ).toBe(false)
    expect(
      commands.navigate.request.safeParse({
        url: 'javascript:alert(1)',
        mode: 'compact',
      }).success
    ).toBe(false)
    expect(
      commands.navigate.request.safeParse({
        url: 'file:///etc/passwd',
        mode: 'compact',
      }).success
    ).toBe(false)
    expect(
      commands.navigate.request.parse({
        url: ' https://a.test/ ',
        mode: 'compact',
      }).url
    ).toBe('https://a.test/')
    expect(
      commands.select.request.safeParse({
        ref: 's1e1',
        values: [],
        mode: 'compact',
      }).success
    ).toBe(false)
    expect(
      commands.press.request.safeParse({ key: '', mode: 'none' }).success
    ).toBe(false)
    expect(
      commands.type.request.safeParse({
        ref: 's1e2',
        text: 'hi',
        submit: true,
        mode: 'compact',
      }).success
    ).toBe(true)
    expect(snapshotModeSchema.options).toEqual(['none', 'compact', 'full'])
  })

  test('non-page responses', () => {
    expect(
      commands.screenshot.response.safeParse({ data: 'iVBOR' }).success
    ).toBe(true)
    expect(
      commands.consoleLogs.response.safeParse({
        entries: [{ level: 'log', text: 'x', timestamp: 1 }],
      }).success
    ).toBe(true)
    expect(
      commands.tabInfo.response.safeParse({ url: 'u', title: 't' }).success
    ).toBe(true)
  })
})
