/* Holographic stage (reference concept: docs/HOPE_三场景整合.html).
 * Dark sci-fi scenes used for selected answers and for browsing: body chamber, course orbit, data prism.
 * Backdrops are generated illustrations (not patient images); every number shown still comes from facts.
 */
import { useMemo } from 'react'
import { SeriesChart } from './charts'
import { ImageFigure } from './blocks'
import { dateLabel } from './data'
import { useStage } from './stage'
import type { Block } from './types'
import { FactValue, UnitText } from './ui'

const bg = (name: string) => `${import.meta.env.BASE_URL}holo/${name}.jpg`

// pin positions over the anatomy backdrop (% of the 4:5 stage). Patient's right = viewer's left.
const HOLO_REGIONS: Record<string, { x: number; y: number; label: string; side: 'l' | 'r' }> = {
  right_scapula: { x: 41.5, y: 29.5, label: '右肩胛区', side: 'l' },
  left_breast: { x: 55.5, y: 34.5, label: '左乳', side: 'r' },
  right_iliac: { x: 44.5, y: 45.5, label: '右髂骨', side: 'l' },
  left_upper_arm: { x: 60.5, y: 37, label: '左上臂', side: 'r' },
  right_abdominal_wall: { x: 46, y: 41, label: '右腹壁', side: 'l' },
  right_groin: { x: 47, y: 49.5, label: '右腹股沟', side: 'l' },
}
// glass card docks along the stage edges
const DOCK_Y = { l: [16, 36, 56, 76], r: [22, 46, 70] }

// reference layout: stage cards alternate left/right from bottom to top along the spiral
const ORBIT_POS = [[4, 78], [60, 70], [4, 60], [60, 52], [4, 42], [60, 34], [4, 24], [60, 16]]
const ORBIT_PATH = 'M34 106 C92 94 90 78 50 72 S2 62 36 50 S92 36 60 28 S14 18 40 10'
const PRISM_POS = [[3, 12], [3, 38], [3, 64], [65, 12], [65, 38], [65, 64]]

export function HoloLayer({ sceneId, onClose }: { sceneId: string; onClose?: () => void }) {
  const { bundle } = useStage()
  const b = bundle.blocks.find(x => x.id === sceneId)
  if (!b) return null
  return (
    <div className="holo-layer" data-anchor-root>
      <div className="holo-inner">
        {b.scene === 'anatomy' && <Anatomy b={b} />}
        {b.scene === 'orbit' && <Orbit b={b} />}
        {b.scene === 'prism' && <Prism b={b} />}
      </div>
      {onClose && <button className="holo-close" onClick={onClose}>退出全息舞台 · Esc</button>}
    </div>
  )
}

function StageFrame({ b, img, en, children }: { b: Block; img: string; en: string; children: React.ReactNode }) {
  return (
    <div className="holo-stage" data-anchor={b.id}>
      <img className="holo-bg" src={bg(img)} alt="生成的全息场景背景（示意，非患者影像）" />
      <div className="holo-scan" />
      <div className="holo-title"><small>{en}</small><strong>{b.label}</strong></div>
      {children}
      <div className="holo-foot">{b.note}</div>
    </div>
  )
}

// ------------------------------------------------------------------ body chamber

function Anatomy({ b }: { b: Block }) {
  const { bundle, state } = useStage()
  const body = bundle.blocks.find(x => x.type === 'body_map')!
  const pins = body.pins!.filter(p => b.pin_refs?.includes(p.id))
  const active = state.visual.pins.filter(id => pins.some(p => p.id === id))
  const docks = useMemo(() => {
    const used = { l: 0, r: 0 }
    return pins.map(p => { const reg = HOLO_REGIONS[p.region]; return { p, reg, y: DOCK_Y[reg.side][used[reg.side]++ % DOCK_Y[reg.side].length] } })
  }, [pins])
  const imgOf = (ann: string) => bundle.blocks.find(x => x.annotations?.some(a => a.id === ann))!
  const shown = (active.length ? pins.filter(p => active.includes(p.id)) : pins.slice(-3))
  return (
    <>
      <StageFrame b={b} img="anatomy" en="HOLOGRAPHIC BODY CHAMBER · EXTRAMEDULLARY DISEASE">
        <svg className="holo-links" viewBox="0 0 100 125" preserveAspectRatio="none">
          {docks.map(({ p, reg, y }) => (
            <path key={p.id} className={active.includes(p.id) ? 'on' : ''}
              d={`M${reg.x} ${reg.y * 1.25} L${reg.side === 'l' ? 25 : 75} ${(y + 6) * 1.25}`} />
          ))}
        </svg>
        {docks.map(({ p, reg }) => (
          <button key={p.id} data-anchor={p.id} className={`holo-pin ${active.includes(p.id) ? 'on' : active.length ? 'dim' : ''}`}
            style={{ left: `${reg.x}%`, top: `${reg.y}%` }} title={reg.label}><span>{reg.label}</span></button>
        ))}
        {docks.map(({ p, reg, y }) => (
          <div key={p.id} className={`holo-dock ${reg.side} ${active.includes(p.id) ? 'on' : active.length ? 'dim' : ''}`} style={{ top: `${y}%` }}>
            <b>{reg.label}</b><small>{dateLabel(bundle.facts[p.date].eff.date)}</small>
            <ImageFigure b={{ ...imgOf(p.annotation), annotations: imgOf(p.annotation).annotations!.filter(a => a.id === p.annotation) }} anchored={false} />
          </div>
        ))}
      </StageFrame>
      <aside className="holo-side">
        <div className="holo-kicker">病灶部位 · 原稿影像</div>
        {shown.map(p => {
          const img = imgOf(p.annotation)
          return (
            <div key={p.id} className="holo-card">
              <div className="holo-card-head"><b>{HOLO_REGIONS[p.region].label}</b><FactValue id={p.date} /><span className="src">P{img.slide}</span></div>
              <ImageFigure b={{ ...img, annotations: img.annotations!.filter(a => a.id === p.annotation) }} />
              {p.facts.map(f => <div key={f}><FactValue id={f} /></div>)}
            </div>
          )
        })}
      </aside>
    </>
  )
}

