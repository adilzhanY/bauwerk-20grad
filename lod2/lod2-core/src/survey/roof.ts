/**
 * The roof of a LoD2 part in the terms of a simple editor: flat, gable or hip, a pitch and a
 * ridge direction.
 *
 * LoD2 roof shapes are standardised types (AdV "Dachform" codes) with about one metre of
 * height accuracy, so this keeps the character of the roof, not its details. Whenever the
 * editor cannot build what LoD2 says, the result says so in `note`.
 */
import type { Vec2 } from './footprint.ts'
import { germanNote, message, type SurveyMessage } from './messages.ts'

export type RoofKind = 'flat' | 'gable' | 'hip'

export interface EditorRoof {
  kind: RoofKind
  /** Degrees from horizontal. */
  pitch: number
  ridgeAxis: 'x' | 'y'
  /** Why the roof differs from the LoD2 shape, when it does, in German. */
  note: string | null
  /** The same as message keys, empty when the roof is as LoD2 says. */
  messages: SurveyMessage[]
}

const MAX_PITCH_DEG = 60

/** AdV Dachform codes, the ones Berlin uses. */
export function roofKindForCode(code: string | null): { kind: RoofKind | 'mixed'; label: string } {
  switch (code) {
    case '1000': return { kind: 'flat', label: 'Flachdach' }
    case '2100': return { kind: 'flat', label: 'Pultdach' }
    case '2200': return { kind: 'flat', label: 'Versetztes Pultdach' }
    case '3100': return { kind: 'gable', label: 'Satteldach' }
    case '3200': return { kind: 'hip', label: 'Walmdach' }
    case '3300': return { kind: 'hip', label: 'Krüppelwalmdach' }
    case '3400': return { kind: 'gable', label: 'Mansardendach' }
    case '3500': return { kind: 'hip', label: 'Zeltdach' }
    case '5000': return { kind: 'mixed', label: 'Mischform' }
    default: return { kind: 'flat', label: 'unbekannt' }
  }
}

function bounds(polygon: readonly Vec2[]) {
  const xs = polygon.map((p) => p.x)
  const ys = polygon.map((p) => p.y)
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) }
}

/** True when every edge runs along plan x or plan y. */
export function isRectilinear(polygon: readonly Vec2[], eps = 1e-6): boolean {
  return polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!
    return Math.abs(a.x - b.x) < eps || Math.abs(a.y - b.y) < eps
  })
}

export function isAxisAlignedRectangle(polygon: readonly Vec2[], eps = 1e-6): boolean {
  return polygon.length === 4 && isRectilinear(polygon, eps)
}

export interface Rect {
  min: Vec2
  max: Vec2
}

/**
 * Splits a rectilinear polygon into rectangles that are long along `axis`: cut it into strips
 * across the axis at every vertex coordinate, then merge neighbouring strips with the same
 * extent. An L shape gives its two wings. The editor builds one gable on each.
 */
export function decomposeRectilinear(polygon: readonly Vec2[], axis: 'x' | 'y'): Rect[] {
  const across = (p: Vec2) => (axis === 'x' ? p.y : p.x)
  const along = (p: Vec2) => (axis === 'x' ? p.x : p.y)
  const levels = [...new Set(polygon.map((p) => Math.round(across(p) * 1e6) / 1e6))].sort((a, b) => a - b)
  const strips: { c0: number; c1: number; a0: number; a1: number }[] = []
  for (let i = 0; i + 1 < levels.length; i++) {
    const c0 = levels[i]!
    const c1 = levels[i + 1]!
    const mid = (c0 + c1) / 2
    // A line through the strip middle crosses the polygon at edges running across the axis.
    const xs: number[] = []
    polygon.forEach((p, k) => {
      const q = polygon[(k + 1) % polygon.length]!
      if (Math.abs(across(p) - across(q)) < 1e-9) return
      if (mid > Math.min(across(p), across(q)) && mid < Math.max(across(p), across(q))) xs.push(along(p))
    })
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) strips.push({ c0, c1, a0: xs[k]!, a1: xs[k + 1]! })
  }
  // Merge strips stacked across the axis with the same along extent.
  const merged: typeof strips = []
  for (const s of strips.sort((p, q) => p.a0 - q.a0 || p.c0 - q.c0)) {
    const prev = merged.find((m) => Math.abs(m.a0 - s.a0) < 1e-9 && Math.abs(m.a1 - s.a1) < 1e-9 && Math.abs(m.c1 - s.c0) < 1e-9)
    if (prev) prev.c1 = s.c1
    else merged.push({ ...s })
  }
  return merged.map((m) =>
    axis === 'x' ? { min: { x: m.a0, y: m.c0 }, max: { x: m.a1, y: m.c1 } } : { min: { x: m.c0, y: m.a0 }, max: { x: m.c1, y: m.a1 } })
}

/**
 * The span across the ridge that the pitch is measured over: the widest wing when the editor
 * builds one gable per wing (a rectilinear outline), else the whole outline.
 */
export function roofSpan(planFootprint: readonly Vec2[], ridgeAxis: 'x' | 'y'): number {
  const across = (r: Rect) => (ridgeAxis === 'x' ? r.max.y - r.min.y : r.max.x - r.min.x)
  if (isRectilinear(planFootprint)) return Math.max(0, ...decomposeRectilinear(planFootprint, ridgeAxis).map(across))
  const { width, depth } = bounds(planFootprint)
  return ridgeAxis === 'x' ? depth : width
}

/**
 * The editor roof for a part. A gable works on any footprint (the editor splits it along the
 * ridge line); a hip only on a rectangle, so a hip elsewhere becomes a gable, with a note. `rise` is ridge height minus eave height in metres,
 * `planFootprint` the footprint in the plan frame, where the main walls run along the axes.
 */
export function editorRoof(code: string | null, rise: number, planFootprint: readonly Vec2[]): EditorRoof {
  const { width, depth } = bounds(planFootprint)
  const ridgeAxis: 'x' | 'y' = width >= depth ? 'x' : 'y'
  const span = roofSpan(planFootprint, ridgeAxis)
  const mapped = roofKindForCode(code)
  const pitch = pitchFor(rise, span)

  const messages: SurveyMessage[] = []
  const result = (kind: RoofKind, pitch: number): EditorRoof =>
    ({ kind, pitch, ridgeAxis, note: messages.length ? germanNote(messages) : null, messages })
  if (mapped.kind === 'flat' || rise < 0.5) {
    if (mapped.kind === 'flat' && mapped.label !== 'Flachdach') messages.push(message('survey.roof.flatSimplified', { roofType: code ?? '' }))
    return result('flat', 0)
  }
  let kind: RoofKind = mapped.kind === 'mixed' ? 'gable' : mapped.kind
  if (mapped.kind === 'mixed') messages.push(message('survey.roof.mixedAsGable'))
  if (kind === 'hip' && !isAxisAlignedRectangle(planFootprint)) {
    kind = 'gable'
    messages.push(message('survey.roof.hipAsGable'))
  }
  return result(kind, pitch)
}

/** Pitch from the rise over half the span, clamped to what the editor accepts. */
export function pitchFor(rise: number, span: number): number {
  if (!(rise > 0) || !(span > 0)) return 0
  const pitch = (Math.atan(rise / (span / 2)) * 180) / Math.PI
  return Math.round(Math.min(MAX_PITCH_DEG, pitch) * 10) / 10
}
