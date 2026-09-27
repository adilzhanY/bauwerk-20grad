/**
 * The roof of a LoD2 part in the terms of a simple editor: flat, gable or hip, a pitch and a
 * ridge direction.
 *
 * LoD2 roof shapes are standardised types (AdV "Dachform" codes) with about one metre of
 * height accuracy, so this keeps the character of the roof, not its details. Whenever the
 * editor cannot build what LoD2 says, the result says so in `note`.
 */
import type { Vec2 } from './footprint.ts'

export type RoofKind = 'flat' | 'gable' | 'hip'

export interface EditorRoof {
  kind: RoofKind
  /** Degrees from horizontal. */
  pitch: number
  ridgeAxis: 'x' | 'y'
  /** Why the roof differs from the LoD2 shape, when it does. */
  note: string | null
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

export function isAxisAlignedRectangle(polygon: readonly Vec2[]): boolean {
  return polygon.length === 4 && isRectilinear(polygon)
}

/**
 * The editor roof for a part. A gable works on any footprint (the editor splits it along the
 * ridge line); a hip only on a rectangle, so a hip elsewhere becomes a gable, with a note. `rise` is ridge height minus eave height in metres,
 * `planFootprint` the footprint in the plan frame, where the main walls run along the axes.
 */
export function editorRoof(code: string | null, rise: number, planFootprint: readonly Vec2[]): EditorRoof {
  const { width, depth } = bounds(planFootprint)
  const ridgeAxis: 'x' | 'y' = width >= depth ? 'x' : 'y'
  const span = Math.min(width, depth)
  const mapped = roofKindForCode(code)
  const pitch = pitchFor(rise, span)

  if (mapped.kind === 'flat' || rise < 0.5) {
    const note = mapped.kind === 'flat' && mapped.label !== 'Flachdach' ? `${mapped.label} als Flachdach vereinfacht` : null
    return { kind: 'flat', pitch: 0, ridgeAxis, note }
  }
  let kind: RoofKind = mapped.kind === 'mixed' ? 'gable' : mapped.kind
  const notes: string[] = []
  if (mapped.kind === 'mixed') notes.push('Mischform als Satteldach vereinfacht')
  if (kind === 'hip' && !isAxisAlignedRectangle(planFootprint)) {
    kind = 'gable'
    notes.push('Walmdach auf nicht rechteckigem Grundriss als Satteldach')
  }
  return { kind, pitch, ridgeAxis, note: notes.length ? notes.join('; ') : null }
}

/** Pitch from the rise over half the span, clamped to what the editor accepts. */
export function pitchFor(rise: number, span: number): number {
  if (!(rise > 0) || !(span > 0)) return 0
  const pitch = (Math.atan(rise / (span / 2)) * 180) / Math.PI
  return Math.round(Math.min(MAX_PITCH_DEG, pitch) * 10) / 10
}
