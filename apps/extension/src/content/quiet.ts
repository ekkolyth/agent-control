type QuietDetector = {
  waitQuiet(quietMs: number, capMs: number): Promise<boolean>
}

type QuietDetectorOpts = {
  observe?: (cb: () => void) => () => void
}

function defaultObserve(target: Node): (cb: () => void) => () => void {
  return (cb) => {
    const observer = new MutationObserver(cb)
    observer.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    return () => observer.disconnect()
  }
}

function createQuietDetector(
  target: Node,
  opts?: QuietDetectorOpts
): QuietDetector {
  const observe = opts?.observe ?? defaultObserve(target)

  function waitQuiet(quietMs: number, capMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      let quietTimer: ReturnType<typeof setTimeout>

      const finish = (result: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(quietTimer)
        clearTimeout(capTimer)
        unsubscribe()
        resolve(result)
      }

      const resetQuietTimer = () => {
        if (settled) return
        clearTimeout(quietTimer)
        quietTimer = setTimeout(() => finish(true), quietMs)
      }

      const unsubscribe = observe(resetQuietTimer)
      const capTimer = setTimeout(() => finish(false), capMs)
      resetQuietTimer()
    })
  }

  return { waitQuiet }
}

export type { QuietDetector }
export { createQuietDetector }
