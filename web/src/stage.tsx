/* Stage engine (DESIGN §7).
 *
 * - Every answer has an answerId; every step has (answerId, seq). Events from a cancelled
 *   answer are dropped.
 * - A step's visual state is a pure function of the step (derive()), so actions are
 *   idempotent and "previous step" = restore snapshot of step n-1 and replay its entrance.
 * - All transitions are written to the trace log shown in the Agent process panel.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Bundle, Claim, Step, Tour } from './types'

export type Status = 'idle' | 'playing' | 'paused' | 'done' | 'cancelled'

export interface Visual {
  camera?: string
  spotlight: string[]
  pulse: string[]
  chartDraw: string[]
  pointPulse: string[]
  sweep?: [string, string]
  phases: string[]
  rows: string[]
  cells: string[]
  hotspots: string[]
  images: string[]
  compareRows: string[]
  pins: string[]
  countUp: string[]
  source?: string
  callouts: { target: string; claim: Claim }[]
  say: Claim[]
  title?: string
}

export const EMPTY: Visual = {
  spotlight: [], pulse: [], chartDraw: [], pointPulse: [], phases: [], rows: [], cells: [], hotspots: [],
  images: [], compareRows: [], pins: [], countUp: [], callouts: [], say: [],
}

export function derive(step: Step): Visual {
  const v: Visual = { ...EMPTY, spotlight: [], pulse: [], chartDraw: [], pointPulse: [], phases: [], rows: [], cells: [],
    hotspots: [], images: [], compareRows: [], pins: [], countUp: [], camera: step.camera, say: step.say, title: step.title,
    callouts: step.callouts.map(c => ({ target: c.target, claim: step.say.find(s => s.claim === c.claim)! })) }
  for (const a of step.actions) {
    const t = a.targets
    switch (a.op) {
      case 'spotlight': v.spotlight.push(...t); break
      case 'pulse': v.pulse.push(...t); break
      case 'chartDraw': v.chartDraw.push(...t); break
      case 'pointPulse': v.pointPulse.push(...t); break
      case 'timelineSweep': v.sweep = [t[0], t[1]]; break
      case 'phaseHighlight': v.phases.push(...t); break
      case 'rowFlash': v.rows.push(...t); break
      case 'cellZoom': v.cells.push(...t); break
      case 'drawHotspot': v.hotspots.push(...t); break
      case 'imageOpen': v.images.push(...t); break
      case 'compareRow': v.compareRows.push(...t); break
      case 'bodyMap': v.pins.push(...t); break
      case 'countUp': v.countUp.push(...t); break
      case 'showSource': v.source = t[0]; break
      case 'camera': v.camera = t[0]; break
    }
  }
  return v
}

// ------------------------------------------------------------------ trace

export interface TraceEvent { id: number; t: number; answerId?: string; kind: string; text: string; data?: unknown; status?: string }

// ------------------------------------------------------------------ state

interface State {
  answerId?: string
  tour?: Tour
  index: number
  status: Status
  speed: number
  visual: Visual
  epoch: number            // increments on every applied step -> replays entrance animations
  live?: { finished: boolean; waiting: boolean }   // streaming answer from the model
}

type Msg =
  | { type: 'start'; answerId: string; tour: Tour }
  | { type: 'goto'; answerId: string; index: number }
  | { type: 'pause' } | { type: 'resume' } | { type: 'cancel' } | { type: 'done'; answerId: string }
  | { type: 'speed'; speed: number }
  | { type: 'startLive'; answerId: string; tour: Tour }
  | { type: 'append'; answerId: string; step: Step }
  | { type: 'wait'; answerId: string }
  | { type: 'liveEnd'; answerId: string }

function reducer(s: State, m: Msg): State {
  switch (m.type) {
    case 'start':
      return { ...s, answerId: m.answerId, tour: m.tour, index: 0, status: 'playing', visual: derive(m.tour.steps[0]), epoch: s.epoch + 1, live: undefined }
    case 'goto':
      if (m.answerId !== s.answerId || !s.tour || m.index < 0 || m.index >= s.tour.steps.length) return s
      return { ...s, index: m.index, visual: derive(s.tour.steps[m.index]), epoch: s.epoch + 1 }
    case 'pause': return s.status === 'playing' ? { ...s, status: 'paused' } : s
    case 'resume': return s.status === 'paused' || s.status === 'done' ? { ...s, status: 'playing' } : s
    case 'done': return m.answerId === s.answerId ? { ...s, status: 'done' } : s
    case 'cancel': return { ...s, answerId: undefined, tour: undefined, status: 'cancelled', visual: EMPTY, epoch: s.epoch + 1, live: undefined }
    case 'speed': return { ...s, speed: m.speed }
    case 'startLive':
      return { ...s, answerId: m.answerId, tour: m.tour, index: -1, status: 'playing', visual: EMPTY, epoch: s.epoch + 1, live: { finished: false, waiting: true } }
    case 'append': {
      if (m.answerId !== s.answerId || !s.tour) return s
      const tour = { ...s.tour, steps: [...s.tour.steps, { ...m.step, seq: s.tour.steps.length }] }
      if (s.live?.waiting && s.status !== 'paused') {
        const index = s.index + 1
        return { ...s, tour, index, visual: derive(tour.steps[index]), epoch: s.epoch + 1, live: { ...s.live, waiting: false } }
      }
      return { ...s, tour }
    }
    case 'wait': return m.answerId === s.answerId && s.live ? { ...s, live: { ...s.live, waiting: true } } : s
    case 'liveEnd':
      if (m.answerId !== s.answerId || !s.live) return s
      return { ...s, live: { ...s.live, finished: true }, status: s.live.waiting ? 'done' : s.status }
  }
}

interface Ctx {
  bundle: Bundle
  tours: Tour[]
  state: State
  trace: TraceEvent[]
  log: (kind: string, text: string, data?: unknown, status?: string) => void
  play: (tour: Tour, route?: { via: string; score?: number; input?: string }) => void
  playLive: (question: string, code: string) => Promise<'ok' | 'unauthorized' | 'error'>
  next: () => void
  prev: () => void
  pause: () => void
  resume: () => void
  cancel: (why?: string) => void
  setSpeed: (n: number) => void
  clearTrace: () => void
}

const StageCtx = createContext<Ctx | null>(null)
export const useStage = () => useContext(StageCtx)!

let traceSeq = 0
const newAnswerId = () => 'a_' + Math.random().toString(36).slice(2, 7)

export function stepDuration(step: Step, speed: number) {
  const chars = step.say.reduce((n, c) => n + c.text.length, 0)
  return Math.max(3500, 2200 + chars * 70) / speed
}

export function StageProvider({ bundle, tours, children }: { bundle: Bundle; tours: Tour[]; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { index: 0, status: 'idle', speed: 1, visual: EMPTY, epoch: 0 })
  const [trace, setTrace] = useState<TraceEvent[]>([])
  const stateRef = useRef(state)
  stateRef.current = state
  const t0 = useRef(performance.now())

  const log = useCallback((kind: string, text: string, data?: unknown, status?: string) => {
    const answerId = stateRef.current.answerId
    setTrace(tr => [...tr.slice(-400), { id: ++traceSeq, t: performance.now() - t0.current, answerId, kind, text, data, status }])
  }, [])

  const cancel = useCallback((why = '用户取消') => {
    const s = stateRef.current
    if (s.answerId && (s.status === 'playing' || s.status === 'paused')) log('cancel', `已取消（${why}）；之后到达的该回答的步骤将被丢弃`, undefined, 'cancelled')
    dispatch({ type: 'cancel' })
  }, [log])

  const play = useCallback((tour: Tour, route?: { via: string; score?: number; input?: string }) => {
    cancel('新问题开始')
    const answerId = newAnswerId()
    stateRef.current = { ...stateRef.current, answerId }
    const fresh = tour.content_version === bundle.content_version
    log('route', route?.via === 'click' ? `点击推荐问题 → 预编导览 ${tour.id}` :
      `匹配预编导览 ${tour.id}（得分 ${route?.score ?? '-'}）`, { input: route?.input, tour: tour.id, question: tour.question })
    log('version', fresh ? `数据版本一致（${tour.content_version}）` : `导览版本 ${tour.content_version} ≠ 当前数据 ${bundle.content_version}：导览已失效，拒绝播放`,
      undefined, fresh ? 'pass' : 'reject')
    if (!fresh) return
    log('plan', `回答计划：${tour.steps.length} 步，${tour.checks.length} 条结论${tour.reviewed_by ? `（已由 ${tour.reviewed_by} 审核）` : '（计划尚未人工审核）'}`,
      tour.checks)
    for (const c of tour.checks) {
      const flags = c.flags.length ? `；标记：${c.flags.map(f => f === 'image_reading' ? '含图读数据' : f === 'pending_review' ? '含待审修正' : f).join('、')}` : ''
      log('check', `${c.claim} [${c.type}] 引用 ${c.cite.join(', ')} → 编译校验通过${flags}`, c, 'pass')
    }
    stateRef.current = { ...stateRef.current, answerId }
    dispatch({ type: 'start', answerId, tour })
  }, [bundle.content_version, cancel, log])

  const playLive = useCallback(async (question: string, code: string) => {
    cancel('新问题开始')
    const answerId = newAnswerId()
    const tour: Tour = { id: 'LIVE', question, content_version: bundle.content_version, reviewed_by: null, steps: [], checks: [] }
    stateRef.current = { ...stateRef.current, answerId, tour, live: { finished: false, waiting: true } }
    dispatch({ type: 'startLive', answerId, tour })
    log('route', '未命中预编导览 → 慢速路径：请求服务端实时编排回答计划', { question })
    let r: Response
    try {
      r = await fetch(`${import.meta.env.BASE_URL}api/ask`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-access-code': code }, body: JSON.stringify({ question }) })
    } catch (e) { log('error', `无法连接服务端：${e}`, undefined, 'reject'); dispatch({ type: 'liveEnd', answerId }); return 'error' }
    if (r.status === 401) { log('error', '访问码不正确', undefined, 'reject'); dispatch({ type: 'cancel' }); return 'unauthorized' }
    if (!r.ok) { log('error', `服务端错误 ${r.status}`, undefined, 'reject'); dispatch({ type: 'liveEnd', answerId }); return 'error' }
    const { jobId, content_version } = await r.json()
    if (content_version !== bundle.content_version) log('version', `服务端数据版本 ${content_version} ≠ 页面 ${bundle.content_version}，请刷新页面`, undefined, 'reject')
    log('route', `服务端任务 ${jobId} 已创建，开始接收实时事件`, { jobId })
    let after = -1
    const poll = async () => {
      if (stateRef.current.answerId !== answerId) {   // cancelled on the client: tell the server, stop polling
        fetch(`${import.meta.env.BASE_URL}api/cancel/${jobId}`, { method: 'POST' }).catch(() => {})
        return
      }
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/job/${jobId}?after=${after}`)
        const { events, done } = await res.json() as { events: { n: number; t: number; kind: string; text: string; data?: unknown; status?: string }[]; done: boolean }
        for (const e of events) {
          after = e.n
          if (stateRef.current.answerId !== answerId) { log('drop', `丢弃：回答已取消后到达的服务端事件（${e.kind}）`, undefined, 'dropped'); continue }
          log(e.kind, `[服务端 +${(e.t / 1000).toFixed(1)}s] ${e.text}`, e.data, e.status)
          if (e.kind === 'step') dispatch({ type: 'append', answerId, step: e.data as Step })
        }
        if (done) { dispatch({ type: 'liveEnd', answerId }); return }
      } catch (e) { log('error', `轮询失败：${e}`, undefined, 'reject') }
      setTimeout(poll, 300)
    }
    poll()
    return 'ok'
  }, [bundle.content_version, cancel, log])

  const goto = useCallback((index: number) => {
    const s = stateRef.current
    if (!s.answerId) return
    dispatch({ type: 'goto', answerId: s.answerId, index })
  }, [])
  const next = useCallback(() => {
    const s = stateRef.current
    if (!s.tour) return
    if (s.index + 1 >= s.tour.steps.length) {
      if (s.live && !s.live.finished) { dispatch({ type: 'wait', answerId: s.answerId! }); return }   // next step still being generated
      dispatch({ type: 'done', answerId: s.answerId! }); return
    }
    goto(s.index + 1)
  }, [goto])
  const prev = useCallback(() => goto(stateRef.current.index - 1), [goto])

  // log every applied step
  useEffect(() => {
    if (!state.tour || !state.answerId || state.index < 0) return
    const st = state.tour.steps[state.index]
    log('step', `步骤 ${st.seq + 1}/${state.tour.steps.length}「${st.title ?? ''}」镜头 → ${st.camera}；动作：${st.actions.map(a => `${a.op}(${a.targets.join(', ')})`).join('；') || '无'}`,
      st, 'playing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.epoch])

  useEffect(() => {
    if (state.status === 'done') log('done', '回答播放完毕（可以用“上一步”回看，或点击其他问题）', undefined, 'done')
    if (state.status === 'paused') log('pause', '已暂停：后续步骤保持在队列中', undefined, 'paused')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  // auto-advance
  useEffect(() => {
    if (state.status !== 'playing' || !state.tour || state.index < 0 || state.live?.waiting) return
    const step = state.tour.steps[state.index]
    const id = state.answerId
    const timer = setTimeout(() => {
      if (stateRef.current.answerId !== id) { log('drop', `丢弃：${id} 的步骤到达时回答已取消`, undefined, 'dropped'); return }
      next()
    }, stepDuration(step, state.speed))
    return () => clearTimeout(timer)
  }, [state.status, state.epoch, state.speed, state.answerId, state.index, state.tour, next, log])

  const value = useMemo<Ctx>(() => ({
    bundle, tours, state, trace, log, play, playLive, next, prev, cancel,
    pause: () => dispatch({ type: 'pause' }),
    resume: () => dispatch({ type: 'resume' }),
    setSpeed: (speed: number) => dispatch({ type: 'speed', speed }),
    clearTrace: () => setTrace([]),
  }), [bundle, tours, state, trace, log, play, playLive, next, prev, cancel])

  return <StageCtx.Provider value={value}>{children}</StageCtx.Provider>
}

/** Per-anchor visual flags for components. */
export function useFlags(anchor: string) {
  const { state } = useStage()
  const v = state.visual
  return {
    spot: v.spotlight.includes(anchor) || v.camera === anchor,
    pulse: v.pulse.includes(anchor),
    row: v.rows.includes(anchor),
    cell: v.cells.includes(anchor),
    hot: v.hotspots.includes(anchor),
    compare: v.compareRows.includes(anchor),
    pin: v.pins.includes(anchor),
    phase: v.phases.includes(anchor),
    epoch: state.epoch,
  }
}
