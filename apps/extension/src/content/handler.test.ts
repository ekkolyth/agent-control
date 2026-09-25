// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { handleContentRequest } from './handler'
import { createQuietDetector } from './quiet'
import { generateSnapshot, getRefPrefix } from './snapshot'

const deps = () => ({ doc: document, quiet: createQuietDetector(document) })
const refFor = (pattern: RegExp) =>
  generateSnapshot(document, { mode: 'full' }).snapshot!.match(pattern)![1]!

describe('content handler', () => {
  test('snapshot returns page state', async () => {
    document.body.innerHTML = '<button>Go</button>'
    const r = await handleContentRequest(
      { kind: 'snapshot', mode: 'full' },
      deps()
    )
    expect(r).toMatchObject({
      ok: true,
      result: { title: expect.any(String), hash: expect.any(String) },
    })
    expect((r as { result: { snapshot: string } }).result.snapshot).toMatch(
      /button "Go" \[ref=\w+e\d+\]/
    )
  })

  test('resolveRef returns a center point and classifies errors', async () => {
    document.body.innerHTML = '<button>Go</button>'
    const ref = refFor(/button "Go" \[ref=(\w+)\]/)
    const ok = await handleContentRequest({ kind: 'resolveRef', ref }, deps())
    expect(ok).toMatchObject({
      ok: true,
      result: { x: expect.any(Number), y: expect.any(Number) },
    })
    expect(
      await handleContentRequest(
        { kind: 'resolveRef', ref: `zzzz${ref.slice(4)}` },
        deps()
      )
    ).toMatchObject({ ok: false, code: 'STALE_REF' })
    expect(
      await handleContentRequest(
        { kind: 'resolveRef', ref: `${getRefPrefix()}e999999` },
        deps()
      )
    ).toMatchObject({ ok: false, code: 'REF_NOT_FOUND' })
  })

  test('resolveRef on a ref whose element left the page reports STALE_REF, not a point', async () => {
    document.body.innerHTML = '<button>Go</button>'
    const ref = refFor(/button "Go" \[ref=(\w+)\]/)
    document.querySelector('button')!.remove()
    expect(
      await handleContentRequest({ kind: 'resolveRef', ref }, deps())
    ).toMatchObject({ ok: false, code: 'STALE_REF' })
  })

  test('resolveRef scrolls synchronously so the rect is read post-scroll', async () => {
    document.body.innerHTML = '<button>Go</button>'
    const ref = refFor(/button "Go" \[ref=(\w+)\]/)
    const button = document.querySelector('button')!
    const calls: unknown[] = []
    button.scrollIntoView = ((opts: unknown) => {
      calls.push(opts)
    }) as typeof button.scrollIntoView
    await handleContentRequest({ kind: 'resolveRef', ref }, deps())
    // `behavior: 'instant'` is what stops a smooth-scrolling page from
    // animating the scroll and leaving the very next getBoundingClientRect
    // read mid-flight
    expect(calls).toEqual([
      { block: 'center', inline: 'center', behavior: 'instant' },
    ])
  })

  test('a throw during dispatch resolves INTERNAL rather than hanging the request', async () => {
    document.body.innerHTML = '<button>Go</button>'
    const ref = refFor(/button "Go" \[ref=(\w+)\]/)
    const button = document.querySelector('button')!
    // simulates an exotic element the vendored snapshot/resolve code can't
    // handle — resolveRef's centerPoint calls this and would otherwise throw
    // an unhandled rejection that leaves sendResponse never called
    // @ts-expect-error deliberately removing a required DOM method
    button.scrollIntoView = undefined
    const result = await handleContentRequest(
      { kind: 'resolveRef', ref },
      deps()
    )
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' })
  })

  test('clearValue and selectOptions mutate the DOM and fire events', async () => {
    document.body.innerHTML =
      '<input aria-label="Name" value="old"><select aria-label="Pick" multiple><option value="a">A</option><option value="b">B</option></select>'
    const inputRef = refFor(/textbox "Name" \[ref=(\w+)\]/)
    const selectRef = refFor(/listbox "Pick" \[ref=(\w+)\]/)
    const events: string[] = []
    // listen on body, not the target elements, so a non-bubbling event
    // would actually fail this — and so the select's own `input` dispatch,
    // previously unobserved, is now on the record too
    document.body.addEventListener('input', () => events.push('input'))
    document.body.addEventListener('change', () => events.push('change'))
    await handleContentRequest({ kind: 'clearValue', ref: inputRef }, deps())
    expect(document.querySelector('input')!.value).toBe('')
    await handleContentRequest(
      { kind: 'selectOptions', ref: selectRef, values: ['b'] },
      deps()
    )
    expect(
      [...document.querySelectorAll('option')].map((o) => o.selected)
    ).toEqual([false, true])
    expect(events).toEqual(['input', 'input', 'change'])
  })

  test('clearValue bypasses a React-style value tracker', async () => {
    document.body.innerHTML = '<input aria-label="Name" value="old">'
    const inputRef = refFor(/textbox "Name" \[ref=(\w+)\]/)
    const input = document.querySelector('input')!
    // stub the instance-level tracker React installs: its setter caches
    // whatever value flows through `.value =`, which is exactly what makes
    // `element.value = ''` invisible to React's change detection
    let trackedValue = input.value
    const nativeDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        return nativeDescriptor.get!.call(this)
      },
      set(v: string) {
        trackedValue = v
        nativeDescriptor.set!.call(this, v)
      },
    })
    await handleContentRequest({ kind: 'clearValue', ref: inputRef }, deps())
    expect(input.value).toBe('')
    // going through the prototype setter (not the instance one above) means
    // the tracker never sees the write — if clearValue used
    // `element.value = ''` instead, trackedValue would also read '' here
    expect(trackedValue).toBe('old')
  })

  test('selectOptions on a non-select is INTERNAL', async () => {
    document.body.innerHTML = '<button>Go</button>'
    const ref = refFor(/button "Go" \[ref=(\w+)\]/)
    expect(
      await handleContentRequest(
        { kind: 'selectOptions', ref, values: ['x'] },
        deps()
      )
    ).toMatchObject({ ok: false, code: 'INTERNAL' })
  })

  test('invalid message is INTERNAL', async () => {
    expect(await handleContentRequest({ kind: 'nope' }, deps())).toMatchObject({
      ok: false,
      code: 'INTERNAL',
    })
  })
})
