import { useEffect, useRef, useState } from 'react'
import { useStage } from './stage'
import type { Tour } from './types'

// ------------------------------------------------------------------ left rail

export function Sidebar() {
  const { tours, bundle, state, play } = useStage()
  return (
    <aside className="rail">
      <div className="rail-brand"><b>JARVIS</b><span>病例看板</span></div>
      <div className="rail-title">推荐问题</div>
      <ol className="top5">
        {tours.map(t => {
          const stale = t.content_version !== bundle.content_version
          return (
            <li key={t.id}>
              <button className={state.tour?.id === t.id ? 'on' : ''} onClick={() => play(t, { via: 'click' })} disabled={stale}>
                <span className="tid">{t.id}</span>{t.question}
                {stale && <em className="badge badge-pending">待重审</em>}
              </button>
            </li>
          )
        })}
      </ol>
      <div className="rail-title">章节</div>
      <nav className="toc">
        {bundle.sections.map(s => <a key={s.id} href={`#${s.id}`}>{s.label}</a>)}
      </nav>
      <div className="rail-foot">数据版本 {bundle.content_version}</div>
    </aside>
  )
}

// ------------------------------------------------------------------ chat (P2: routes to preset tours only)

const KEYWORDS: Record<string, string[]> = {
  T1: ['历程', '经过', '病程', '治疗史', '时间线', '怎么治', '全过程', '3年'],
  T2: ['M蛋白', 'm蛋白', '轻链', 'MRD', 'mrd', '变化', '趋势', '指标'],
  T3: ['高危', '髓外', '部位', '哪里', '复发部位', 'FISH', '1q21'],
  T4: ['CAR-T', 'CART', 'car-t', 'CRS', '不良反应', 'IL-6', '细胞治疗', '副作用'],
  T5: ['埃纳妥', '兆珂速', '联合', '文献', 'MagnetisMM', '双抗', '为什么选择', '最新'],
}

export function route(input: string, tours: Tour[]) {
  const scores = tours.map(t => ({ t, score: (KEYWORDS[t.id] ?? []).filter(k => input.includes(k)).length }))
  scores.sort((a, b) => b.score - a.score)
  return { best: scores[0], all: scores }
}

export function ChatBox() {
  const { tours, play, log } = useStage()
  const [text, setText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const submit = () => {
    const q = text.trim()
    if (!q) return
    const r = route(q, tours)
    log('input', `用户提问：「${q}」`)
    log('route', `预编导览匹配：${r.all.map(x => `${x.t.id}=${x.score}`).join('，')}`, r.all.map(x => ({ id: x.t.id, score: x.score })))
    if (r.best.score >= 1 && r.best.score > (r.all[1]?.score ?? 0)) {
      play(r.best.t, { via: 'match', score: r.best.score, input: q })
      setNotice(null)
    } else {
      setNotice('这个问题没有匹配到预先审核过的导览。模型实时编排（慢速路径）将在 P3 接入；目前可以点击左侧的推荐问题。')
      log('fallback', '未明确命中预编导览 → 慢速路径（模型实时编排回答计划）将在 P3 接入；可以先点击左侧推荐问题', undefined, 'pending')
    }
    setText('')
  }
  return (
    <form className="chat" onSubmit={e => { e.preventDefault(); submit() }}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="用自然语言提问，例如：CAR-T 之后发生了什么？" aria-label="提问" />
      <button type="submit">提问</button>
      {notice && <div className="chat-notice" role="status">{notice}<button type="button" className="x" onClick={() => setNotice(null)}>×</button></div>}
    </form>
  )
}

// ------------------------------------------------------------------ agent process panel

const KIND_LABEL: Record<string, string> = {
  input: '提问', route: '路由', version: '版本', plan: '计划', check: '校验', step: '执行', done: '完成',
  pause: '暂停', cancel: '取消', drop: '丢弃', fallback: '回退',
}

export function TracePanel() {
  const { trace, clearTrace } = useStage()
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight }, [trace.length])
  const exportTrace = () => {
    const blob = new Blob([JSON.stringify(trace, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `jarvis-trace-${Date.now()}.json`
    a.click()
  }
  return (
    <div className={`trace ${open ? 'open' : ''}`}>
      <div className="trace-head">
        <button className="ghost" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Agent 过程</button>
        <span className="hint">路由 → 计划 → 校验 → 执行；点击任意一行查看原始 JSON</span>
        <button className="ghost" onClick={exportTrace}>导出</button>
        <button className="ghost" onClick={clearTrace}>清空</button>
      </div>
      {open && (
        <div className="trace-body" ref={body}>
          {trace.length === 0 && <div className="trace-empty">点击左侧推荐问题或在上方提问，这里会实时显示处理过程。</div>}
          {trace.map(e => (
            <div key={e.id} className={`tr tr-${e.kind} ${e.status ? 'st-' + e.status : ''}`} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
              <span className="tr-t">{(e.t / 1000).toFixed(2)}s</span>
              <span className="tr-k">{KIND_LABEL[e.kind] ?? e.kind}</span>
              {e.answerId && <span className="tr-a">{e.answerId}</span>}
              <span className="tr-x">{e.text}</span>
              {expanded === e.id && e.data !== undefined && <pre>{JSON.stringify(e.data, null, 1)}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
