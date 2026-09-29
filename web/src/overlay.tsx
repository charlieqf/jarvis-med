import { useEffect, useLayoutEffect, useState } from 'react'
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

export function Caption() {
  const { state, next, prev, pause, resume, cancel, setSpeed } = useStage()
  const { openSource } = useUI()
  const t = state.tour
  if (!t) return null
  const step = t.steps[state.index]
  return (
    <div className="caption-bar">
      <div className="cap-head">
        <span className="cap-q">{t.id} · {t.question}</span>
        <span className="cap-step">{state.index + 1}/{t.steps.length} · {step.title}</span>
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
