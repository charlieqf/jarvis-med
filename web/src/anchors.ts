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
  for (const el of all) if (el.closest('.stage-layer')) return el
  return all[0] ?? null
}

export function anchorRect(id: string): DOMRect | null {
  const r = resolvers.get(id)
  if (r) return r()
  const el = anchorElement(id)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return rect.width || rect.height ? rect : null
}
