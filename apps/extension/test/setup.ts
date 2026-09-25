function isHidden(el: Element): boolean {
  return el.closest('[hidden]') !== null
}

function rect(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON() {
      return this
    },
  }
}

if (typeof Element !== 'undefined') {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (isHidden(this)) return rect(0, 0, 0, 0) as DOMRect

    const all = Array.from(document.querySelectorAll('*'))
    const index = Math.max(all.indexOf(this), 0)
    return rect(0, index * 24, 200, 20) as DOMRect
  }

  Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
    return rect(0, 0, 50, 16) as DOMRect
  }

  // happy-dom defines checkVisibility natively and it returns true even
  // inside [hidden], so an "only if undefined" override here never installed
  // and would have been dead code anyway; the zero rect above is what
  // actually distinguishes a hidden element
}

if (typeof window !== 'undefined') {
  const nativeGetComputedStyle = window.getComputedStyle.bind(window)

  // happy-dom reports visibility: "" (not "visible") for any element with no
  // explicit declaration, which fails Playwright's computeBox visibility gate
  // before the rect is ever consulted
  window.getComputedStyle = ((element: Element, pseudoElt?: string | null) => {
    const style = nativeGetComputedStyle(element, pseudoElt)
    if (style.visibility !== '') return style

    return new Proxy(style, {
      get: (target, prop, receiver) =>
        prop === 'visibility' ? 'visible' : Reflect.get(target, prop, receiver),
    })
  }) as typeof window.getComputedStyle
}
