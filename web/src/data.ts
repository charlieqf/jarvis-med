import type { Bundle, Fact, Tour } from './types'

export const CASE = 'case1'
export const TOUR_IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']
const base = `${import.meta.env.BASE_URL}cases/${CASE}/`

export const asset = (path: string) => base + path

export async function loadBundle(): Promise<Bundle> {
  const r = await fetch(asset('bundle.json'))
  if (!r.ok) throw new Error(`bundle.json ${r.status}`)
  return r.json()
}

export async function loadTours(): Promise<Tour[]> {
  return Promise.all(TOUR_IDS.map(id => fetch(asset(`tours/${id}.json`)).then(r => r.json())))
}

const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' }
const sup = (s: string) => s.split('').map(c => SUPER[c] ?? c).join('')

/** Source notation -> display (mirrors pipeline/compile_tours.py pretty(); digits are never changed). */
export function pretty(text: string): string {
  return text
    .replace(/(\d(?:\.\d+)?)[eE]([-+]?\d+)/g, (_, m, e) => `${m}×10${sup(String(parseInt(e, 10)))}`)
    .replace(/(\d)\s*\*\s*(?!10)(\d)/g, '$1×$2')
    .replace(/\^\{([^}]*)\}/g, (_, x) => sup(x))
    .replace(/(\d)\s*\*\s*10/g, '$1×10')
    .replace(/×10(-\d+)/g, (_, x) => '×10' + sup(x))
}

export const stripBullet = (t: string) => t.replace(/^\s*[·\-]\s*/, '')

export function dateLabel(iso?: string | null) {
  return iso ? iso.replace(/-/g, '.') : ''
}

/** Badges a fact must carry wherever it is shown (review rules, DESIGN §3.3/3.4). */
export function badges(f: Fact | undefined): { key: string; text: string; title: string }[] {
  if (!f) return []
  const out: { key: string; text: string; title: string }[] = []
  const rev = f.review
  if (f.eff.pending && rev?.proposed) {
    const p = rev.proposed as Record<string, unknown>
    const shown = p.text ?? p.unit ?? p.value ?? p.date ?? (p.exclude ? '删除' : '')
    out.push({ key: 'pending', text: `疑为 ${shown}`, title: `原文如此；建议：${shown}（未确认）。依据：${rev.basis ?? ''}` })
  } else if (rev?.status === 'unreviewed' && rev.issue && f.origin === 'pptx') {
    out.push({ key: 'issue', text: '待核', title: rev.issue })
  }
  if (rev?.status === 'confirmed' && rev.proposed) out.push({ key: 'fixed', text: '已校对', title: `原文：${f.raw}；依据：${rev.basis ?? ''}` })
  if (f.origin === 'image' && rev?.status !== 'confirmed') out.push({ key: 'image', text: '图读', title: '从原稿图片中读出，未经人工核对' })
  if (f.date_basis === 'inferred') out.push({ key: 'inferred', text: '日期推断', title: f.date_note ?? '' })
  if (f.eff.date_pending) out.push({ key: 'pending', text: '日期待核', title: '日期存在未确认的修正建议' })
  return out
}
