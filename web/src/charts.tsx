/* Series charts. Display rules (DESIGN §3.4):
 *  - not_detected is never plotted as 0: on a log axis it sits on a "未检出" floor, hollow marker
 *  - bound values keep their comparator and use an arrow marker; they are not joined into change math
 *  - inferred dates get a dashed marker; image readings and pending reviews are named in the tooltip
 *  - held points (e.g. unit not stated) are listed under the chart, not plotted
 */
import * as echarts from 'echarts'
import { useEffect, useMemo, useRef } from 'react'
import { registerAnchor } from './anchors'
import { badges, pretty } from './data'
import { useStage } from './stage'
import type { Fact, Series } from './types'
import { FactValue } from './ui'

const NAVY = '#1b3a6b', CYAN = '#0ea5c6', CORAL = '#e0664f', MUTED = '#8a99ad'

export function displayUnit(points: Fact[]) {
  const units = new Set(points.filter(p => p.kind === 'exact' || p.kind === 'bound').map(p => p.raw && /%\s*$/.test(p.raw) ? '%' : p.eff.unit))
  if (units.size === 1 && units.has('%')) return { label: '%', scale: 100 }
  const u = [...units][0]
  if (u === 'fraction') return { label: '比例', scale: 1 }
  if (u === '/L') return { label: '×10⁹/L', scale: 1e-9 }
  return { label: u ?? '（单位未注明）', scale: 1 }
}

const sciLabel = (v: number) => {
  if (v === 0) return '0'
  const e = Math.floor(Math.log10(Math.abs(v)))
  if (e >= -2 && e <= 3) return String(+v.toPrecision(3))
  const sup: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
  return `10${String(e).split('').map(c => sup[c]).join('')}`
}

function dateMs(f: Fact) {
  const d = f.eff.date ?? ''
  const [y, m = '6', day = '15'] = d.split('-')
  return Date.UTC(+y, +m - 1, +day)
}