// ------------------------------------------------------------------ course orbit

function Orbit({ b }: { b: Block }) {
  const { bundle, state } = useStage()
  const phases = bundle.blocks.find(x => x.type === 'phases')!.phases!.filter(p => b.phase_refs?.includes(p.id))
  const events = bundle.blocks.find(x => x.type === 'timeline')!.events!
  const lit = state.visual.phases
  const focus = lit.length === 1 ? lit : lit.length ? [] : []
  const d = (id: string | null) => (id ? bundle.facts[id].eff.date ?? '' : '')
  const inPhase = (ph: typeof phases[number]) => events.filter(e => { const x = d(e.date); return x >= d(ph.start) && (!ph.end || x < d(ph.end)) })
  return (
    <>
      <StageFrame b={b} img="orbit" en="CHRONOLOGY · CASE JOURNEY">
        <svg className="holo-orbit" viewBox="0 0 100 125" preserveAspectRatio="none">
          <path d={ORBIT_PATH} className="orbit-line" />
          <circle r="1.1" className="orbit-dot"><animateMotion dur="9s" repeatCount="indefinite" path={ORBIT_PATH} /></circle>
        </svg>
        {phases.map((ph, i) => {
          const [x, y] = ORBIT_POS[i % ORBIT_POS.length]
          const on = lit.includes(ph.id)
          return (
            <div key={ph.id} data-anchor={`holo.${ph.id}`} className={`holo-glass orbit-card ${i % 2 ? 'r' : 'l'} ${on ? 'on' : lit.length ? 'dim' : ''}`}
              style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${-i * 0.8}s` }}>
              <small>{dateLabel(d(ph.start)).slice(0, 7)} – {ph.end ? dateLabel(d(ph.end)).slice(0, 7) : '至今'}</small>
              <strong>{ph.label}</strong>
              <em>{inPhase(ph).length} 个事件</em>
            </div>
          )
        })}
      </StageFrame>
      <aside className="holo-side">
        <div className="holo-kicker">{focus.length ? '当前阶段' : '全部治疗阶段'}</div>
        {(focus.length ? phases.filter(p => focus.includes(p.id)) : phases).map(ph => (
          <div key={ph.id} className="holo-card compact">
            <div className="holo-card-head"><b>{ph.label}</b><span className="mono">{dateLabel(d(ph.start)).slice(0, 7)}</span></div>
            {inPhase(ph).slice(0, focus.length ? 12 : 3).map(e => (
              <div key={e.id} className="holo-ev"><span className="mono">{dateLabel(d(e.date))}</span>{e.label}</div>
            ))}
            {!focus.length && inPhase(ph).length > 3 && <div className="holo-more">另有 {inPhase(ph).length - 3} 个事件</div>}
            {focus.length > 0 && ph.chapter.map(u => <UnitText key={u} id={u} as="p" />)}
          </div>
        ))}
      </aside>
    </>
  )
}

// ------------------------------------------------------------------ data prism

function Prism({ b }: { b: Block }) {
  const { bundle, state } = useStage()
  const all = bundle.blocks.find(x => x.type === 'series_group')!.series!
  const series = (b.series_refs ?? []).map(id => all.find(s => s.id === id)!).filter(Boolean)
  const active = state.visual.chartDraw.find(id => series.some(s => s.id === id)) ?? series[0]?.id
  return (
    <>
      <StageFrame b={b} img="prism" en="FLOATING DATA PRISM">
        {series.map((s, i) => {
          const [x, y] = PRISM_POS[i % PRISM_POS.length]
          const last = s.points[s.points.length - 1].fact
          return (
            <div key={s.id} data-anchor={`holo.${s.id}`} className={`holo-glass prism-card ${x > 50 ? 'r' : 'l'} ${s.id === active ? 'on' : 'dim'}`}
              style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${-i * 0.9}s` }}>
              <small>{s.label}</small>
              <strong><FactValue id={last} showDate /></strong>
              <SeriesChart series={s} height={46} mini dark />
            </div>
          )
        })}
      </StageFrame>
      <aside className="holo-side">
        <div className="holo-kicker">数据棱面 · 展开</div>
        {series.filter(s => s.id === active).map(s => (
          <div key={s.id} className="holo-card chart">
            <div className="holo-card-head"><b>{s.label}</b><span className="mono">{s.points.length} 个点</span></div>
            <div className="holo-chart"><SeriesChart series={s} height={300} /></div>
          </div>
        ))}
      </aside>
    </>
  )
}

export function HoloPreview({ b, onOpen }: { b: Block; onOpen: () => void }) {
  return (
    <section className="card holo-preview" data-anchor={`${b.id}#preview`}>
      <button onClick={onOpen}>
        <img src={bg(b.scene!)} alt="" />
        <span className="hp-text"><small>全息舞台</small><strong>{b.label}</strong><em>{b.note}</em><i>进入 →</i></span>
      </button>
    </section>
  )
}
