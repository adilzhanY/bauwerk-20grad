/**
 * Registry of state adapters.
 *
 * Berlin is the only one here. Adding another state means adding one file beside `be.ts` and
 * registering it below, and nothing else: the crawler, loader, API and viewer are all
 * state-agnostic, and every per-state fact — CRS, tile grid, how the catalogue is discovered,
 * which DOP service to ask — lives on the adapter object.
 */
import type { StateAdapter, StateCode } from 'lod2-core'
import { be } from './be.ts'

export const adapters: Partial<Record<StateCode, StateAdapter>> = { BE: be }

export function getAdapter(code: string): StateAdapter {
  const a = adapters[code.toUpperCase() as StateCode]
  if (!a) {
    const known = Object.keys(adapters).join(', ')
    throw new Error(`No adapter for state "${code}". Implemented: ${known}`)
  }
  return a
}

export const adapterCodes = Object.keys(adapters) as StateCode[]
