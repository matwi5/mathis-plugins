// Coût estimé d'un sous-agent (Q15 : les prix de ccusage). Fonctions pures.
//
// - ccusage ne publie pas ses prix unitaires : sa sortie `claude session --json` donne, par
//   discussion et par modèle, les tokens par sorte et leur coût. Les prix unitaires d'un modèle
//   s'en tirent par moindres carrés positifs (une équation par discussion), au plus une fois par
//   jour. Sur les discussions de ce poste, ils redonnent le coût de ccusage à 3 % près (médiane).
// - Coût d'un sous-agent = ses tokens par sorte × les prix de son modèle ; toujours affiché « ≈ ».
// - Un modèle trop peu vu (moins de jours que de prix à tirer) n'a pas de prix : « coût indisponible ».

import type { AgentTokens } from '../types'

/** Les prix d'un modèle, en dollars par token. */
export type UnitPrices = { input: number; output: number; cacheRead: number; cacheWrite: number }

const KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

/** Résout A·x = b (petit système carré) par élimination de Gauss avec pivot ; null si singulier. */
const solve = (a: number[][], b: number[]): number[] | null => {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]!])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r
    if (Math.abs(m[p]![c]!) < 1e-12) return null
    ;[m[c], m[p]] = [m[p]!, m[c]!]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r]![c]! / m[c]![c]!
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!
    }
  }
  return m.map((row, i) => row[n]! / row[i]!)
}

/**
 * Moindres carrés positifs sur peu d'inconnues : les colonnes sont mises à l'échelle, une
 * inconnue négative (ou indéterminée) est fixée à 0 et le reste refait. Rend null si rien ne reste.
 */
const fitPositive = (rows: readonly (readonly number[])[], costs: readonly number[]): number[] | null => {
  const n = rows[0]?.length ?? 0
  const scale = Array.from({ length: n }, (_, j) => Math.sqrt(rows.reduce((s, r) => s + r[j]! * r[j]!, 0)) || 0)
  let active = Array.from({ length: n }, (_, j) => j).filter(j => scale[j]! > 0)
  while (active.length > 0) {
    if (rows.length < active.length) return null
    const ata = active.map(i => active.map(j => rows.reduce((s, r) => s + (r[i]! / scale[i]!) * (r[j]! / scale[j]!), 0)))
    const atb = active.map(i => rows.reduce((s, r, t) => s + (r[i]! / scale[i]!) * costs[t]!, 0))
    const x = solve(ata, atb)
    if (x === null) {
      // Indéterminé : la colonne la moins présente sort.
      active = active.filter(j => j !== active.reduce((lo, k) => (scale[k]! < scale[lo]! ? k : lo), active[0]!))
      continue
    }
    const worst = x.reduce((lo, v, i) => (v < x[lo]! ? i : lo), 0)
    if (x[worst]! < 0) {
      active = active.filter((_, i) => i !== worst)
      continue
    }
    const out = Array.from({ length: n }, () => 0)
    active.forEach((j, i) => (out[j] = x[i]! / scale[j]!))
    return out
  }
  return null
}

/**
 * Les prix unitaires par modèle, tirés d'une sortie `ccusage claude session --json` (ou `daily
 * --breakdown --json` : la même forme, par jour). Une sortie illisible, ou vide, rend {} : le coût
 * sera « indisponible ».
 */
export const pricesFromCcusage = (json: unknown): Record<string, UnitPrices> => {
  const value = json as { sessions?: unknown; daily?: unknown } | null
  const days = value?.sessions ?? value?.daily
  if (!Array.isArray(days)) return {}
  const byModel = new Map<string, { rows: number[][]; costs: number[] }>()
  for (const day of days) {
    const list = (day as { modelBreakdowns?: unknown }).modelBreakdowns
    if (!Array.isArray(list)) continue
    for (const m of list as Record<string, unknown>[]) {
      const num = (k: string): number => (typeof m[k] === 'number' && Number.isFinite(m[k]) ? (m[k] as number) : 0)
      const name = typeof m.modelName === 'string' ? m.modelName : ''
      if (name === '' || num('cost') <= 0) continue
      const entry = byModel.get(name) ?? { rows: [], costs: [] }
      entry.rows.push([num('inputTokens'), num('outputTokens'), num('cacheReadTokens'), num('cacheCreationTokens')])
      entry.costs.push(num('cost'))
      byModel.set(name, entry)
    }
  }
  const prices: Record<string, UnitPrices> = {}
  for (const [name, { rows, costs }] of byModel) {
    const x = fitPositive(rows, costs)
    if (x) prices[name] = { input: x[0]!, output: x[1]!, cacheRead: x[2]!, cacheWrite: x[3]! }
  }
  return prices
}

/** Le modèle d'un relevé (`haiku`, `claude-haiku-5-5`, `claude-haiku-5-5-20261001`) rapproché des noms de ccusage. */
export const pricesFor = (prices: Readonly<Record<string, UnitPrices>>, model: string | undefined): UnitPrices | undefined => {
  if (model === undefined || model === '') return undefined
  if (prices[model]) return prices[model]
  const base = model.replace(/-\d{8}$/, '')
  if (prices[base]) return prices[base]
  // Un alias (`haiku`) : le seul modèle de ccusage qui le porte.
  const named = Object.keys(prices).filter(k => k.includes(model))
  return named.length === 1 ? prices[named[0]!] : undefined
}

/** Le coût estimé de tokens au prix d'un modèle ; null sans prix. */
export const costOf = (tokens: AgentTokens | undefined, prices: UnitPrices | undefined): number | null =>
  tokens && prices ? KEYS.reduce((sum, k) => sum + tokens[k] * prices[k], 0) : null

/** « ≈ 0,84 $ », « ≈ 0,004 $ » : toujours avec « ≈ ». */
export const costText = (usd: number): string => {
  const digits = usd >= 1 ? 2 : usd >= 0.01 ? 2 : 3
  return `≈${' '}${usd.toFixed(digits).replace('.', ',')}${' '}$`
}
