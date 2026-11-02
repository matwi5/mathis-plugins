// Le plan des vagues du projet : le COO range les départs des groupes de toutes les missions non
// archivées en vagues du projet, pour faire tourner le plus de groupes ensemble sans fichier ni
// ressource en commun, en gardant l'ordre interne de chaque mission ; il ne change jamais la
// composition d'un groupe. Validé (d'un clic, ou d'office pour une mission en auto), le plan devient un
// ordre de départ dans le fichier de coordination : une entrée par attente (un groupe, ce qu'il attend
// dans une autre mission).
//
// Module pur : le calcul (`projectPlan`) prend les unités que `model.ts` relève (`projectUnits`) ; les
// attentes d'une mission (`planHolds`) se lisent des entrées relues.
//
// Invariant : « Un groupe ne part jamais avant ce que le plan validé lui fait attendre, sauf forçage ; un
// plan illisible ne lance rien, et les retenues de fichiers restent. »

import { isGroupId, isSafeId } from './closing.ts'

/** Une unité de travail d'une mission, telle que le plan la range : un groupe, ou le lot sans groupes (`*`). */
export type PlanUnit = {
  run: string
  title: string
  group: string
  /** Déjà parti (confié à un worker, ou commencé ici) : il reste dans la première vague. */
  isBusy: boolean
  /** Les groupes de la même mission qu'il attend (ses bloqueurs encore ouverts). */
  after: readonly string[]
}

/** Une unité nommée dans le plan. */
export type PlanRef = { run: string; title: string; group: string }

/** Une attente du plan : l'unité retenue (sa mission, son groupe) et l'unité d'une autre mission qu'elle attend. */
export type PlanWait = { run: string; group: string; awaited: { run: string; group: string } }

/** Le plan du projet : les vagues (unités qui partent ensemble ; livraisons des missions qui finissent après elle), et les attentes entre missions. */
export type ProjectPlan = { waves: { units: PlanRef[]; deliveries: { run: string; title: string }[] }[]; waits: PlanWait[] }

const keyOf = (u: { run: string; group: string }): string => `${u.run}\u0000${u.group}`

/**
 * Le plan, sur les unités pas encore finies de toutes les missions : la première vague garde ce qui est
 * déjà parti ; chaque vague prend, parmi les unités dont les attentes de leur mission sont passées,
 * d'abord celles qui ont le moins de conflits, chacune seulement si elle n'a rien en commun
 * (`overlaps`) avec celles déjà prises dans la vague. Une unité attend, dans une autre mission, chaque
 * unité d'une vague plus tôt avec qui elle a quelque chose en commun.
 */
export const projectPlan = <U extends PlanUnit>(units: readonly U[], overlaps: (a: U, b: U) => boolean): ProjectPlan => {
  const all = units.filter((u, i) => units.findIndex(v => keyOf(v) === keyOf(u)) === i)
  const known = new Set(all.map(keyOf))
  const degree = new Map(all.map(u => [keyOf(u), all.filter(v => v !== u && overlaps(u, v)).length]))
  const waveOf = new Map<string, number>()
  const waves: PlanRef[][] = []
  const busy = all.filter(u => u.isBusy)
  if (busy.length > 0) {
    waves.push(busy.map(u => ({ run: u.run, title: u.title, group: u.group })))
    for (const u of busy) waveOf.set(keyOf(u), 0)
  }
  let remaining = all.filter(u => !u.isBusy)
  // Une attente de sa mission passée : l'unité attendue est rangée plus tôt, ou n'est pas dans le plan (finie).
  const isFree = (u: U, w: number) => u.after.every(g => !known.has(keyOf({ run: u.run, group: g })) || (waveOf.get(keyOf({ run: u.run, group: g })) ?? Infinity) < w)
  for (let w = 0; remaining.length > 0; w++) {
    const taken = all.filter(u => waveOf.get(keyOf(u)) === w)
    const order = remaining.filter(u => isFree(u, w)).sort((a, b) => degree.get(keyOf(a))! - degree.get(keyOf(b))! || all.indexOf(a) - all.indexOf(b))
    const picked: U[] = []
    for (const u of order) if (![...taken, ...picked].some(v => overlaps(u, v))) picked.push(u)
    // Une attente circulaire dans une mission : le reste passe ensemble, pour que le calcul finisse.
    const placed = picked.length > 0 || taken.length > 0 ? picked : remaining
    if (placed.length === 0) {
      if (w > all.length + 1) break
      continue
    }
    for (const u of placed) waveOf.set(keyOf(u), w)
    waves[w] = [...(waves[w] ?? []), ...placed.map(u => ({ run: u.run, title: u.title, group: u.group }))]
    remaining = remaining.filter(u => !placed.includes(u))
  }
  const waits: PlanWait[] = []
  for (const u of all) {
    if (u.isBusy) continue
    const w = waveOf.get(keyOf(u)) ?? 0
    for (const v of all) {
      if (v.run === u.run || (waveOf.get(keyOf(v)) ?? Infinity) >= w || !overlaps(u, v)) continue
      waits.push({ run: u.run, group: u.group, awaited: { run: v.run, group: v.group } })
    }
  }
  const lastWave = new Map<string, { at: number; title: string }>()
  for (const u of all) lastWave.set(u.run, { at: Math.max(lastWave.get(u.run)?.at ?? -1, waveOf.get(keyOf(u)) ?? 0), title: u.title })
  const compact = waves.filter(x => x !== undefined && x.length > 0)
  return {
    waves: compact.map((list, i) => ({
      units: list,
      // Une mission dont la dernière unité est dans cette vague se livre après elle (la livraison suit la vague).
      deliveries: [...lastWave].filter(([, x]) => compact.indexOf(waves[x.at]!) === i).map(([run, x]) => ({ run, title: x.title })),
    })),
    waits,
  }
}

/** Des attentes qui se bouclent (A attend B qui attend A, directement ou par d'autres) : aucune ne partirait. */
export const hasWaitCycle = (waits: readonly PlanWait[]): boolean => {
  const next = new Map<string, string[]>()
  for (const w of waits) next.set(keyOf(w), [...(next.get(keyOf(w)) ?? []), keyOf(w.awaited)])
  const state = new Map<string, 'open' | 'done'>()
  const visit = (k: string): boolean => {
    if (state.get(k) === 'open') return true
    if (state.get(k) === 'done') return false
    state.set(k, 'open')
    const isCycle = (next.get(k) ?? []).some(visit)
    state.set(k, 'done')
    return isCycle
  }
  return [...next.keys()].some(visit)
}

/** La clé d'un ensemble d'attentes : deux plans qui font attendre la même chose ont la même clé. */
export const waitsKey = (waits: readonly PlanWait[]): string =>
  [...new Set(waits.map(w => `${w.run}/${w.group}>${w.awaited.run}/${w.awaited.group}`))].sort().join(',')

/** Une unité d'une attente : un id de groupe en forme, ou `*` (le lot sans groupes). */
export const isPlanUnit = (v: unknown): v is string => v === '*' || isGroupId(v)

/** Une attente relue d'une entrée du fichier de coordination ; null hors forme. */
export const soundPlanWait = (raw: unknown): PlanWait | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  const w = x.awaited !== null && typeof x.awaited === 'object' && !Array.isArray(x.awaited) ? (x.awaited as Record<string, unknown>) : {}
  if (!isSafeId(x.run) || !isPlanUnit(x.held) || !isSafeId(w.run) || w.run === x.run || !isPlanUnit(w.group)) return null
  return { run: x.run, group: x.held, awaited: { run: w.run, group: w.group } }
}
