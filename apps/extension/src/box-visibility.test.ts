// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'

type BoxVisibility = { visible: boolean; reason?: string }

// replicates Playwright's computeBox gate order: checkVisibility(), then
// style.visibility, then the rect — so the test proves the stubs compose the
// way the real consumer reads them, not just in isolation
function computeBoxLike(element: Element): BoxVisibility {
  if (!element.checkVisibility()) {
    return { visible: false, reason: 'checkVisibility' }
  }

  const style = window.getComputedStyle(element)
  if (style.visibility !== 'visible') {
    return { visible: false, reason: `visibility=${style.visibility}` }
  }

  const rect = element.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) {
    return { visible: false, reason: 'rect' }
  }

  return { visible: true }
}

describe('computeBox-style visibility gate', () => {
  test('a normal element is visible', () => {
    document.body.innerHTML = '<button id="btn">go</button>'
    const btn = document.getElementById('btn')
    if (!btn) throw new Error('missing #btn')

    expect(computeBoxLike(btn)).toEqual({ visible: true })
  })

  test('an element inside [hidden] is not visible', () => {
    document.body.innerHTML =
      '<div hidden><button id="hidden-btn">go</button></div>'
    const hiddenBtn = document.getElementById('hidden-btn')
    if (!hiddenBtn) throw new Error('missing #hidden-btn')

    expect(computeBoxLike(hiddenBtn).visible).toBe(false)
  })
})
