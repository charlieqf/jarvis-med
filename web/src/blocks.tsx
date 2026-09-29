import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { SeriesChart, StackedBar } from './charts'
import { asset, dateLabel } from './data'
import { useFlags, useStage } from './stage'
import type { Block, CompareRow, Pin } from './types'
import { Badges, FactValue, SourceChip, Title, UnitText, useUI } from './ui'

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'text': return <TextBlock b={block} />
    case 'table': return <TableBlock b={block} />
    case 'phases': return null // rendered inside the timeline
    case 'timeline': return <Timeline b={block} />
    case 'series_group': return <SeriesGroup b={block} />
    case 'image': return block.role === 'cover' || block.role === 'logo' ? null : <ImageBlock b={block} />
    case 'body_map': return <BodyMap b={block} />
    case 'compare_matrix': return <CompareMatrix b={block} />
    case 'stacked_bar': return <Card b={block}><h4 className="block-title">{block.label}</h4><StackedBar segments={block.segments!} totals={block.totals!} />
      <div className="label-units">{block.total_labels?.map(u => <UnitText key={u} id={u} />)}</div>
      <div className="chart-source">图表数据点（原稿第 25 页原生图表）：{block.units?.map(u => <UnitText key={u} id={u} />)}</div></Card>
    case 'slide_deck': return <SlideDeck b={block} />
    default: return <Card b={block}><em>未知区块类型 {block.type}</em></Card>
  }
}

function Card({ b, children, className = '' }: { b: Block; children: React.ReactNode; className?: string }) {
  const f = useFlags(b.id)
  return <section data-anchor={b.id} key={f.epoch} className={`card ${className} ${f.spot ? 'is-spot' : ''} ${f.pulse ? 'is-pulse' : ''}`}>{children}</section>
}

function TextBlock({ b }: { b: Block }) {
  const { bundle } = useStage()
  const slide = bundle.facts[(b.units ?? b.title ?? [])[0]]?.slide
  return (
    <Card b={b}>
      <div className="card-head"><Title ids={b.heading} level={2} /><SourceChip slide={slide} /></div>
      <Title ids={b.title} />
      {b.units?.map(u => <UnitText key={u} id={u} as="p" />)}
      {b.groups?.map(g => <GroupView key={g.id} id={g.id} title={g.title} units={g.units} />)}
      {b.footnotes?.length ? <div className="footnotes">{b.footnotes.map(u => <UnitText key={u} id={u} as="p" />)}</div> : null}
      {b.citations?.length ? <div className="citations">{b.citations.map(u => <UnitText key={u} id={u} as="p" />)}</div> : null}
    </Card>
  )
}

function GroupView({ id, title, units }: { id: string; title?: string[]; units: string[] }) {
  const f = useFlags(id)
  return <div data-anchor={id} key={f.epoch} className={`group ${f.spot ? 'is-spot' : ''}`}><Title ids={title} level={4} />{units.map(u => <UnitText key={u} id={u} as="p" />)}</div>
}

function TableBlock({ b }: { b: Block }) {
  const { bundle } = useStage()
  const rows = b.rows as (string | null)[][]
  const isHeader = (r: (string | null)[]) => HEADER_WORDS.includes(bundle.facts[r[0] ?? '']?.raw ?? '') || (!r[0] && !!r[1] && /^N=/.test(bundle.facts[r[1]]?.raw ?? ''))
  return (
    <Card b={b}>
      <div className="card-head"><Title ids={b.heading} level={2} /><SourceChip slide={b.slide} /></div>
      <Title ids={b.title} />
      {b.caption && <p className="caption"><UnitText id={b.caption[0]} /></p>}
      <table className="data">
        <tbody>
          {rows.map((r, i) => <Row key={i} anchor={`${b.id}.r${i}`} cells={r} head={i === 0 && isHeader(r)} />)}
        </tbody>
      </table>
      {b.notes?.map(u => <UnitText key={u} id={u} as="p" className="note" />)}
    </Card>
  )
}

const HEADER_WORDS = ['项目', '指标', '检查项目', '标志物', 'FISH 检测', '靶区']

