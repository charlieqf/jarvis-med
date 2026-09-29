// Anchor registry: DOM anchors are found via [data-anchor]; non-DOM anchors (chart points)
// register a resolver that returns their on-screen rect.
type Resolver = () => DOMRect | null
const resolvers = new Map<string, Resolver>()

export function registerAnchor(id: string, fn: Resolver) {
  resolvers.set(id, fn)
  return () => { if (resolvers.get(id) === fn) resolvers.delete(id) }
}

export function anchorElement(id: string): Element | null {
  const all = document.querySelectorAll(`[data-anchor="${CSS.escape(id)}"]`)
  // prefer an instance inside the stage overlay (opened images) over the in-page one
  for (const el of all) if (el.closest('.stage-layer') || el.closest('.holo-layer')) return el
  return all[0] ?? null
}

export function anchorRect(id: string): DOMRect | null {
  const r = resolvers.get(id)
  if (r) return r()
  const el = anchorElement(id)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width || rect.height) return rect
  // zero-size wrappers (e.g. timeline event markers) -> union of their visible children
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  el.querySelectorAll('*').forEach(c => {
    const x = c.getBoundingClientRect()
    if (!x.width && !x.height) return
    left = Math.min(left, x.left); top = Math.min(top, x.top); right = Math.max(right, x.right); bottom = Math.max(bottom, x.bottom)
  })
  return right > left ? new DOMRect(left, top, right - left, bottom - top) : null
}

// test hook: lets automated UI tests resolve anchors exactly like the stage does
;(window as unknown as { __anchorRect: typeof anchorRect }).__anchorRect = anchorRect