export function SeriesChart({ series, height = 240, mini = false, dark = false }: { series: Series; height?: number; mini?: boolean; dark?: boolean }) {
  const { bundle, state } = useStage()
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const pts = useMemo(() => series.points.map(p => bundle.facts[p.fact]), [series, bundle])
  const unit = displayUnit(pts)
  const pulsed = state.visual.pointPulse.filter(id => series.points.some(p => p.fact === id))
  const draw = state.visual.chartDraw.includes(series.id)

  const option = useMemo(() => {
    const vals = pts.filter(p => p.eff.value != null && p.kind !== 'not_detected').map(p => p.eff.value! * unit.scale)
    const pos = vals.filter(v => v > 0)
    const floor = series.scale === 'log' ? Math.min(...pos) / 10 : 0
    const data = pts.map(p => {
      const nd = p.kind === 'not_detected'
      const bound = p.kind === 'bound'
      const inferred = p.date_basis === 'inferred'
      // not detected: log axis -> on the 未检出 floor; linear axis -> no y value at all (a vertical marker instead)
      const y = nd ? (series.scale === 'log' ? floor : null) : p.eff.value! * unit.scale
      return {
        value: [dateMs(p), y], id: p.id,
        symbol: nd ? 'emptyCircle' : bound ? 'triangle' : 'circle',
        symbolRotate: bound ? 180 : 0,
        symbolSize: mini ? 5 : 9,
        itemStyle: { color: nd ? '#fff' : bound ? MUTED : NAVY, borderColor: nd ? CYAN : inferred ? CORAL : NAVY, borderWidth: nd || inferred ? 2 : 1, borderType: inferred ? 'dashed' : 'solid' },
        label: { show: !mini, formatter: nd ? '未检出' : pretty(p.raw ?? ''), position: 'top', color: '#3a4a60', fontSize: 11 },
      }
    })
    return {
      animationDuration: 1400, animationEasing: 'cubicOut',
      grid: mini ? { left: 8, right: 8, top: 8, bottom: 8 } : { left: 64, right: 24, top: 28, bottom: 36 },
      xAxis: { type: 'time', show: !mini, axisLine: { lineStyle: { color: '#c9d3e0' } }, axisLabel: { color: MUTED, formatter: { year: '{yyyy}', month: '{yyyy}.{MM}', day: '{MM}.{dd}' } as unknown as string }, splitLine: { show: false } },
      yAxis: {
        type: series.scale === 'log' ? 'log' : 'value', show: !mini, name: mini ? '' : unit.label, nameTextStyle: { color: MUTED },
        min: series.scale === 'log' ? floor / 2 : undefined,
        axisLabel: { color: MUTED, formatter: (v: number) => series.scale === 'log' ? sciLabel(v) : String(+v.toPrecision(4)) },
        splitLine: { lineStyle: { color: '#eef2f7' } },
      },
      tooltip: mini ? undefined : {
        trigger: 'item', backgroundColor: '#fff', borderColor: '#dfe6ef', textStyle: { color: '#1c2a3e' },
        formatter: (p: { data: { id: string } }) => {
          const f = bundle.facts[p.data.id]
          const b = badges(f).map(x => `〔${x.text}〕`).join('')
          return `${(f.eff.date ?? '').replace(/-/g, '.')}${f.date_basis === 'inferred' ? '（日期推断）' : ''}<br/><b>${f.kind === 'not_detected' ? '未检出（原文：' + f.raw + '）' : pretty(f.raw ?? '')}</b> ${b}<br/><span style="color:#8a99ad">原稿第 ${f.slide} 页 · 点击数值可查看原文</span>`
        },
      },
      series: [
        { type: 'line', data: dark ? data.map(d => ({ ...d, itemStyle: { ...d.itemStyle, color: '#bff6ff', borderColor: '#7ee8ff' } })) : data, smooth: false, lineStyle: { color: dark ? '#7ee8ff' : NAVY, width: mini ? 1.5 : 2.5, shadowColor: dark ? '#37d3ff' : 'transparent', shadowBlur: dark ? 8 : 0 }, showSymbol: true, connectNulls: true },
        { type: 'effectScatter', data: data.filter(d => pulsed.includes(d.id)).map(d => ({ ...d, label: { show: false } })),
          rippleEffect: { brushType: 'stroke', scale: 4 }, symbolSize: 14, itemStyle: { color: CYAN }, z: 5 },
        ...(series.scale === 'linear' && pts.some(p => p.kind === 'not_detected') ? [{
          type: 'line', data: [], markLine: { silent: true, symbol: 'none', lineStyle: { color: CYAN, type: 'dashed' },
            label: { show: !mini, formatter: (m: { data: { name: string } }) => m.data.name, color: CYAN, position: 'insideEndTop' },
            data: pts.filter(p => p.kind === 'not_detected').map(p => ({ xAxis: dateMs(p), name: `${p.raw}（未检出，不作为 0 绘制）` })) } }] : []),
        ...(series.scale === 'log' && pts.some(p => p.kind === 'not_detected') && !mini ? [{
          type: 'line', data: [], markLine: { silent: true, symbol: 'none', lineStyle: { color: CYAN, type: 'dashed' },
            label: { formatter: '未检出', color: CYAN }, data: [{ yAxis: floor }] } }] : []),
      ],
    } as echarts.EChartsOption
  }, [pts, unit.scale, unit.label, series.scale, mini, pulsed, bundle.facts, dark])

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current)
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => { ro.disconnect(); c.dispose(); chart.current = null }
  }, [])

  useEffect(() => {
    const c = chart.current
    if (!c) return
    if (draw) c.clear()   // replay the drawing animation for chartDraw
    c.setOption(option, true)
  }, [option, draw, state.epoch])

  // chart points are anchors too (for callouts / spotlight)
  useEffect(() => {
    if (mini) return
    const offs = pts.map((p, i) => registerAnchor(p.id, () => {
      const c = chart.current
      if (!c || !el.current) return null
      const d = (option.series as { data: { value: (number | null)[] }[] }[])[0].data[i] as { value: number[] }
      const [x, y] = c.convertToPixel({ seriesIndex: 0 }, [d.value[0], d.value[1] ?? 0]) as number[]
      const r = el.current.getBoundingClientRect()
      return new DOMRect(r.left + x - 10, r.top + y - 10, 20, 20)
    }))
    return () => offs.forEach(off => off())
  }, [pts, option, mini])

  return (
    <div className="chart-wrap">
      <div ref={el} style={{ height }} />
      {!mini && series.held?.length ? (
        <div className="held">
          {series.held.map(h => <span key={h.fact} className="held-chip"><FactValue id={h.fact} showDate /> 未并入曲线：{h.reason}</span>)}
        </div>
      ) : null}
    </div>
  )
}

export function StackedBar({ segments, totals }: { segments: string[]; totals: string[] }) {
  const { bundle, state } = useStage()
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current)
    const colors = ['#9fb7d6', '#5d86bd', '#2f5f9e', NAVY]
    c.setOption({
      animationDuration: 1400,
      grid: { left: 16, right: 90, top: 10, bottom: 10 },
      xAxis: { type: 'value', show: false, max: 100 }, yAxis: { type: 'category', show: false, data: [''] },
      series: segments.map((id, i) => {
        const f = bundle.facts[id]
        return { type: 'bar', stack: 'r', name: f.attrs?.category, data: [f.eff.value], barWidth: 34, itemStyle: { color: colors[i % 4] },
          label: { show: true, formatter: `${f.attrs?.category} ${f.raw}%`, color: '#fff', fontSize: 11 } }
      }),
    })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => { ro.disconnect(); c.dispose() }
  }, [segments, bundle, state.epoch])
  return (
    <div>
      <div ref={el} style={{ height: 70 }} />
      <div className="totals">{totals.map(t => <span key={t} className="total"><b>{bundle.facts[t].attrs?.analyte}</b> <FactValue id={t} /></span>)}</div>
    </div>
  )
}
