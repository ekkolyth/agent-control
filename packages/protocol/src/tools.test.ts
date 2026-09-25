import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import type { ToolName } from './tools'
import { toolDefinitions, toolInputSchemas } from './tools'

describe('tools', () => {
  test('thirteen tools in spec order', () => {
    expect(toolDefinitions.map((t) => t.name)).toEqual([
      'browser_navigate',
      'browser_go_back',
      'browser_go_forward',
      'browser_snapshot',
      'browser_click',
      'browser_hover',
      'browser_type',
      'browser_press_key',
      'browser_select_option',
      'browser_drag',
      'browser_screenshot',
      'browser_get_console_logs',
      'browser_wait',
    ])
  })

  test('json schema for every tool is stable', () => {
    const out = Object.fromEntries(
      toolDefinitions.map((t) => [
        t.name,
        z.toJSONSchema(z.object(t.inputShape)),
      ])
    )
    expect(out).toMatchSnapshot()
  })

  test('input schemas validate', () => {
    expect(toolInputSchemas.browser_wait.safeParse({ time: 0 }).success).toBe(
      false
    )
    expect(toolInputSchemas.browser_wait.safeParse({ time: 2 }).success).toBe(
      true
    )
    expect(
      toolInputSchemas.browser_click.safeParse({
        element: 'Submit',
        ref: 's1e3',
      }).success
    ).toBe(true)
    expect(
      toolInputSchemas.browser_click.safeParse({ ref: 's1e3' }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_navigate.safeParse({ url: 123 }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_navigate.safeParse({
        url: 'javascript:alert(1)',
      }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_navigate.safeParse({
        url: 'file:///etc/passwd',
      }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_navigate.safeParse({
        url: 'https://a.test/',
      }).success
    ).toBe(true)
  })

  test('the tool schema is never looser than the wire command schema', () => {
    expect(
      toolInputSchemas.browser_click.safeParse({ element: 'x', ref: '' })
        .success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_drag.safeParse({
        startElement: 'a',
        startRef: '',
        endElement: 'b',
        endRef: 's1e2',
      }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_drag.safeParse({
        startElement: 'a',
        startRef: 's1e1',
        endElement: 'b',
        endRef: '',
      }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_press_key.safeParse({ key: '' }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_select_option.safeParse({
        element: 'x',
        ref: 's1e1',
        values: [],
      }).success
    ).toBe(false)
  })

  test('parsed arguments keep their literal field types', () => {
    const parsed = toolInputSchemas.browser_click.safeParse({
      element: 'Submit',
      ref: 's1e3',
    })
    if (!parsed.success) throw new Error('expected a successful parse')
    const element: string = parsed.data.element
    expect(element).toBe('Submit')
    // @ts-expect-error browser_click's parsed data has no `time` field
    expect(parsed.data.time).toBeUndefined()
  })

  test('every tool accepts a valid payload built from its exact field names', () => {
    const validPayloads: Record<string, Record<string, unknown>> = {
      browser_navigate: { url: 'https://a.test/' },
      browser_go_back: {},
      browser_go_forward: {},
      browser_snapshot: {},
      browser_click: { element: 'Submit button', ref: 's1e3' },
      browser_hover: { element: 'Menu item', ref: 's1e4' },
      browser_type: {
        element: 'Search box',
        ref: 's1e5',
        text: 'hello',
        submit: true,
      },
      browser_press_key: { key: 'Enter' },
      browser_select_option: {
        element: 'Country dropdown',
        ref: 's1e6',
        values: ['US'],
      },
      browser_drag: {
        startElement: 'Draggable card',
        startRef: 's1e7',
        endElement: 'Drop target',
        endRef: 's1e8',
      },
      browser_screenshot: {},
      browser_get_console_logs: {},
      browser_wait: { time: 5 },
    }

    for (const tool of toolDefinitions) {
      expect(
        toolInputSchemas[tool.name].safeParse(validPayloads[tool.name]).success
      ).toBe(true)
    }
  })

  test('tools with required fields reject a payload missing one', () => {
    expect(
      toolInputSchemas.browser_hover.safeParse({ ref: 's1e4' }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_drag.safeParse({
        startElement: 'Draggable card',
        startRef: 's1e7',
        endElement: 'Drop target',
      }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_type.safeParse({
        element: 'Search box',
        ref: 's1e5',
        text: 'hello',
      }).success
    ).toBe(false)
    expect(
      toolInputSchemas.browser_select_option.safeParse({
        element: 'Country dropdown',
        ref: 's1e6',
      }).success
    ).toBe(false)
    expect(toolInputSchemas.browser_press_key.safeParse({}).success).toBe(false)
  })

  test('every tool description is pinned', () => {
    const expected: Record<ToolName, string> = {
      browser_navigate: 'Navigate to a URL',
      browser_go_back: 'Go back to the previous page',
      browser_go_forward: 'Go forward to the next page',
      browser_snapshot:
        'Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with.',
      browser_click: 'Perform click on a web page',
      browser_hover: 'Hover over element on page',
      browser_type: 'Type text into editable element',
      browser_press_key: 'Press a key on the keyboard',
      browser_select_option: 'Select an option in a dropdown',
      browser_drag: 'Perform drag and drop between two elements',
      browser_screenshot: 'Take a screenshot of the current page',
      browser_get_console_logs: 'Get the console logs from the browser',
      browser_wait: 'Wait for a specified time in seconds',
    }

    for (const tool of toolDefinitions) {
      expect(tool.description).toBe(expected[tool.name])
    }
  })

  test('every field description survives into the json schema', () => {
    const elementDescription =
      'Human-readable element description used to obtain permission to interact with the element'
    const refDescription =
      'Exact target element reference from the page snapshot'
    const expected: Partial<Record<ToolName, Record<string, string>>> = {
      browser_navigate: { url: 'The URL to navigate to' },
      browser_click: { element: elementDescription, ref: refDescription },
      browser_hover: { element: elementDescription, ref: refDescription },
      browser_type: {
        element: elementDescription,
        ref: refDescription,
        text: 'Text to type into the element',
        submit: 'Whether to submit entered text (press Enter after)',
      },
      browser_press_key: {
        key: 'Name of the key to press or a character to generate, such as `ArrowLeft` or `a`',
      },
      browser_select_option: {
        element: elementDescription,
        ref: refDescription,
        values:
          'Array of values to select in the dropdown. This can be a single value or multiple values.',
      },
      browser_drag: {
        startElement:
          'Human-readable source element description used to obtain the permission to interact with the element',
        startRef: 'Exact source element reference from the page snapshot',
        endElement:
          'Human-readable target element description used to obtain the permission to interact with the element',
        endRef: refDescription,
      },
      browser_wait: { time: 'The time to wait in seconds' },
    }

    for (const tool of toolDefinitions) {
      const fields = expected[tool.name]
      if (!fields) continue
      const jsonSchema = z.toJSONSchema(z.object(tool.inputShape))
      for (const [field, description] of Object.entries(fields)) {
        const property = jsonSchema.properties?.[field]
        const actual =
          property && typeof property === 'object'
            ? property.description
            : undefined
        expect(actual).toBe(description)
      }
    }
  })
})
