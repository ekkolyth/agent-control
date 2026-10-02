import {
  type ContentRequest,
  type ContentResponse,
  contentRequestSchema,
} from '../messages'
import type { createQuietDetector } from './quiet'
import { generateSnapshot, resolveRef } from './snapshot'

type HandlerDeps = {
  doc: Document
  quiet: ReturnType<typeof createQuietDetector>
}

function centerPoint(element: Element): { x: number; y: number } {
  // omitting `behavior` defaults to the scrolling box's computed
  // scroll-behavior; on a page with `scroll-behavior: smooth` the rect below
  // would be read mid-animation, so force the scroll to land synchronously
  element.scrollIntoView({
    block: 'center',
    inline: 'center',
    behavior: 'instant',
  })
  const rect = element.getBoundingClientRect()
  let x = rect.left + rect.width / 2
  let y = rect.top + rect.height / 2
  // the rect is relative to the element's own frame; CDP clicks in top-level
  // viewport coordinates, so add each enclosing iframe's content-box origin
  let frame = element.ownerDocument.defaultView?.frameElement ?? null
  while (frame) {
    const frameRect = frame.getBoundingClientRect()
    const style = getComputedStyle(frame)
    x +=
      frameRect.left + frame.clientLeft + Number.parseFloat(style.paddingLeft)
    y += frameRect.top + frame.clientTop + Number.parseFloat(style.paddingTop)
    frame = frame.ownerDocument.defaultView?.frameElement ?? null
  }
  return { x, y }
}

// an element inside an iframe belongs to that frame's realm, so instanceof
// has to check against its own window's constructors, not this script's
function realmOf(element: Element): Window & typeof globalThis {
  return element.ownerDocument.defaultView ?? window
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  // a content script runs in an isolated world: it shares the page's DOM but
  // not its JavaScript objects, so a page-side value tracker (React's or
  // otherwise) is unreachable from here, and this assignment already goes
  // through the native setter
  const realm = realmOf(element)
  const proto =
    element instanceof realm.HTMLTextAreaElement
      ? realm.HTMLTextAreaElement.prototype
      : realm.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
}

async function dispatch(
  request: ContentRequest,
  deps: HandlerDeps
): Promise<ContentResponse> {
  switch (request.kind) {
    case 'snapshot': {
      const result = generateSnapshot(deps.doc, { mode: request.mode })
      return { ok: true, result }
    }

    case 'resolveRef': {
      const resolved = resolveRef(request.ref)
      if (!resolved.ok) {
        return { ok: false, code: resolved.code, message: resolved.message }
      }
      return { ok: true, result: centerPoint(resolved.element) }
    }

    case 'waitQuiet': {
      const quiet = await deps.quiet.waitQuiet(request.quietMs, request.capMs)
      return { ok: true, result: { quiet } }
    }

    case 'clearValue': {
      const resolved = resolveRef(request.ref)
      if (!resolved.ok) {
        return { ok: false, code: resolved.code, message: resolved.message }
      }
      const { element } = resolved
      const realm = realmOf(element)
      if (
        element instanceof realm.HTMLInputElement ||
        element instanceof realm.HTMLTextAreaElement
      ) {
        setNativeValue(element, '')
      } else if (element.matches('[contenteditable]')) {
        element.textContent = ''
      } else {
        return {
          ok: false,
          code: 'INTERNAL',
          message: 'target is not editable',
        }
      }
      element.dispatchEvent(new Event('input', { bubbles: true }))
      return { ok: true, result: {} }
    }

    case 'selectOptions': {
      const resolved = resolveRef(request.ref)
      if (!resolved.ok) {
        return { ok: false, code: resolved.code, message: resolved.message }
      }
      const { element } = resolved
      if (!(element instanceof realmOf(element).HTMLSelectElement)) {
        return {
          ok: false,
          code: 'INTERNAL',
          message: 'target is not a select',
        }
      }
      for (const option of element.options) {
        option.selected = request.values.includes(option.value)
      }
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, result: {} }
    }
  }
}

async function handleContentRequest(
  raw: unknown,
  deps: HandlerDeps
): Promise<ContentResponse> {
  const parsed = contentRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, code: 'INTERNAL', message: parsed.error.message }
  }
  try {
    return await dispatch(parsed.data, deps)
  } catch (error) {
    return {
      ok: false,
      code: 'INTERNAL',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export { handleContentRequest }
