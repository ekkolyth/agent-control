import {
  type AriaSnapshot,
  generateAriaTree,
  renderAriaTreeAsJSON,
} from './vendor/playwright/injected/ariaSnapshot'
import { isElementVisible } from './vendor/playwright/injected/domUtils'
import type {
  AriaNodeJSON,
  AriaSnapshotJSON,
} from './vendor/playwright/isomorphic/ariaSnapshot'
import { renderAriaSnapshotAsYaml } from './vendor/playwright/isomorphic/ariaSnapshotRenderer'

type SnapshotMode = 'none' | 'compact' | 'full'

type SnapshotResult = {
  url: string
  title: string
  snapshot?: string
  hash: string
}

type ResolveRefResult =
  | { ok: true; element: Element }
  | { ok: false; code: 'STALE_REF' | 'REF_NOT_FOUND'; message: string }

// interactive roles per the plan's Clarifications — Playwright's `ai` mode
// assigns a ref to nearly every visible node, so compact mode has to name
// its own, narrower set rather than "anything with a ref"
const INTERACTIVE_ROLES = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem',
])

const LANDMARK_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'form',
  'search',
  'region',
])

const TEXT_CLIP_LENGTH = 80
const REF_PATTERN = /^([a-z0-9]{4})e(\d+)$/
const DEFAULT_MAX_CHARS = 40000

const refPrefix = Math.random().toString(36).slice(2, 6)

let currentSnapshot: AriaSnapshot | null = null
let highestRef = 0

function getRefPrefix(): string {
  return refPrefix
}

function isInteractive(node: AriaNodeJSON): boolean {
  return node.cursor === 'pointer' || INTERACTIVE_ROLES.has(node.role)
}

function clipText(text: string): string {
  return text.length > TEXT_CLIP_LENGTH
    ? `${text.slice(0, TEXT_CLIP_LENGTH)}…`
    : text
}

function compactChild(child: AriaNodeJSON | string): {
  node?: AriaNodeJSON
  text?: string
} {
  if (typeof child === 'string') return { text: clipText(child) }
  const node = compactNode(child)
  return node ? { node } : {}
}

function compactNode(node: AriaNodeJSON): AriaNodeJSON | undefined {
  const compactedChildren: NonNullable<AriaNodeJSON['children']> = []
  let hasKeptDescendant = false
  for (const child of node.children ?? []) {
    const compacted = compactChild(child)
    if (compacted.node) {
      compactedChildren.push(compacted.node)
      hasKeptDescendant = true
    } else if (compacted.text !== undefined) {
      compactedChildren.push(compacted.text)
    }
  }

  // a void <img> carries nothing worth keeping on its own, but a
  // role="img" container can still wrap interactive descendants
  if (node.role === 'img' && !isInteractive(node) && !hasKeptDescendant) {
    return undefined
  }

  const landmark = LANDMARK_ROLES.has(node.role)
  const keep =
    isInteractive(node) ||
    node.role === 'heading' ||
    landmark ||
    hasKeptDescendant ||
    Boolean(node.text)
  if (!keep) return undefined

  if (landmark && !hasKeptDescendant) {
    return node.name === undefined
      ? { role: node.role }
      : { role: node.role, name: node.name }
  }

  const result: AriaNodeJSON = { ...node }
  if (compactedChildren.length > 0) result.children = compactedChildren
  else delete result.children
  if (!isInteractive(node)) {
    delete result.ref
    delete result.cursor
  }
  if (result.text !== undefined) result.text = clipText(result.text)
  return result
}

function compactTree(json: AriaSnapshotJSON): AriaSnapshotJSON {
  const out: AriaSnapshotJSON = []
  for (const node of json) {
    const compacted = compactNode(node)
    if (compacted) out.push(compacted)
  }
  return out
}

// true when the renderer put a trailing colon on this node's own line,
// i.e. it promised prop or child lines that must immediately follow
function nodeExpectsMoreLines(node: AriaNodeJSON): boolean {
  return (
    node.url !== undefined ||
    node.placeholder !== undefined ||
    (node.children?.length ?? 0) > 0
  )
}

