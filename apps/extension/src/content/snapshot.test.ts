// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  compactTree,
  generateSnapshot,
  getRefPrefix,
  hashPage,
  renderWithBudget,
  resolveRef,
} from './snapshot'
import type {
  AriaNodeJSON,
  AriaSnapshotJSON,
} from './vendor/playwright/isomorphic/ariaSnapshot'

// vitest's happy-dom environment runs this file through Vite's client-side
// transform, which special-cases the literal pattern
// `new URL('./x', import.meta.url)` for browser asset bundling and rewrites
// it to an http://localhost URL instead of leaving it a file: path.
// Routing import.meta.url through a variable first avoids that rewrite.
const moduleUrl = import.meta.url
const html = readFileSync(
  new URL('./__fixtures__/article.html', moduleUrl),
  'utf8'
)
const P = getRefPrefix()
const refOf = (yaml: string, pattern: RegExp) => yaml.match(pattern)![1]!
beforeEach(() => {
  document.documentElement.innerHTML = html
  document.title = 'Why MV3 workers die'
})

describe('generateSnapshot', () => {
  test('full mode renders interactive refs with the instance prefix', () => {
    const r = generateSnapshot(document, { mode: 'full' })
    expect(r.title).toBe('Why MV3 workers die')
    expect(r.snapshot).toMatch(
      new RegExp(`- button "Share" \\[ref=${P}e\\d+\\]`)
    )
    expect(r.snapshot).toMatch(
      new RegExp(`- textbox "Add a comment" \\[ref=${P}e\\d+\\]`)
    )
    expect(r.snapshot).toContain('thirty seconds without events')
  })

  test('a stable element keeps its ref across snapshots', () => {
    const a = refOf(
      generateSnapshot(document, { mode: 'full' }).snapshot!,
      /button "Share" \[ref=(\w+)\]/
    )
    const b = refOf(
      generateSnapshot(document, { mode: 'full' }).snapshot!,
      /button "Share" \[ref=(\w+)\]/
    )
    expect(a).toBe(b)
  })

  test('compact mode clips text, keeps interactive refs and headings, drops refs elsewhere', () => {
    const r = generateSnapshot(document, { mode: 'compact' })
    expect(r.snapshot).toMatch(new RegExp(`button "Share" \\[ref=${P}e\\d+\\]`))
    expect(r.snapshot).toContain('heading "Why MV3 workers die"')
    expect(r.snapshot).not.toContain('thirty seconds without events')
    expect(r.snapshot).toMatch(/…/)
    expect(r.snapshot).not.toContain('img "diagram')
    expect(r.snapshot).not.toMatch(/paragraph[^\n]*\[ref=/)
    // a landmark whose only content is its own text (the footer) collapses
    // to bare role/name with no text at all, not merely a clipped version
    expect(r.snapshot).not.toContain('© 2026 Example')
    expect(r.snapshot!.length).toBeLessThan(
      generateSnapshot(document, { mode: 'full' }).snapshot!.length
    )
  })

  test('none mode omits the snapshot but still hashes', () => {
    const r = generateSnapshot(document, { mode: 'none' })
    expect(r.snapshot).toBeUndefined()
    expect(r.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(r.hash).toBe(generateSnapshot(document, { mode: 'full' }).hash)
  })
})

describe('resolveRef', () => {
  const shareRef = () =>
    refOf(
      generateSnapshot(document, { mode: 'full' }).snapshot!,
      /button "Share" \[ref=(\w+)\]/
    )

  test('current ref resolves; wrong prefix, unknown and malformed are classified', () => {
    const ref = shareRef()
    const hit = resolveRef(ref)
    expect(hit.ok && hit.element.tagName).toBe('BUTTON')
    expect(resolveRef(`zzzz${ref.slice(4)}`)).toMatchObject({
      ok: false,
      code: 'STALE_REF',
    })
    expect(resolveRef(`${P}e999999`)).toMatchObject({
      ok: false,
      code: 'REF_NOT_FOUND',
    })
    expect(resolveRef('garbage')).toMatchObject({
      ok: false,
      code: 'REF_NOT_FOUND',
    })
  })

  test('an element removed since the snapshot is STALE_REF, with or without a re-snapshot', () => {
    const ref = shareRef()
    document.querySelector('button')!.remove()
    // no snapshot has run since, so the ref is still in the snapshot's info
    // map holding the detached node — the state that used to resolve ok
    expect(resolveRef(ref)).toMatchObject({
      ok: false,
      code: 'STALE_REF',
      message: 'element was removed from the page',
    })
    generateSnapshot(document, { mode: 'full' })
    expect(resolveRef(ref)).toMatchObject({ ok: false, code: 'STALE_REF' })
  })

  test('an element hidden since the snapshot is STALE_REF until it is shown again', () => {
    const ref = shareRef()
    const button = document.querySelector('button')!
    button.setAttribute('hidden', '')
    expect(resolveRef(ref)).toMatchObject({
      ok: false,
      code: 'STALE_REF',
      message: 'element is no longer visible',
    })
    // the check reads the live element, not a flag latched at snapshot time
    button.removeAttribute('hidden')
    expect(resolveRef(ref)).toMatchObject({ ok: true })
  })
})

describe('hashPage', () => {
  test('ignores refs, changes with content, is 8 hex chars', () => {
    const a = hashPage('u', '- button "Go" [ref=ab12e1]')
    const b = hashPage('u', '- button "Go" [ref=cd34e7]')
    const c = hashPage('u', '- button "Stop" [ref=cd34e7]')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })
  test('zero-pads a short hash to 8 hex chars', () => {
    // 'n0' happens to FNV-hash to 0x07e77c10 — under 0x10000000, so the
    // unpadded hex string is only 7 characters
    expect(hashPage('u', 'n0')).toBe('07e77c10')
  })
})

describe('renderWithBudget', () => {
  // mirrors the real renderer's contract: one line per node, registered in
  // lineToNode in render order, so the budget and the dropped count can be
  // exercised without going through the vendored yaml renderer
  const renderButtons = (
    entries: AriaSnapshotJSON,
    lineToNode: Map<number, AriaNodeJSON>
  ) => {
    const lines: string[] = []
    for (const entry of entries) {
      const node = entry as AriaNodeJSON
      lineToNode.set(lines.length, node)
      lines.push(`- button "${node.name}":`)
      const child = node.children![0] as AriaNodeJSON
      lineToNode.set(lines.length, child)
      lines.push('  - generic')
    }
    return lines.join('\n')
  }

  test('a single multi-line tree keeps whole node lines and counts dropped nodes', () => {
    const json = Array.from({ length: 50 }, (_, i) => ({
      role: 'button',
      name: `B${i}`,
      children: [{ role: 'generic' }],
    })) as AriaSnapshotJSON
    const fullLength = renderButtons(json, new Map()).length
    const budget = 200
    // the budget must genuinely bind: prove the unbounded render would have
    // overrun it, otherwise "kept <= budget" is true by coincidence
    expect(fullLength).toBeGreaterThan(budget)
    const out = renderWithBudget(json, budget, renderButtons)
    const [body, marker] = out.split('\n[snapshot truncated: ')
    expect(body!.length).toBeLessThanOrEqual(budget)
    // a cut mid-pair drops the orphaned "- button ...:" header along with
    // it, so the body always ends on a complete button+generic pair
    expect(body!.endsWith('  - generic')).toBe(true)
    const keptButtons = body!.split('- button').length - 1
    expect(keptButtons).toBeGreaterThan(0)
    expect(keptButtons).toBeLessThan(50)
    expect(marker).toBe(
      `${(50 - keptButtons) * 2} more nodes, call browser_snapshot for full tree]`
    )
  })

  test('a single-rooted tree over the cap still returns real content, not an empty body', () => {
    // the bug this replaces: renderAriaTreeAsJSON returns exactly one
    // top-level entry (the document root) for a real page, so a budget
    // applied per top-level entry had a single iteration — the whole page
    // either fit or the result was empty. this drives the same shape
    // (one root wrapping many nodes) through the real fixture.
    const r = generateSnapshot(document, { mode: 'full', maxChars: 300 })
    expect(r.snapshot).toContain('[snapshot truncated:')
    expect(r.snapshot).toMatch(/document/)
    expect(r.snapshot).toContain('navigation')
    expect(r.snapshot!.length).toBeGreaterThan(73)
  })

  test('dropped count excludes text lines, only counting node lines', () => {
    const json = [
      {
        role: 'main',
        children: [
          { role: 'button', name: 'Keep' },
          { role: 'paragraph', children: ['dropped text child'] },
        ],
      },
    ] as AriaSnapshotJSON
    const full = renderWithBudget(json, Number.MAX_SAFE_INTEGER)
    const [firstLine, secondLine] = full.split('\n')
    // cuts right after "main:" and the "button" leaf, before the
    // "paragraph:" header and its text-only child line
    const budget = firstLine!.length + 1 + secondLine!.length
    const out = renderWithBudget(json, budget)
    expect(out).toBe(
      `${firstLine}\n${secondLine}\n[snapshot truncated: 1 more nodes, call browser_snapshot for full tree]`
    )
  })

  test('returns the plain render when it fits', () => {
    const json = [{ role: 'button', name: 'A' }] as AriaSnapshotJSON
    expect(renderWithBudget(json, 1000, () => '- button "A"')).toBe(
      '- button "A"'
    )
  })
})

describe('compactTree', () => {
  test('landmark with nothing interactive collapses to its name', () => {
    expect(
      compactTree([
        { role: 'contentinfo', children: ['© 2026 Example'] },
      ] as AriaSnapshotJSON)
    ).toEqual([{ role: 'contentinfo' }])
  })
  test('clips node.text and strips refs from non-interactive kept nodes', () => {
    const long = 'x'.repeat(100)
    const out = compactTree([
      {
        role: 'main',
        ref: 'ab12e1',
        children: [
          { role: 'paragraph', ref: 'ab12e2', text: long },
          { role: 'button', name: 'Go', ref: 'ab12e3' },
        ],
      },
    ] as AriaSnapshotJSON)
    expect(out).toEqual([
      {
        role: 'main',
        children: [
          { role: 'paragraph', text: `${'x'.repeat(80)}…` },
          { role: 'button', name: 'Go', ref: 'ab12e3' },
        ],
      },
    ])
  })
  test('pointer-cursor generic counts as interactive', () => {
    const out = compactTree([
      { role: 'generic', ref: 'ab12e9', cursor: 'pointer', text: 'Menu' },
    ] as AriaSnapshotJSON)
    expect(out).toEqual([
      { role: 'generic', ref: 'ab12e9', cursor: 'pointer', text: 'Menu' },
    ])
  })
  test('non-interactive img is dropped entirely', () => {
    expect(
      compactTree([
        {
          role: 'main',
          children: [{ role: 'img', name: 'diagram of worker lifecycle' }],
        },
      ] as AriaSnapshotJSON)
    ).toEqual([{ role: 'main' }])
  })
  test('non-interactive img with text but no descendant is still dropped', () => {
    // a plain img has neither text nor children, so the general keep
    // predicate already drops it without help from the img-specific rule —
    // this one carries text, which the general predicate would keep on its
    // own, so the assertion actually depends on the img rule firing
    expect(
      compactTree([
        { role: 'img', name: 'diagram', text: 'fallback description' },
      ] as AriaSnapshotJSON)
    ).toEqual([])
  })
  test('non-interactive img keeps an interactive descendant', () => {
    const tree = [
      {
        role: 'img',
        name: 'chart',
        children: [{ role: 'button', name: 'Zoom', ref: 'ab12e5' }],
      },
    ] as AriaSnapshotJSON
    expect(compactTree(tree)).toEqual(tree)
  })
})
