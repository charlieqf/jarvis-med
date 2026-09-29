// Shapes of web/public/cases/<case>/bundle.json and tours/*.json (see pipeline/compile_web.py, compile_tours.py)

export interface Effective {
  status: string
  pending: boolean
  excluded: boolean
  value?: number
  unit?: string | null
  date?: string
  date_pending?: boolean
  text?: string | null
}

export interface Review {
  status: 'unreviewed' | 'confirmed' | 'rejected' | 'excluded'
  proposed?: Record<string, unknown> | null
  issue?: string | null
  basis?: string | null
  by?: string | null
  at?: string | null
}

export interface Fact {
  id: string
  type: 'unit' | 'date' | 'value'
  kind: string
  raw: string | null
  origin: 'pptx' | 'image' | 'inferred'
  attrs?: Record<string, string>
  excluded?: string
  slide?: number
  unit?: string
  span?: [number, number]
  image?: string
  bbox?: [number, number, number, number]
  eff: Effective
  date_basis?: string
  date_note?: string
  date_ref?: string
  review?: Review
  implied_unit?: { unit: string; basis: string }
  emphasis?: string[]
  inner?: string[]
}

export interface Section { id: string; label: string }

export interface Annotation { id: string; shape: number; facts: string[]; geom?: string; rel_bbox: number[] }
export interface Picture { src: string; bbox: number[]; crop: number[]; px: number[] }

export interface Block {
  id: string
  section: string
  type: string
  label?: string
  role?: string
  title?: string[]
  caption?: string[]
  heading?: string[]
  units?: string[]
  notes?: string[]
  footnotes?: string[]
  citations?: string[]
  label_units?: string[]
  facts?: string[]
  groups?: { id: string; title?: string[]; units: string[] }[]
  // table
  rows?: (string | null)[][] | CompareRow[]
  slide?: number
  // phases / timeline
  phases?: Phase[]
  events?: TimelineEvent[]
  // series
  series?: Series[]
  // image
  src?: string
  bbox?: number[]
  crop?: number[]
  px?: number[]
  annotations?: Annotation[]
  overlays?: { shape: number; src: string; rel_bbox: number[]; reason: string }[]
  placements?: (Picture & { shape: number })[]
  date?: string
  // stacked bar
  segments?: string[]
  totals?: string[]
  total_labels?: string[]
  // deck
  slides?: { n: number; src: string }[]
  // body map
  pins?: Pin[]
  // holographic scene
  scene?: string
  note?: string
  pin_refs?: string[]
  phase_refs?: string[]
  series_refs?: string[]
}

export interface CompareRow { id: string; label?: string; label_unit?: string; label_fact?: string; facts: string[] }
export interface Phase { id: string; label: string; start: string; end: string | null; chapter: string[] }
export interface TimelineEvent { id: string; date: string; kind: string; label: string; milestone?: boolean; units: string[]; facts?: string[]; links?: string[] }
export interface SeriesPoint { fact: string; corroborate?: string[] }
export interface Series { id: string; label: string; scale: 'linear' | 'log'; points: SeriesPoint[]; held?: { fact: string; reason: string }[]; reference?: string; source_image?: string }
export interface Pin { id: string; region: string; annotation: string; facts: string[]; date: string }

export interface Bundle {
  case: string
  content_version: string
  aspect: number
  meta: { title: string[]; institution: string[] }
  sections: Section[]
  blocks: Block[]
  facts: Record<string, Fact>
}

export interface Claim { claim: string; type: string; text: string; cite: string[]; flags?: string[]; verbatim?: boolean }
export interface Action { op: string; targets: string[] }
export interface Step { id: string; seq: number; camera: string; title?: string; actions: Action[]; say: Claim[]; callouts: { target: string; claim: string }[] }
export interface Tour {
  id: string
  question: string
  content_version: string
  reviewed_by: string | null
  steps: Step[]
  checks: { claim: string; type: string; cite: string[]; flags: string[]; result: string }[]
}