function renderWithLineMap(
  entries: AriaSnapshotJSON,
  lineToNode: Map<number, AriaNodeJSON>
): string {
  return renderAriaSnapshotAsYaml(entries, { lineToNode })
}

function renderWithBudget(
  json: AriaSnapshotJSON,
  maxChars: number,
  render: (
    entries: AriaSnapshotJSON,
    lineToNode: Map<number, AriaNodeJSON>
  ) => string = renderWithLineMap
): string {
  const lineToNode = new Map<number, AriaNodeJSON>()
  const rendered = render(json, lineToNode)
  const lines = rendered === '' ? [] : rendered.split('\n')

  let usedLength = 0
  let kept = 0
  for (; kept < lines.length; kept++) {
    const line = lines[kept]!
    const candidateLength =
      kept === 0 ? line.length : usedLength + 1 + line.length
    if (candidateLength > maxChars) break
    usedLength = candidateLength
  }
  if (kept >= lines.length) return rendered

  // a header line whose props or children got entirely cut carries no
  // information beyond its own row, so drop it too — repeat in case that
  // exposes an ancestor header left in the same state
  while (kept > 0) {
    const last = lineToNode.get(kept - 1)
    if (!last || !nodeExpectsMoreLines(last)) break
    kept--
  }

  const body = lines.slice(0, kept).join('\n')
  let droppedCount = 0
  for (const lineIndex of lineToNode.keys()) {
    if (lineIndex >= kept) droppedCount++
  }
  return `${body}\n[snapshot truncated: ${droppedCount} more nodes, call browser_snapshot for full tree]`
}

function hashPage(url: string, yaml: string): string {
  const input = `${url}\n${yaml.replace(/ \[ref=[^\]]+\]/g, '')}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function generateSnapshot(
  doc: Document,
  opts: { mode: SnapshotMode; maxChars?: number }
): SnapshotResult {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const snapshot = generateAriaTree(doc.documentElement, {
    mode: 'ai',
    refPrefix: getRefPrefix(),
  })
  currentSnapshot = snapshot
  for (const ref of snapshot.info.keys()) {
    const match = REF_PATTERN.exec(ref)
    const n = match?.[2]
    if (n !== undefined) highestRef = Math.max(highestRef, Number(n))
  }

  let json = renderAriaTreeAsJSON(snapshot, { mode: 'ai' }).json
  if (opts.mode === 'compact') json = compactTree(json)
  const yaml = renderWithBudget(json, maxChars)
  const hash = hashPage(doc.location.href, yaml)

  return {
    url: doc.location.href,
    title: doc.title,
    hash,
    ...(opts.mode === 'none' ? {} : { snapshot: yaml }),
  }
}

function resolveRef(ref: string): ResolveRefResult {
  const match = REF_PATTERN.exec(ref)
  if (!match) {
    return {
      ok: false,
      code: 'REF_NOT_FOUND',
      message: `malformed ref: ${ref}`,
    }
  }
  const [, prefix, numStr] = match
  if (prefix !== getRefPrefix()) {
    return {
      ok: false,
      code: 'STALE_REF',
      message: 'ref is from a previous page',
    }
  }
  const info = currentSnapshot?.info.get(ref)
  if (info) {
    // info pins the node as it was when the snapshot ran; a re-render since
    // can detach or hide it, and either reports an all-zero rect that would
    // land the click at the viewport corner. Same visibility gate that
    // granted the ref in the first place
    if (!info.element.isConnected) {
      return {
        ok: false,
        code: 'STALE_REF',
        message: 'element was removed from the page',
      }
    }
    if (!isElementVisible(info.element)) {
      return {
        ok: false,
        code: 'STALE_REF',
        message: 'element is no longer visible',
      }
    }
    return { ok: true, element: info.element }
  }
  if (Number(numStr) <= highestRef) {
    return {
      ok: false,
      code: 'STALE_REF',
      message: 'element is no longer in the snapshot',
    }
  }
  return { ok: false, code: 'REF_NOT_FOUND', message: `unknown ref: ${ref}` }
}

export type { SnapshotMode, SnapshotResult }
export {
  compactTree,
  generateSnapshot,
  getRefPrefix,
  hashPage,
  isInteractive,
  renderWithBudget,
  resolveRef,
}
