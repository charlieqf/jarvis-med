import { useMemo, useState } from 'react'
import { dateLabel } from './data'
import { useFlags, useStage } from './stage'
import type { Block } from './types'
import { Badges, SourceChip, UnitText } from './ui'

function ms(iso?: string | null) {
  if (!iso) return 0
  const [y, m = '6', d = '15'] = iso.split('-')
  return Date.UTC(+y, +m - 1, +d)
}

// high-contrast phase colours: [band fill, band ink]
const PHASE_COLORS: [string, string][] = [
  ['#e6ebf2', '#33445c'], ['#d4e4f7', '#173a6e'], ['#d8eed5', '#1f5c35'], ['#f7e1c3', '#7d4a08'],
  ['#cdebf1', '#08596b'], ['#e3d8f4', '#46307f'], ['#f6d5cd', '#8f3421'], ['#cdece5', '#125f51'],
]

interface Segment { id: string; label: string; start: string; end: string; startFact?: string; endFact?: string | null }

/** Segmented axis: every phase gets the same width; dates are linear only inside a segment.
 *  Dense periods (2024) stay readable and quiet stretches (2025) do not waste space. */
function useSegments() {
  const { bundle } = useStage()
  return useMemo(() => {
    const phases = bundle.blocks.find(x => x.type === 'phases')!.phases!
    const events = bundle.blocks.find(x => x.type === 'timeline')!.events!
    const d = (id: string | null) => (id ? bundle.facts[id].eff.date! : '')
    const last = events.map(e => d(e.date)).sort().at(-1)!
    const lastEnd = new Date(ms(last) + 31 * 864e5).toISOString().slice(0, 10)
    const segs: Segment[] = [{ id: 'ph.pre', label: '起病与诊断', start: d(events[0].date), end: d(phases[0].start) }]
    phases.forEach(p => segs.push({ id: p.id, label: p.label, start: d(p.start), end: p.end ? d(p.end) : lastEnd, startFact: p.start, endFact: p.end }))
    const segOf = (iso?: string) => {
      const t = ms(iso)
      const i = segs.findIndex(s => t >= ms(s.start) && t < ms(s.end))
      return i < 0 ? (t < ms(segs[0].start) ? 0 : segs.length - 1) : i
    }
    const x = (iso?: string) => {
      const i = segOf(iso), s = segs[i]
      const f = Math.min(1, Math.max(0, (ms(iso) - ms(s.start)) / Math.max(1, ms(s.end) - ms(s.start))))
      return ((i + 0.08 + f * 0.84) / segs.length) * 100
    }
    return { segs, x, segOf }
  }, [bundle])
}

