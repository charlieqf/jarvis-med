import { useEffect, useMemo, useState } from 'react'
import { BlockView, Hero } from './blocks'
import { loadBundle, loadTours } from './data'
import { Caption, LiftLayer, SourceViewer, StageLayer } from './overlay'
import { HoloLayer } from './holo'
import { ChatBox, Sidebar, TracePanel } from './panels'
import { StageProvider, useStage } from './stage'
import type { Bundle, Tour } from './types'
import { UICtx } from './ui'

export default function App() {
  const [data, setData] = useState<{ bundle: Bundle; tours: Tour[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { Promise.all([loadBundle(), loadTours()]).then(([bundle, tours]) => setData({ bundle, tours })).catch(e => setErr(String(e))) }, [])
  if (err) return <div className="boot">数据加载失败：{err}</div>
  if (!data) return <div className="boot">正在载入病例数据…</div>
  return <StageProvider bundle={data.bundle} tours={data.tours}><Shell /></StageProvider>
}

function Shell() {
  const { bundle, state, cancel } = useStage()
  const [source, setSource] = useState<{ fact?: string; slide?: number } | null>(null)
  const [browseHolo, setBrowseHolo] = useState<string | null>(null)
  const ui = useMemo(() => ({ openSource: (fact: string) => setSource({ fact }), openSlide: (slide: number) => setSource({ slide }), openHolo: (id: string) => setBrowseHolo(id) }), [])
  const touring = !!state.tour && state.status !== 'cancelled'
  const holo = (touring ? state.visual.holo : undefined) ?? browseHolo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (source) setSource(null); else if (browseHolo) setBrowseHolo(null); else cancel('Esc') } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [source, cancel, browseHolo])

  return (
    <UICtx.Provider value={ui}>
      <div className={`app ${touring ? 'touring' : ''}`}>
        <Sidebar />
        <main className="main">
          <div className="scroll">
            <Hero />
            {bundle.sections.map(s => {
              const blocks = bundle.blocks.filter(b => b.section === s.id && !(b.type === 'image' && (b.role === 'cover' || b.role === 'logo')))
              if (!blocks.length) return null
              return (
                <section key={s.id} id={s.id} className="sec">
                  <h2 className="sec-title">{s.label}</h2>
                  <div className={`sec-grid sec-${s.id.split('.')[1]}`}>{blocks.map(b => <BlockView key={b.id} block={b} />)}</div>
                </section>
              )
            })}
            <footer className="foot">所有数值均来自原稿 HOPE_案例1.pptx，点击任意数值可查看出处；标有“图读”“待核”“疑为”的内容尚未经人工审核。</footer>
          </div>
          {holo && <HoloLayer key={holo} sceneId={holo} onClose={touring ? undefined : () => setBrowseHolo(null)} />}
          <Caption />
          <div className="dock">
            <ChatBox />
            <TracePanel />
          </div>
        </main>
        {!holo && <StageLayer />}
        {!holo && <LiftLayer />}
        {source && <SourceViewer factId={source.fact} slide={source.slide} onClose={() => setSource(null)} />}
      </div>
    </UICtx.Provider>
  )
}
