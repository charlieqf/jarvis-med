/* Holographic stage (reference concept: docs/HOPE_三场景整合.html).
 * Dark sci-fi scenes used for selected answers and for browsing: body chamber, course orbit, data prism.
 * Motion: scenes materialise from a line of light; highlighted cards fly from their dock to the front
 * and enlarge; pins ripple; links and hotspots draw themselves; orbit cards light up in sequence.
 * Backdrops are generated illustrations (not patient images); every number shown still comes from facts.
 */
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { SeriesChart } from './charts'
import { ImageFigure } from './blocks'
import { dateLabel } from './data'
import { useStage } from './stage'
import type { Block } from './types'
import { FactValue, UnitText } from './ui'

const bg = (name: string) => `${import.meta.env.BASE_URL}holo/${name}.jpg`
const css = (o: Record<string, string | number>) => o as unknown as CSSProperties

// pin positions over the anatomy backdrop (% of the 4:5 stage). Patient's right = viewer's left.
const HOLO_REGIONS: Record<string, { x: number; y: number; label: string; side: 'l' | 'r' }> = {
  right_scapula: { x: 41.5, y: 29.5, label: '右肩胛区', side: 'l' },
  left_breast: { x: 55.5, y: 34.5, label: '左乳', side: 'r' },
  right_iliac: { x: 44.5, y: 45.5, label: '右髂骨', side: 'l' },
  left_upper_arm: { x: 60.5, y: 37, label: '左上臂', side: 'r' },
  right_abdominal_wall: { x: 46, y: 41, label: '右腹壁', side: 'l' },
  right_groin: { x: 47, y: 49.5, label: '右腹股沟', side: 'l' },
}
const DOCK_Y = { l: [14, 32, 50, 68], r: [18, 40, 62] }
const DOCK_W = 21 // % of stage width

// reference layout: stage cards alternate left/right from bottom to top along the spiral
const ORBIT_POS = [[6, 78], [61, 70], [6, 60], [61, 52], [6, 42], [61, 34], [6, 24], [61, 16]]   // card width 33% -> 6..39 / 61..94
const ORBIT_PATH = 'M34 106 C92 94 90 78 50 72 S2 62 36 50 S92 36 60 28 S14 18 40 10'
const PRISM_POS = [[3, 12], [3, 38], [3, 64], [65, 12], [65, 38], [65, 64]]

export function HoloLayer({ sceneId, onClose }: { sceneId: string; onClose?: () => void }) {
  const { bundle } = useStage()
  const b = bundle.blocks.find(x => x.id === sceneId)
  if (!b) return null
  return (
    <div className="holo-layer">
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
      <div className="holo-materialize">
        <img className="holo-bg" src={bg(img)} alt="生成的全息场景背景（示意，非患者影像）" />
        <div className="holo-scan" />
        <div className="holo-title"><small>{en}</small><strong>{b.label}</strong></div>
        {children}
        <div className="holo-foot">{b.note}</div>
      </div>
    </div>
  )
}

/** Where a set of n flown-out cards sits in the stage (in % of stage width / height). */
function frontSlots(n: number) {
  if (n <= 1) return [{ x: 21, y: 52, w: 58 }]
  if (n === 2) return [{ x: 6, y: 56, w: 43 }, { x: 51, y: 56, w: 43 }]
  return [{ x: 3, y: 60, w: 30.5 }, { x: 34.75, y: 60, w: 30.5 }, { x: 66.5, y: 60, w: 30.5 }]
}

// ------------------------------------------------------------------ body chamber