export function Timeline({ b }: { b: Block }) {
  const { bundle, state } = useStage()
  const { segs, x, segOf } = useSegments()
  const events = b.events!
  const [open, setOpen] = useState<string | null>(null)
  const v = state.visual
  const f = useFlags(b.id)
  const dateOf = (evId: string) => bundle.facts[events.find(e => e.id === evId)!.date].eff.date
  const sweep = v.sweep ? [x(dateOf(v.sweep[0])), x(dateOf(v.sweep[1]))] : null
  const lit = (d?: string) => (sweep ? x(d) >= sweep[0] - 0.01 && x(d) <= sweep[1] + 0.01 : false)
  const pulsed = v.pulse.filter(id => events.some(e => e.id === id))
  const detail = open ?? (pulsed.length === 1 ? pulsed[0] : null)
  const milestones = events.filter(e => e.milestone)
  // lane assignment with collision avoidance: near-above, near-below, far-above, far-below
  const lanes = useMemo(() => {
    const MIN_GAP = 10.5 // % of width a label needs
    const lastX = [-99, -99, -99, -99]
    const out = new Map<string, number>()
    for (const ev of [...milestones].sort((a, c) => x(bundle.facts[a.date].eff.date) - x(bundle.facts[c.date].eff.date))) {
      const px = x(bundle.facts[ev.date].eff.date)
      const prefer = out.size % 2 === 0 ? [0, 1, 2, 3] : [1, 0, 3, 2]
      const lane = prefer.find(l => px - lastX[l] >= MIN_GAP) ?? prefer.reduce((a, c) => (lastX[c] < lastX[a] ? c : a))
      lastX[lane] = px
      out.set(ev.id, lane)
    }
    return out
  }, [milestones, x, bundle])
  // events with the same label inside a phase are merged into one row listing all their dates
  const bySeg = segs.map((_, i) => {
    const rows: { ids: string[]; label: string; kind: string; dates: string[] }[] = []
    for (const e of events.filter(e => segOf(bundle.facts[e.date].eff.date) === i)
      .sort((a, c) => ms(bundle.facts[a.date].eff.date) - ms(bundle.facts[c.date].eff.date))) {
      const d = bundle.facts[e.date]
      const txt = dateLabel(d.eff.date) + (d.date_basis === 'inferred' ? ' 约' : '')
      const row = rows.find(r => r.label === e.label && r.kind === e.kind)
      if (row) { row.ids.push(e.id); row.dates.push(txt) } else rows.push({ ids: [e.id], label: e.label, kind: e.kind, dates: [txt] })
    }
    return rows
  })

  return (
    <section data-anchor={b.id} key={f.epoch} className={`card timeline-card ${f.spot ? 'is-spot' : ''}`}>
      <div className="card-head">
        <h3 className="block-title">治疗时间轴</h3>
        <span className="hint">每个治疗阶段等宽显示（阶段内按日期排布）· 轨道上标出关键节点 · 下方列出全部事件，点击查看原文</span>
      </div>

      <div className="tl">
        <div className="tl-track-area">
          {segs.map((s, i) => {
            const inferred = [s.startFact, s.endFact].some(id => id && bundle.facts[id].date_basis === 'inferred')
            return (
              <div key={s.id} data-anchor={s.id} className={`tl-band ${v.phases.includes(s.id) ? 'is-lit' : ''} ${inferred ? 'inferred' : ''}`}
                style={{ left: `${(i / segs.length) * 100}%`, width: `${100 / segs.length}%`, ['--fill' as string]: PHASE_COLORS[i][0], ['--ink' as string]: PHASE_COLORS[i][1] }}>
                <span className="tl-band-name">{s.label}</span>
                <span className="tl-band-dates">{dateLabel(s.start).slice(0, 7)} – {dateLabel(s.end).slice(0, 7)}{inferred ? ' · 含推断' : ''}</span>
              </div>
            )
          })}
          <div className="tl-track" />
          {sweep && <div className="tl-sweep" key={state.epoch} style={{ ['--from' as string]: `${sweep[0]}%`, ['--to' as string]: `${sweep[1]}%` }} />}
          {events.map(ev => {
            const d = bundle.facts[ev.date]
            const lane = lanes.get(ev.id)
            const cls = lane !== undefined ? `ms lane-${lane}` : 'minor'
            return (
              <button key={ev.id} data-anchor={ev.id} onClick={() => setOpen(open === ev.id ? null : ev.id)}
                className={`tl-ev ev-${ev.kind} ${cls} ${lit(d.eff.date) ? 'is-lit' : ''} ${v.pulse.includes(ev.id) ? 'is-pulse' : ''} ${d.eff.pending ? 'date-pending' : ''}`}
                style={{ left: `${x(d.eff.date)}%` }} title={`${dateLabel(d.eff.date)} ${ev.label}`}>
                <i className="dot" />
                <span className="tl-label"><b>{dateLabel(d.eff.date)}{d.date_basis === 'inferred' ? ' 约' : ''}</b>{ev.label}{d.eff.pending && <em className="badge badge-pending">日期待核</em>}</span>
              </button>
            )
          })}
        </div>

        <div className="tl-cols" style={{ gridTemplateColumns: `repeat(${segs.length}, minmax(0, 1fr))` }}>
          {segs.map((s, i) => (
            <div key={s.id} className={`tl-col ${v.phases.includes(s.id) ? 'is-lit' : ''}`} style={{ ['--fill' as string]: PHASE_COLORS[i][0] }}>
              {bySeg[i].map(r => {
                const on = r.ids.some(id => v.pulse.includes(id)), open_ = r.ids.includes(detail ?? '')
                const isLit = r.ids.some(id => lit(bundle.facts[events.find(e => e.id === id)!.date].eff.date))
                return (
                  <button key={r.ids[0]} onClick={() => setOpen(open === r.ids[0] ? null : r.ids[0])}
                    className={`tl-row ev-${r.kind} ${isLit ? 'is-lit' : ''} ${on ? 'is-pulse' : ''} ${open_ ? 'is-open' : ''}`}>
                    <b>{r.dates.length > 1 ? `${r.dates[0]} 起 ×${r.dates.length}` : r.dates[0]}</b><span>{r.label}</span>
                    {r.dates.length > 1 && <small>{r.dates.map(d => d.slice(5)).join(' · ')}</small>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="legend">
        <span><i className="k ev-treatment" />治疗</span><span><i className="k ev-assessment" />评估</span>
        <span><i className="k ev-relapse" />复发 / 进展</span><span><i className="k ev-adverse_event" />不良事件</span>
        <span><i className="k ev-procedure" />操作 / 采集</span><span><i className="k ev-pathology" />病理</span>
      </div>
      {detail && <EventDetail id={detail} onClose={() => setOpen(null)} />}
    </section>
  )
}

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