function Row({ anchor, cells, head }: { anchor: string; cells: (string | null)[]; head: boolean }) {
  const f = useFlags(anchor)
  const Cell = head ? 'th' : 'td'
  return (
    <tr data-anchor={anchor} key={f.epoch} className={f.row ? 'is-row' : ''}>
      {cells.map((c, i) => <Cell key={i}>{c ? <UnitText id={c} /> : null}</Cell>)}
    </tr>
  )
}

// ------------------------------------------------------------------ timeline

const T0 = Date.UTC(2023, 0, 1), T1 = Date.UTC(2026, 9, 1)
function ms(iso?: string) {
  if (!iso) return T0
  const [y, m = '6', d = '15'] = iso.split('-')
  return Date.UTC(+y, +m - 1, +d)
}
const xPct = (iso?: string) => ((ms(iso) - T0) / (T1 - T0)) * 100
const PHASE_COLORS = ['#dbe7f6', '#e3ecd9', '#f3e6d2', '#d9eef2', '#e8e0f2', '#f4dcd6', '#d6ecec']

function Timeline({ b }: { b: Block }) {
  const { bundle, state } = useStage()
  const phases = bundle.blocks.find(x => x.type === 'phases')!.phases!
  const events = b.events!
  const [open, setOpen] = useState<string | null>(null)
  const v = state.visual
  const sweep = v.sweep ? [xPct(bundle.facts[events.find(e => e.id === v.sweep![0])!.date].eff.date),
    xPct(bundle.facts[events.find(e => e.id === v.sweep![1])!.date].eff.date)] : null
  const lit = (d?: string) => sweep ? xPct(d) >= sweep[0] - 0.01 && xPct(d) <= sweep[1] + 0.01 : false
  const years = [2023, 2024, 2025, 2026]
  const f = useFlags(b.id)
  const shown = v.pulse.filter(id => events.some(e => e.id === id))
  const detail = open ?? (shown.length === 1 ? shown[0] : null)
  const orbit = useRef<HTMLDivElement>(null)
  // follow the sweep / pulsed events horizontally
  const focusPct = sweep ? sweep[0] : shown.length ? xPct(bundle.facts[events.find(e => e.id === shown[0])!.date].eff.date) : null
  useEffect(() => {
    const o = orbit.current
    if (!o || focusPct == null) return
    const plane = o.firstElementChild as HTMLElement
    o.scrollTo({ left: Math.max(0, (focusPct / 100) * plane.offsetWidth - o.clientWidth * 0.2), behavior: 'smooth' })
  }, [focusPct, state.epoch])

  return (
    <section data-anchor={b.id} key={f.epoch} className={`card timeline-card ${f.spot ? 'is-spot' : ''}`}>
      <div className="card-head"><h3 className="block-title">治疗时间轴 · 轨道视图</h3><span className="hint">点击节点查看原文；阶段色带的起止若为推断会以虚线表示</span></div>
      <div className="orbit" ref={orbit}>
        <div className="orbit-plane">
          {years.map(y => <div key={y} className="year" style={{ left: `${xPct(`${y}-01-01`)}%` }}>{y}</div>)}
          <div className="track" />
          {phases.map((p, i) => {
            const pf = useFlagsStatic(p.id, v)
            const s = bundle.facts[p.start], e = p.end ? bundle.facts[p.end] : null
            const inferred = s.date_basis === 'inferred' || e?.date_basis === 'inferred'
            return <div key={p.id} data-anchor={p.id} className={`band ${pf ? 'is-lit' : ''} ${inferred ? 'inferred' : ''}`}
              style={{ left: `${xPct(s.eff.date)}%`, width: `${Math.max(0.6, xPct(e?.eff.date ?? '2026-09') - xPct(s.eff.date))}%`, background: PHASE_COLORS[i % 7] }}
              title={p.chapter.map(u => bundle.facts[u]?.raw).join(' / ')}><span>{p.label}</span></div>
          })}
          {sweep && <div className="sweep" key={state.epoch} style={{ ['--from' as string]: `${sweep[0]}%`, ['--to' as string]: `${sweep[1]}%` }} />}
          {events.map((ev, i) => {
            const d = bundle.facts[ev.date]
            const pulse = v.pulse.includes(ev.id)
            return (
              <button key={ev.id} data-anchor={ev.id}
                className={`ev ev-${ev.kind} lane-${i % 6} ${lit(d.eff.date) ? 'is-lit' : ''} ${pulse ? 'is-pulse' : ''} ${d.eff.pending ? 'date-pending' : ''}`}
                style={{ left: `${xPct(d.eff.date)}%` }} onClick={() => setOpen(open === ev.id ? null : ev.id)}>
                <i className="dot" /><span className="ev-label"><b>{dateLabel(d.eff.date)}{d.date_basis === 'inferred' ? '（推断）' : ''}</b>{ev.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="legend">
        {phases.map((p, i) => <span key={p.id}><i style={{ background: PHASE_COLORS[i % 7] }} />{p.label}</span>)}
      </div>
      {detail && <EventDetail id={detail} onClose={() => setOpen(null)} />}
    </section>
  )
}
const useFlagsStatic = (id: string, v: { phases: string[] }) => v.phases.includes(id)

function EventDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { bundle } = useStage()
  const ev = bundle.blocks.find(b => b.type === 'timeline')!.events!.find(e => e.id === id)!
  const d = bundle.facts[ev.date]
  return (
    <div className="ev-detail">
      <div className="card-head"><h4>{dateLabel(d.eff.date)} · {ev.label} <Badges fact={d} /></h4><SourceChip slide={bundle.facts[ev.units[0]]?.slide ?? d.slide} /><button className="x" onClick={onClose}>×</button></div>
      {d.date_note && <p className="note">日期说明：{d.date_note}</p>}
      {ev.units.map(u => <UnitText key={u} id={u} as="p" />)}
    </div>
  )
}

// ------------------------------------------------------------------ series

function SeriesGroup({ b }: { b: Block }) {
  const { state } = useStage()
  const [open, setOpen] = useState<string | null>(null)
  const active = state.visual.chartDraw.find(id => b.series!.some(s => s.id === id)) ?? state.visual.camera
  const expanded = b.series!.find(s => s.id === active)?.id ?? open
  return (
    <section className="card" data-anchor={b.id}>
      <div className="card-head"><h3 className="block-title">指标总览</h3><span className="hint">每张卡片是一条可比较的序列；不同检测方法 / 部位 / 显像方式分开，不会画在同一条线上</span></div>
      <div className="prism">
        {b.series!.map(s => (
          <div key={s.id} className={`facet ${expanded === s.id ? 'open' : ''}`}>
            <button className="facet-head" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span>{s.label}</span><small>{s.points.length} 个点 · {s.scale === 'log' ? '对数' : '线性'}</small>
            </button>
            {expanded === s.id ? <SeriesChart series={s} height={280} /> : <SeriesChart series={s} height={70} mini />}
          </div>
        ))}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ images

export function ImageFigure({ b, anchored = true, large = false }: { b: Block; anchored?: boolean; large?: boolean }) {
  const { bundle, state } = useStage()
  const aspect = (b.bbox![2] / b.bbox![3]) * bundle.aspect
  const [l, t, r, btm] = b.crop!
  const w = 1 - l - r, h = 1 - t - btm
  return (
    <div className={`figure ${large ? 'large' : ''}`} style={{ aspectRatio: String(aspect) }} data-anchor={anchored ? `${b.id}#img` : undefined}>
      <img src={asset(b.src!)} alt={b.label ?? ''} style={{ width: `${100 / w}%`, height: `${100 / h}%`, left: `${-l / w * 100}%`, top: `${-t / h * 100}%` }} />
      {b.overlays?.map(o => <img key={o.shape} className="overlay" src={asset(o.src)} alt="" title={o.reason}
        style={{ left: `${o.rel_bbox[0] * 100}%`, top: `${o.rel_bbox[1] * 100}%`, width: `${o.rel_bbox[2] * 100}%`, height: `${o.rel_bbox[3] * 100}%` }} />)}
      <svg className="hotspots" viewBox="0 0 100 100" preserveAspectRatio="none">
        {b.annotations?.filter(a => a.facts.length).map(a => {
          const [x, y, aw, ah] = a.rel_bbox.map(v => v * 100)
          const on = state.visual.hotspots.includes(a.id)
          const shape = a.geom === 'OVAL'
            ? <ellipse cx={x + aw / 2} cy={y + ah / 2} rx={aw / 2} ry={ah / 2} pathLength={1} />
            : <rect x={x} y={y} width={aw} height={ah} pathLength={1} />
          return <g key={a.id + state.epoch} data-anchor={anchored ? a.id : undefined} className={`hs ${on ? 'is-on' : ''}`}>{shape}</g>
        })}
      </svg>
    </div>
  )
}

function ImageBlock({ b }: { b: Block }) {
  const { state } = useStage()
  const [fly, setFly] = useState(false)
  const inStage = state.visual.images.includes(b.id)
  const f = useFlags(b.id)
  // free browsing: card flies out, stays 10 s, then returns (reference concept); tours control it themselves
  useEffect(() => { if (!fly) return; const t = setTimeout(() => setFly(false), 10000); return () => clearTimeout(t) }, [fly])
  return (
    <section data-anchor={b.id} key={f.epoch} className={`card image-card ${f.spot ? 'is-spot' : ''}`}>
      <div className="card-head"><h4 className="block-title">{b.label}</h4><SourceChip slide={b.slide} /></div>
      {inStage ? <div className="figure placeholder">已在舞台中展开</div> :
        <button className="figure-btn" onClick={() => setFly(true)} title="展开阅片（10 秒后自动归位）"><ImageFigure b={b} /></button>}
      <FigureFacts b={b} />
      {b.placements && b.placements.length > 1 && <p className="note">原稿中此图出现 {b.placements.length} 次（流程图中的连接箭头）</p>}
      {fly && !inStage && <FlyCard b={b} onClose={() => setFly(false)} />}
    </section>
  )
}

export function FigureFacts({ b }: { b: Block }) {
  const ids = [...new Set([...(b.annotations ?? []).flatMap(a => a.facts), ...(b.facts ?? [])])]
  return (
    <div className="figure-facts">
      {b.date && <FactValue id={b.date} />}
      {ids.map(id => <FactValue key={id} id={id} />)}
      {b.label_units?.map(u => <UnitText key={u} id={u} className="label-unit" />)}
    </div>
  )
}

function FlyCard({ b, onClose }: { b: Block; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' }) }, [])
  return (
    <div className="fly-backdrop" onClick={onClose}>
      <div className="fly-card" ref={ref} onClick={e => e.stopPropagation()}>
        <div className="card-head"><h4>{b.label}</h4><SourceChip slide={b.slide} /><button className="x" onClick={onClose}>×</button></div>
        <ImageFigure b={b} anchored={false} large />
        <FigureFacts b={b} />
        <div className="countdown"><i /></div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ body map (display-only schematic)

const REGIONS: Record<string, [number, number, string]> = {
  right_scapula: [70, 104, '右肩胛区（背侧）'],
  left_breast: [124, 128, '左乳'],
  right_iliac: [74, 214, '右髂骨'],
  left_upper_arm: [150, 146, '左上臂'],
  right_abdominal_wall: [80, 188, '右腹壁'],
  right_groin: [84, 238, '右腹股沟'],
}

function BodyMap({ b }: { b: Block }) {
  const { bundle, state } = useStage()
  const f = useFlags(b.id)
  const pins = b.pins!
  const active = state.visual.pins
  return (
    <section data-anchor={b.id} key={f.epoch} className={`card bodymap ${f.spot ? 'is-spot' : ''}`}>
      <div className="card-head"><h3 className="block-title">{b.label}</h3></div>
      <div className="bodymap-grid">
        <svg viewBox="0 0 200 440" className="body">
          <path className="silhouette" d="M100 20c14 0 24 11 24 26s-10 28-24 28-24-13-24-28 10-26 24-26zM78 78c-18 4-30 12-34 30l-14 86c-2 10 0 18 6 20l8-2 16-76 4 58-4 78 8 140c1 10 8 14 16 12l10-150 2-10 2 10 10 150c8 2 15-2 16-12l8-140-4-78 4-58 16 76 8 2c6-2 8-10 6-20l-14-86c-4-18-16-26-34-30z" />
          <text x="100" y="432" textAnchor="middle" className="schematic">示意图 · 非患者影像 · 患者右侧位于图左</text>
          {pins.map(p => <PinDot key={p.id} p={p} on={active.includes(p.id)} />)}
        </svg>
        <div className="pin-list">
          {pins.map(p => (
            <div key={p.id} data-anchor={`${p.id}#card`} className={`pin-card ${active.includes(p.id) ? 'is-on' : ''}`}>
              <b>{REGIONS[p.region][2]}</b> <FactValue id={p.date} />
              {p.facts.map(id => <div key={id}><FactValue id={id} /></div>)}
              <MiniThumb annotation={p.annotation} />
            </div>
          ))}
        </div>
      </div>
      <p className="note">部位来自原稿文字与影像红圈；人体轮廓和点位仅为示意。{bundle.facts['u.13.5.p0']?.raw}</p>
    </section>
  )
}

function PinDot({ p, on }: { p: Pin; on: boolean }) {
  const [x, y, label] = REGIONS[p.region]
  return (
    <g data-anchor={p.id} className={`pin ${on ? 'is-on' : ''}`}>
      <circle cx={x} cy={y} r={on ? 7 : 5} />
      {on && <circle cx={x} cy={y} r={7} className="ripple" />}
      <text x={x < 100 ? x - 10 : x + 10} y={y + 4} textAnchor={x < 100 ? 'end' : 'start'}>{label}</text>
    </g>
  )
}

function MiniThumb({ annotation }: { annotation: string }) {
  const { bundle } = useStage()
  const img = bundle.blocks.find(b => b.annotations?.some(a => a.id === annotation))
  if (!img) return null
  return <div className="mini-thumb"><ImageFigure b={{ ...img, annotations: img.annotations!.filter(a => a.id === annotation) }} anchored={false} /></div>
}

// ------------------------------------------------------------------ compare matrix

function CompareMatrix({ b }: { b: Block }) {
  const rows = b.rows as CompareRow[]
  return (
    <Card b={b}>
      <div className="card-head"><h3 className="block-title">{b.label}</h3></div>
      <p className="note">不同样本（初诊样本 / 右肩胛区组织 / 左上臂组织）的结果只并列展示，不计算变化。</p>
      <table className="data compare">
        <tbody>{rows.map(r => <CompareRowView key={r.id} r={r} />)}</tbody>
      </table>
    </Card>
  )
}

function CompareRowView({ r }: { r: CompareRow }) {
  const { bundle } = useStage()
  const f = useFlags(r.id)
  return (
    <tr data-anchor={r.id} key={f.epoch} className={f.compare ? 'is-row' : ''}>
      <th>{r.label_unit ? <UnitText id={r.label_unit} /> : r.label_fact ? <FactValue id={r.label_fact} /> : r.label}</th>
      {r.facts.map(id => {
        const x = bundle.facts[id]
        return <td key={id}><div className="cmp-meta">{dateLabel(x.eff.date)} · {x.attrs?.specimen ?? x.attrs?.method ?? ''}</div><FactValue id={id} /></td>
      })}
    </tr>
  )
}

// ------------------------------------------------------------------ slide deck

function SlideDeck({ b }: { b: Block }) {
  const { openSlide } = useUI()
  return (
    <Card b={b}>
      <div className="card-head"><h3 className="block-title">{b.label}</h3></div>
      <div className="deck">
        {b.slides!.map(s => <button key={s.n} className="thumb" onClick={() => openSlide(s.n)}><img loading="lazy" src={asset(s.src)} alt={`第${s.n}页`} /><span>P{s.n}</span></button>)}
      </div>
    </Card>
  )
}

export function Hero() {
  const { bundle } = useStage()
  const cover = bundle.blocks.find(b => b.role === 'cover')!
  const logo = bundle.blocks.find(b => b.role === 'logo')!
  const title = useMemo(() => bundle.meta.title, [bundle])
  return (
    <header className="hero" data-anchor="sec.overview">
      <img className="hero-cover" src={asset(cover.src!)} alt="封面图片（原稿第1页）" data-anchor={cover.id} />
      <div className="hero-text">
        <img className="hero-logo" src={asset(logo.src!)} alt="医院标识" data-anchor={logo.id} />
        <h1>{title.map(u => <Fragment key={u}><UnitText id={u} /> </Fragment>)}</h1>
        <p>{bundle.meta.institution.slice(0, 2).map(u => <UnitText key={u} id={u} />)}</p>
        <p className="hero-foot">结束页署名：<UnitText id={bundle.meta.institution[2]} /></p>
      </div>
    </header>
  )
}
