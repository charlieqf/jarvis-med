import { createContext, Fragment, useContext } from 'react'
import type { ReactNode } from 'react'
import { badges, pretty, stripBullet } from './data'
import { useFlags, useStage } from './stage'
import type { Fact } from './types'

// ------------------------------------------------------------------ UI-level context (source viewer, lightbox)

export interface UI {
  openSource: (factId: string) => void
  openSlide: (n: number) => void
}
export const UICtx = createContext<UI>({ openSource: () => {}, openSlide: () => {} })
export const useUI = () => useContext(UICtx)

export function Badges({ fact }: { fact?: Fact }) {
  const b = badges(fact)
  if (!b.length) return null
  return <>{b.map(x => <span key={x.key + x.text} className={`badge badge-${x.key}`} title={x.title}>{x.text}</span>)}</>
}

/** One value fact, shown with its source notation, anchor and badges. */
export function FactValue({ id, showDate = false }: { id: string; showDate?: boolean }) {
  const { bundle } = useStage()
  const { openSource } = useUI()
  const f = bundle.facts[id]
  const flags = useFlags(id)
  if (!f) return <span className="missing-ref">[{id}]</span>
  let text = f.raw ?? f.eff.date ?? ''
  if (f.kind === 'not_detected' && /^\d+$/.test(text)) text = '未检出'
  if (f.kind === 'missing') text = `${f.raw}（原文缺值）`
  if (!f.raw && f.type === 'date') text = (f.eff.date ?? '').replace(/-/g, '.')
  const unit = f.implied_unit && f.implied_unit.unit !== 'fraction' ? ` ${f.implied_unit.unit}` : ''
  return (
    <span data-anchor={id} key={flags.epoch}
      className={`fact k-${f.kind} ${flags.cell ? 'is-cell' : ''} ${flags.spot ? 'is-spot' : ''} ${flags.pulse ? 'is-pulse' : ''}`}
      onClick={e => { e.stopPropagation(); openSource(id) }} title="点击查看原稿出处">
      {pretty(text)}{unit}
      {showDate && f.eff.date && <span className="fact-date">{f.eff.date.replace(/-/g, '.')}</span>}
      <Badges fact={f} />
    </span>
  )
}

/** A source unit (paragraph / cell): original text with the value facts inside it made addressable. */
export function UnitText({ id, as = 'span', className = '' }: { id: string; as?: 'span' | 'p' | 'div'; className?: string }) {
  const { bundle } = useStage()
  const f = bundle.facts[id]
  const flags = useFlags(id)
  if (!f) return <span className="missing-ref">[{id}]</span>
  const text = f.raw ?? ''
  const parts: ReactNode[] = []
  let pos = 0
  for (const fid of f.inner ?? []) {
    const inner = bundle.facts[fid]
    if (!inner?.span || inner.type === 'date' || inner.span[0] < pos) continue
    if (inner.span[0] > pos) parts.push(<Emph key={`t${pos}`} text={text.slice(pos, inner.span[0])} terms={f.emphasis} />)
    parts.push(<FactValue key={fid} id={fid} />)
    pos = inner.span[1]
  }
  if (pos < text.length) parts.push(<Emph key={`t${pos}`} text={text.slice(pos)} terms={f.emphasis} />)
  const Tag = as
  return (
    <Tag data-anchor={id} key={flags.epoch}
      className={`unit ${className} ${flags.spot ? 'is-spot' : ''} ${flags.pulse ? 'is-pulse' : ''} ${flags.cell ? 'is-cell' : ''}`}>
      {parts}
    </Tag>
  )
}

function Emph({ text, terms }: { text: string; terms?: string[] }) {
  const t = pretty(stripBulletOnce(text))
  if (!terms?.length) return <>{t}</>
  const esc = terms.filter(Boolean).map(s => pretty(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!esc.length) return <>{t}</>
  const re = new RegExp(`(${esc.join('|')})`, 'g')
  return <>{t.split(re).map((s, i) => i % 2 ? <mark key={i} className="em" title="原稿中标红强调">{s}</mark> : <Fragment key={i}>{s}</Fragment>)}</>
}

// strip list bullets typed into the slide ("- ", "· ") only at the very start of a unit
function stripBulletOnce(t: string) { return t.startsWith('-') || t.startsWith('·') ? stripBullet(t) : t }

export function Title({ ids, level = 3 }: { ids?: string[]; level?: 2 | 3 | 4 }) {
  if (!ids?.length) return null
  const H = `h${level}` as 'h2' | 'h3' | 'h4'
  return <H className="block-title">{ids.map((u, i) => <Fragment key={u}>{i > 0 && ' '}<UnitText id={u} /></Fragment>)}</H>
}

export function SourceChip({ slide }: { slide?: number }) {
  const { openSlide } = useUI()
  if (!slide) return null
  return <button className="src-chip" onClick={() => openSlide(slide)} title="查看原版幻灯片">P{slide}</button>
}
