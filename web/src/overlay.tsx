import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { anchorElement, anchorRect } from './anchors'
import { FigureFacts, ImageFigure } from './blocks'
import { asset } from './data'
import { useStage } from './stage'
import type { Claim } from './types'
import { useUI } from './ui'

/** Tween the page scroller so the element is centred (not interruptible like native smooth scroll). */
function scrollToCenter(el: Element) {
  const sc = el.closest('.scroll') as HTMLElement | null
  if (!sc) return
  const r = el.getBoundingClientRect(), box = sc.getBoundingClientRect()
  const target = Math.max(0, sc.scrollTop + (r.top - box.top) - Math.max(24, (sc.clientHeight - r.height) / 2))
  const from = sc.scrollTop, dist = target - from, dur = 700, t0 = performance.now()
  let raf = 0
  const ease = (x: number) => 1 - Math.pow(1 - x, 3)
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / dur)
    sc.scrollTop = from + dist * ease(k)
    if (k < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

/** Re-measure anchor rects for a while after each step (layout/scroll/animations settle). */
function useRects(ids: string[], key: unknown) {
  const [rects, setRects] = useState<Record<string, DOMRect | null>>({})
  useEffect(() => {
    let raf = 0, alive = true
    const until = performance.now() + 2500
    const tick = () => {
      if (!alive) return
      const next: Record<string, DOMRect | null> = {}
      for (const id of ids) next[id] = anchorRect(id)
      setRects(next)
      if (performance.now() < until) raf = requestAnimationFrame(tick)
    }
    tick()
    const onScroll = () => { const n: Record<string, DOMRect | null> = {}; for (const id of ids) n[id] = anchorRect(id); setRects(n) }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|'), key])
  return rects
}

export function StageLayer() {
  const { state, bundle } = useStage()
  const v = state.visual
  const active = !!state.tour && (state.status === 'playing' || state.status === 'paused' || state.status === 'done')

  // camera: bring the target into view
  useLayoutEffect(() => {
    if (!active || !v.camera || v.images.length) return
    const el = anchorElement(v.camera) ?? anchorElement(v.chartDraw[0] ?? '')
    if (!el) return
    return scrollToCenter(el)
  }, [state.epoch, active, v.camera, v.images.length, v.chartDraw])

  const spotIds = active ? [...new Set([...(v.images.length ? [] : v.spotlight.length ? v.spotlight : v.camera ? [v.camera] : []),
    ...v.pointPulse, ...v.cells, ...v.rows, ...v.compareRows, ...v.pins, ...v.pulse])] : []
  const rects = useRects(spotIds, state.epoch)
  const calloutRects = useRects(active ? v.callouts.map(c => c.target) : [], state.epoch)
  if (!active) return null
  const holes = Object.values(rects).filter(Boolean) as DOMRect[]
  const imgs = v.images.map(id => bundle.blocks.find(b => b.id === id)!).filter(Boolean)

  return (
    <div className="stage-layer" aria-live="polite">
      {!imgs.length && (
        <svg className="spot-mask" width="100%" height="100%">
          <defs>
            <mask id="spot">
              <rect width="100%" height="100%" fill="white" />
              {holes.map((r, i) => <rect key={i} x={r.left - 10} y={r.top - 10} width={r.width + 20} height={r.height + 20} rx="12" fill="black" className="hole" />)}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(15,30,55,.42)" mask="url(#spot)" />
          {holes.map((r, i) => <rect key={i} x={r.left - 10} y={r.top - 10} width={r.width + 20} height={r.height + 20} rx="12" className="hole-ring" />)}
        </svg>
      )}
      {imgs.length > 0 && (
        <div className="stage-images">
          {imgs.map(b => (
            <div className="stage-image" key={b.id + state.epoch}>
              <div className="card-head"><h4>{b.label}</h4><span className="src-chip">P{b.slide}</span></div>
              <ImageFigure b={b} large />
              <FigureFacts b={b} />
            </div>
          ))}
        </div>
      )}
      {v.callouts.map(c => <Callout key={c.target + state.epoch} rect={calloutRects[c.target]} claim={c.claim} />)}
    </div>
  )
}

function Callout({ rect, claim }: { rect: DOMRect | null | undefined; claim: Claim }) {
  if (!rect || !claim) return null
  const right = rect.left < window.innerWidth * 0.55
  const x = right ? rect.right + 36 : rect.left - 36
  const y = Math.max(80, rect.top - 30)
  return (
    <>
      <svg className="callout-line" width="100%" height="100%"><line x1={right ? rect.right : rect.left} y1={rect.top + rect.height / 2} x2={x} y2={y + 18} /></svg>
      <div className={`callout ${right ? '' : 'left'}`} style={{ left: right ? x : undefined, right: right ? undefined : window.innerWidth - x, top: y }}>
        {claim.text}{claim.flags?.map(f => <span key={f} className={`badge badge-${f === 'image_reading' ? 'image' : 'pending'}`}>{f === 'image_reading' ? '图读' : '待审'}</span>)}
      </div>
    </>
  )
}

/* Lift layer: the step's highlighted content is copied out of the page, enlarged and flown to the
 * foreground (FLIP with the Web Animations API); on the next step it flies back to its place.
 * Canvas content (charts) is copied pixel-for-pixel. The in-page original stays, dimmed by the mask. */
export function LiftLayer() {
  const { state } = useStage()
  const host = useRef<HTMLDivElement>(null)
  const v = state.visual
  const active = !!state.tour && (state.status === 'playing' || state.status === 'paused' || state.status === 'done') && !v.images.length

  useEffect(() => {
    const root = host.current
    if (!root || !active) return
    // what to lift: small, specific targets first; whole blocks only if nothing more specific
    const specific = [...v.cells, ...v.rows, ...v.compareRows, ...v.pins, ...v.pulse]
    const blocks = [...v.chartDraw, ...v.spotlight]
    const ids = [...new Set(specific.length ? specific : blocks)].slice(0, 3)
    let cancelled = false
    const cards: { el: HTMLElement; from: DOMRect; to: { x: number; y: number; s: number } }[] = []
    const timer = setTimeout(() => {   // let the camera scroll settle first
      if (cancelled) return
      const vw = window.innerWidth, vh = window.innerHeight
      const topBand = 70, usableH = vh * 0.46
      // lift meaningful units: a value inside a table lifts its whole row; a timeline marker lifts its label
      const pick = (id: string) => {
        let el = anchorElement(id) as HTMLElement | null
        if (!el) return null
        if (v.cells.includes(id)) el = (el.closest('tr') as HTMLElement | null) ?? el
        if (el.classList.contains('tl-ev')) el = (el.querySelector('.tl-label') as HTMLElement | null) ?? el
        const r = el.getBoundingClientRect()
        return r.width || r.height ? { id, el, r } : { id, el, r: anchorRect(id) }
      }
      const els = ids.map(pick).filter((x): x is { id: string; el: HTMLElement; r: DOMRect } => !!x && !!x.r)
        .filter(x => x.r.width > 8 && x.r.width * x.r.height < vw * vh * 0.5)
      if (!els.length) return
      const slotH = usableH / els.length
      els.forEach(({ el, r }, i) => {
        let clone = el!.cloneNode(true) as HTMLElement
        if (el!.tagName === 'TR') {   // keep column layout for table rows
          const table = document.createElement('table'); table.className = 'data'
          const cols = el!.parentElement?.parentElement?.querySelector('tr')
          const widths = cols ? [...cols.children].map(c => (c as HTMLElement).getBoundingClientRect().width) : []
          const tb = document.createElement('tbody'); tb.appendChild(clone); table.appendChild(tb)
          ;[...clone.children].forEach((c, k) => { if (widths[k]) (c as HTMLElement).style.width = `${widths[k]}px` })
          clone = table
        }
        clone.querySelectorAll('[data-anchor]').forEach(n => n.removeAttribute('data-anchor'))
        clone.removeAttribute('data-anchor')
        const srcCanvases = el.querySelectorAll('canvas'), dstCanvases = clone.querySelectorAll('canvas')
        dstCanvases.forEach((c, k) => { const s = srcCanvases[k]; c.width = s.width; c.height = s.height; c.getContext('2d')?.drawImage(s, 0, 0) })
        const card = document.createElement('div')
        card.className = 'lift-card'
        Object.assign(card.style, { left: `${r!.left}px`, top: `${r!.top}px`, width: `${r!.width}px`, height: `${r!.height}px` })
        card.appendChild(clone)
        root.appendChild(card)
        const s = Math.max(1.15, Math.min(2.6, (vw * 0.62) / r!.width, (slotH - 16) / r!.height))
        const cx = vw / 2 + 140, cy = topBand + slotH * i + slotH / 2
        const to = { x: cx - (r!.left + r!.width / 2), y: cy - (r!.top + r!.height / 2), s }
        card.animate([
          { transform: 'translate(0,0) scale(1)', boxShadow: '0 0 0 rgba(14,165,198,0)' },
          { transform: `translate(${to.x}px, ${to.y}px) scale(${s})`, boxShadow: '0 24px 70px rgba(10,40,80,.35), 0 0 0 2px rgba(14,165,198,.9)' },
        ], { duration: 750, easing: 'cubic-bezier(.2,.9,.25,1.15)', fill: 'forwards', delay: i * 120 })
        cards.push({ el: card, from: r!, to })
      })
    }, 650)
    return () => {
      cancelled = true
      clearTimeout(timer)
      // fly back to where each piece came from, then remove
      for (const c of cards) {
        const back = c.el.animate([
          { transform: `translate(${c.to.x}px, ${c.to.y}px) scale(${c.to.s})`, opacity: 1 },
          { transform: 'translate(0,0) scale(1)', opacity: 0 },
        ], { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
        back.finished.then(() => c.el.remove()).catch(() => c.el.remove())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.epoch, active])

  return <div className="lift-layer" ref={host} aria-hidden="true" />
}

export function Caption() {
  const { state, next, prev, pause, resume, cancel, setSpeed } = useStage()
  const { openSource } = useUI()
  const t = state.tour
  if (!t) return null
  if (state.index < 0) {
    return (
      <div className="caption-bar">
        <div className="cap-head"><span className="cap-q">实时回答 · {t.question}</span><span className="cap-step">模型正在编排回答计划…</span></div>
        <div className="cap-body"><p className="claim generating"><i className="spinner" />正在检索原稿内容并逐步校验，第一步通过校验后立即开始播放（过程见下方 Agent 过程面板）</p></div>
        <div className="cap-ctrl"><button className="ghost" onClick={() => cancel('用户结束')}>结束</button></div>
      </div>
    )
  }
  const step = t.steps[state.index]
  const liveNote = state.live && !state.live.finished ? '（后续步骤生成中）' : ''
  return (
    <div className="caption-bar">
      <div className="cap-head">
        <span className="cap-q">{t.id === 'LIVE' ? '实时回答' : t.id} · {t.question}</span>
        <span className="cap-step">{state.index + 1}/{t.steps.length}{liveNote} · {step.title}</span>
      </div>
      <div className="cap-body" key={state.epoch}>
        {step.say.map(c => (
          <p key={c.claim} className={`claim claim-${c.type}`}>
            {c.verbatim && <span className="quote-mark" title="原文引用">原文</span>}
            {c.text}
            {c.flags?.map(f => <span key={f} className={`badge badge-${f === 'image_reading' ? 'image' : 'pending'}`}>{f === 'image_reading' ? '含图读数据' : '含待审修正'}</span>)}
            <button className="cite" onClick={() => openSource(c.cite[0])} title={`引用：${c.cite.join(', ')}`}>出处</button>
          </p>
        ))}
      </div>
      <div className="cap-ctrl">
        <button onClick={prev} disabled={state.index === 0}>上一步</button>
        {state.status === 'playing' ? <button onClick={pause}>暂停</button> : <button onClick={resume}>{state.status === 'done' ? '继续' : '播放'}</button>}
        <button onClick={next}>下一步</button>
        <select value={state.speed} onChange={e => setSpeed(+e.target.value)} aria-label="倍速">
          {[0.5, 1, 1.5, 2].map(s => <option key={s} value={s}>{s}×</option>)}
        </select>
        <button className="ghost" onClick={() => cancel('用户结束')}>结束</button>
        <div className="progress">{t.steps.map((s, i) => <i key={s.id} className={i < state.index ? 'past' : i === state.index ? 'now' : ''} />)}</div>
      </div>
    </div>
  )
}

export function SourceViewer({ factId, slide, onClose }: { factId?: string; slide?: number; onClose: () => void }) {
  const { bundle } = useStage()
  const f = factId ? bundle.facts[factId] : undefined
  const unit = f?.type === 'unit' ? f : f?.unit ? bundle.facts[f.unit] : undefined
  const n = slide ?? f?.slide
  if (!n) return null
  const box = unit?.bbox
  const img = f?.image
  return (
    <div className="fly-backdrop" onClick={onClose}>
      <div className="source-card" onClick={e => e.stopPropagation()}>
        <div className="card-head"><h4>原稿第 {n} 页{f ? ` · ${f.id}` : ''}</h4><button className="x" onClick={onClose}>×</button></div>
        <div className="source-slide" style={{ aspectRatio: String(bundle.aspect) }}>
          <img src={asset(`slides/slide-${String(n).padStart(2, '0')}.png`)} alt={`第${n}页`} />
          {box && <div className="source-box" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }} />}
        </div>
        {f && (
          <div className="source-meta">
            <div><b>原文：</b>{f.raw ?? '（无原文：推断或图读）'}</div>
            {img && <div><b>来源图片：</b>{img}（图读数据）</div>}
            {f.review && <div><b>审核：</b>{f.review.status}{f.review.issue ? ` · ${f.review.issue}` : ''}{f.review.basis ? ` · 依据：${f.review.basis}` : ''}</div>}
            {f.date_note && <div><b>日期说明：</b>{f.date_note}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