function Anatomy({ b }: { b: Block }) {
  const { bundle, state } = useStage()
  const body = bundle.blocks.find(x => x.type === 'body_map')!
  const pins = body.pins!.filter(p => b.pin_refs?.includes(p.id))
  const active = state.visual.pins.filter(id => pins.some(p => p.id === id))
  const docks = useMemo(() => {
    const used = { l: 0, r: 0 }
    return pins.map(p => {
      const reg = HOLO_REGIONS[p.region]
      const y = DOCK_Y[reg.side][used[reg.side]++ % DOCK_Y[reg.side].length]
      return { p, reg, y, x: reg.side === 'l' ? 3 : 100 - 3 - DOCK_W }
    })
  }, [pins])
  const imgOf = (ann: string) => bundle.blocks.find(x => x.annotations?.some(a => a.id === ann))!
  const only = (ann: string) => ({ ...imgOf(ann), annotations: imgOf(ann).annotations!.filter(a => a.id === ann) })
  const flying = docks.filter(d => active.includes(d.p.id))
  const slots = frontSlots(flying.length)
  return (
    <>
      <StageFrame b={b} img="anatomy" en="HOLOGRAPHIC BODY CHAMBER · EXTRAMEDULLARY DISEASE">
        <svg className="holo-links" viewBox="0 0 100 125" preserveAspectRatio="none" key={`l${state.epoch}`}>
          {docks.map(({ p, reg, y, x }) => (
            <path key={p.id} pathLength={1} className={active.includes(p.id) ? 'on' : ''}
              d={`M${reg.x} ${reg.y * 1.25} L${reg.side === 'l' ? x + DOCK_W : x} ${(y + 5) * 1.25}`} />
          ))}
        </svg>
        {docks.map(({ p, reg }) => (
          <button key={p.id + (active.includes(p.id) ? state.epoch : '')} data-anchor={p.id}
            className={`holo-pin ${active.includes(p.id) ? 'on' : active.length ? 'dim' : ''}`}
            style={{ left: `${reg.x}%`, top: `${reg.y}%` }} title={reg.label}>
            {active.includes(p.id) && <><i className="ring r1" /><i className="ring r2" /></>}
            <span>{reg.label}</span>
          </button>
        ))}
        {docks.map(({ p, reg, y, x }) => (
          <div key={p.id} className={`holo-dock ${active.includes(p.id) ? 'launched' : active.length ? 'dim' : ''}`} style={{ top: `${y}%`, left: `${x}%` }}>
            <b>{reg.label}</b><small>{dateLabel(bundle.facts[p.date].eff.date)}</small>
            <ImageFigure b={only(p.annotation)} anchored={false} />
          </div>
        ))}
        {flying.map(({ p, reg, y, x }, i) => {
          const s = slots[i]
          // start at the dock, end in the front slot: express the offset in container units
          const from = { dx: (x - s.x) * 1, dy: (y - s.y) * 1.25, k: DOCK_W / s.w }
          return (
            <div key={p.id + state.epoch} className="holo-flyout"
              style={css({ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, '--dx': `${from.dx}cqw`, '--dy': `${from.dy}cqw`, '--k': from.k, animationDelay: `${i * 0.18}s` })}>
              <div className="fo-head"><b>{reg.label}</b><FactValue id={p.date} /><span className="src">P{imgOf(p.annotation).slide}</span></div>
              <ImageFigure b={only(p.annotation)} />
              {p.facts.map(f => <div key={f} className="fo-fact"><FactValue id={f} /></div>)}
            </div>
          )
        })}
      </StageFrame>
      <aside className="holo-side">
        <div className="holo-kicker">髓外病灶 · 按时间顺序</div>
        {docks.map(({ p, reg }) => (
          <div key={p.id} className={`holo-card compact ${active.includes(p.id) ? 'hot' : active.length ? 'cold' : ''}`}>
            <div className="holo-card-head"><b>{reg.label}</b><FactValue id={p.date} /></div>
            {p.facts.map(f => <div key={f}><FactValue id={f} /></div>)}
          </div>
        ))}
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
  const focus = lit.length > 0 && lit.length <= 2 ? lit : []
  const d = (id: string | null) => (id ? bundle.facts[id].eff.date ?? '' : '')
  const inPhase = (ph: typeof phases[number]) => events.filter(e => { const x = d(e.date); return x >= d(ph.start) && (!ph.end || x < d(ph.end)) })
  const litOrder = phases.filter(p => lit.includes(p.id)).map(p => p.id)
  return (
    <>
      <StageFrame b={b} img="orbit" en="CHRONOLOGY · CASE JOURNEY">
        <svg className="holo-orbit" viewBox="0 0 100 125" preserveAspectRatio="none">
          <path d={ORBIT_PATH} className="orbit-line" />
          <path d={ORBIT_PATH} className="orbit-flow" key={`f${state.epoch}`} pathLength={1} />
          <circle r="1.1" className="orbit-dot"><animateMotion dur="9s" repeatCount="indefinite" path={ORBIT_PATH} /></circle>
          {focus.map(id => {
            const i = phases.findIndex(p => p.id === id)
            const [x, y] = ORBIT_POS[i]
            const cx = x < 50 ? x + 33 : x, cy = (y + 5) * 1.25
            return <line key={id + state.epoch} className="orbit-beam" x1={50} y1={70} x2={cx} y2={cy} pathLength={1} />
          })}
        </svg>
        {phases.map((ph, i) => {
          const [x, y] = ORBIT_POS[i % ORBIT_POS.length]
          const on = lit.includes(ph.id)
          const order = litOrder.indexOf(ph.id)
          return (
            <div key={ph.id + (on ? state.epoch : '')} data-anchor={`holo.${ph.id}`}
              className={`holo-glass orbit-card ${i % 2 ? 'r' : 'l'} ${on ? (focus.length ? 'on focus' : 'on seq') : lit.length ? 'dim' : ''}`}
              style={css({ left: `${x}%`, top: `${y}%`, '--seq': `${Math.max(order, 0) * 0.35}s`, animationDelay: `${-i * 0.8}s` })}>
              <small>{dateLabel(d(ph.start)).slice(0, 7)} – {ph.end ? dateLabel(d(ph.end)).slice(0, 7) : '至今'}</small>
              <strong>{ph.label}</strong>
              <em>{inPhase(ph).length} 个事件</em>
            </div>
          )
        })}
      </StageFrame>
      <aside className="holo-side">
        <div className="holo-kicker">{focus.length ? '当前阶段' : '全部治疗阶段'}</div>
        {(focus.length ? phases.filter(p => focus.includes(p.id)) : phases).map((ph, k) => (
          <div key={ph.id + state.epoch} className="holo-card compact" style={{ animationDelay: `${k * 0.08}s` }}>
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
  const active = state.visual.chartDraw.find(id => series.some(s => s.id === id))
  const ai = series.findIndex(s => s.id === active)
  const act = ai >= 0 ? series[ai] : null
  return (
    <>
      <StageFrame b={b} img="prism" en="FLOATING DATA PRISM">
        {series.map((s, i) => {
          const [x, y] = PRISM_POS[i % PRISM_POS.length]
          const last = s.points[s.points.length - 1].fact
          return (
            <div key={s.id} data-anchor={`holo.${s.id}`} className={`holo-glass prism-card ${x > 50 ? 'r' : 'l'} ${s.id === active ? 'launched' : active ? 'dim' : ''}`}
              style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${-i * 0.9}s` }}>
              <small>{s.label}</small>
              <strong><FactValue id={last} showDate /></strong>
              <SeriesChart series={s} height={46} mini dark />
            </div>
          )
        })}
        {act && (() => {
          const [x, y] = PRISM_POS[ai % PRISM_POS.length]
          const t = { x: 8, y: 26, w: 84 }
          return (
            <div key={act.id + state.epoch} className="holo-flyout prism-open"
              style={css({ left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, '--dx': `${x - t.x}cqw`, '--dy': `${(y - t.y) * 1.25}cqw`, '--k': 32 / t.w })}>
              <div className="fo-head"><b>{act.label}</b><span className="src">{act.points.length} 个点</span></div>
              <div className="holo-chart"><SeriesChart series={act} height={260} /></div>
            </div>
          )
        })()}
      </StageFrame>
      <aside className="holo-side">
        <div className="holo-kicker">{act ? `${act.label} · 原始数值` : '数据棱面'}</div>
        {act ? act.points.map((pt, k) => (
          <div key={pt.fact + state.epoch} className={`holo-card compact point ${state.visual.pointPulse.includes(pt.fact) ? 'hot' : ''}`} style={{ animationDelay: `${k * 0.06}s` }}>
            <div className="holo-card-head"><span className="mono">{dateLabel(bundle.facts[pt.fact].eff.date)}</span><FactValue id={pt.fact} /></div>
          </div>
        )) : series.map(s => (
          <div key={s.id} className="holo-card compact"><div className="holo-card-head"><b>{s.label}</b></div></div>
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
