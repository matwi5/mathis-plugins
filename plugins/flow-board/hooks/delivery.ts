// La livraison lancée chez le COO (« ▶ Livrer ») : ses étapes, dans l'ordre, et leur état.
//
// Invariant : « Rien n'est poussé sans un clic "▶ Livrer" de l'utilisateur ; une étape de la livraison ne
// part que si la précédente a réussi ; une seule livraison à la fois. » Une livraison ne naît que du clic
// (`newDelivery`), une étape ne démarre que si toutes celles d'avant sont faites (`startStep`), et une
// livraison pas finie (une étape en cours, échouée ou à faire) en refuse une autre (`isDeliveryOpen`).

import type { Run } from '../types'
import { isReportValidated } from './basics.ts'
import { neutralLine } from './closing.ts'

/** Les étapes, dans l'ordre : les trois skills réservés du plugin project, puis celles du `CLAUDE.md` du projet. */
export type DeliveryKey = 'version' | 'push' | 'pr' | 'project'
export const DELIVERY_KEYS: readonly DeliveryKey[] = ['version', 'push', 'pr', 'project']

/** Le skill réservé qu'une étape lance par `$.command.run` ; l'étape du projet est un message du mod à Claude. */
export const DELIVERY_COMMAND: Partial<Record<DeliveryKey, string>> = { version: 'project:version', push: 'project:push', pr: 'project:pr' }

export const DELIVERY_FR: Record<DeliveryKey, string> = { version: '/project:version', push: '/project:push', pr: '/project:pr', project: 'étapes du CLAUDE.md' }

/** Une étape : à faire, lancée (son issue attendue de Claude), faite ou échouée ; `detail`, ce que Claude en a dit. */
export type DeliveryStep = { key: DeliveryKey; status: 'todo' | 'running' | 'done' | 'failed'; at?: number; detail?: string }

/**
 * Une livraison : son id, les missions au rapport validé qu'elle livre (avec la date de leur validation : une
 * mission livrée ne redevient livrable que sur un nouveau rapport validé), ses étapes, son début et sa fin.
 */
export type Delivery = { v: 1; id: string; missions: { id: string; title: string; validatedAt: number }[]; steps: DeliveryStep[]; startedAt: number; finishedAt?: number }

/** Le plus long détail gardé d'une étape. */
const DETAIL_MAX = 300

const isKey = (v: unknown): v is DeliveryKey => typeof v === 'string' && (DELIVERY_KEYS as readonly string[]).includes(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)

/** La livraison du clic : version, push, pull request (projet sur GitHub seulement), puis les étapes du projet. */
export const newDelivery = (id: string, missions: readonly { id: string; title: string; validatedAt: number }[], isGitHub: boolean, now: number): Delivery => ({
  v: 1,
  id,
  missions: missions.map(m => ({ id: m.id, title: m.title, validatedAt: m.validatedAt })),
  steps: DELIVERY_KEYS.filter(k => k !== 'pr' || isGitHub).map(key => ({ key, status: 'todo' as const })),
  startedAt: now,
})

/** Toutes les étapes faites. */
export const isDelivered = (d: Delivery): boolean => d.steps.every(s => s.status === 'done')

/** Les missions à attendre avant de livrer, par titre : à groupes déjà confiés, ou sans eux mais dont des commits partent. */
export type DeliveryWaits = { groups: string[]; commits: string[] }

/**
 * Les missions pas finies (ni archivées, ni closes, sans rapport validé) que la carte de livraison recommande
 * d'attendre : celles qui ont un groupe confié, comme avant, et les autres, si elles sont actives, dès qu'un commit de l'aperçu
 * (`commitTimes`, en ms) tombe dans leur fenêtre `startedAt..finishedAt`, même partagée avec une autre mission :
 * une mission validée qui attend sa livraison n'a pas de fin de fenêtre, et l'aperçu range alors en « hors
 * mission » chaque commit de la mission pas finie (la livraison 0.80.0 en avait envoyé sans avertissement).
 */
export const deliveryWaits = (runs: readonly Run[], commitTimes: readonly number[]): DeliveryWaits => {
  const waits: DeliveryWaits = { groups: [], commits: [] }
  for (const r of runs) {
    if (r.archivedAt !== undefined || r.status === 'done' || isReportValidated(r)) continue
    const to = r.finishedAt ?? Number.MAX_SAFE_INTEGER
    if ((r.groups ?? []).some(g => g.delegated !== undefined)) waits.groups.push(r.title)
    // Une mission en pause n'a pas de fin de fenêtre non plus : comptée, elle se signalerait à chaque livraison.
    else if (r.status === 'active' && commitTimes.some(at => at >= r.startedAt && at <= to)) waits.commits.push(r.title)
  }
  return waits
}

/** Une livraison pas encore finie : elle occupe le siège, et aucune autre ne part. */
export const isDeliveryOpen = (d: Delivery | null): boolean => d !== null && d.finishedAt === undefined

/** L'étape qui part ensuite : la première à faire, seulement si toutes celles d'avant sont faites. */
export const nextStep = (d: Delivery): DeliveryStep | null => {
  for (const s of d.steps) {
    if (s.status === 'done') continue
    return s.status === 'todo' ? s : null
  }
  return null
}

/** L'étape lancée, dont le mod attend l'issue. */
export const runningStep = (d: Delivery): DeliveryStep | null => d.steps.find(s => s.status === 'running') ?? null

/** L'étape échouée, qui arrête la suite. */
export const failedStep = (d: Delivery): DeliveryStep | null => d.steps.find(s => s.status === 'failed') ?? null

/** Lance l'étape `key` : seulement si c'est la suivante (toutes celles d'avant faites) ; sinon null. */
export const startStep = (d: Delivery, key: DeliveryKey, now: number): Delivery | null => {
  if (d.finishedAt !== undefined || nextStep(d)?.key !== key) return null
  return { ...d, steps: d.steps.map(s => (s.key === key ? { key, status: 'running', at: now } : s)) }
}

/**
 * L'issue d'une étape rendue par Claude : seulement l'étape lancée. Faite, la livraison se finit quand c'était
 * la dernière ; échouée, elle s'arrête là : rien d'après ne part, et elle reste ouverte (« ↻ Réessayer » refait
 * cette seule étape, « ✕ Abandonner » la ferme), jamais une étape réussie refaite.
 */
export const reportStep = (d: Delivery, key: DeliveryKey, ok: boolean, detail: string, now: number): Delivery | null => {
  if (d.finishedAt !== undefined || runningStep(d)?.key !== key) return null
  // Une ligne, sans caractère de contrôle ni invisible : le détail s'affiche dans la carte et le journal de la mission.
  const text = neutralLine(detail).replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX)
  const steps = d.steps.map(s => (s.key === key ? { key, status: ok ? ('done' as const) : ('failed' as const), at: now, ...(text !== '' ? { detail: text } : {}) } : s))
  const next = { ...d, steps }
  return steps.every(s => s.status === 'done') ? { ...next, finishedAt: now } : next
}

/** « ↻ Réessayer » : l'étape échouée redevient à faire, elle seule ; les étapes faites le restent. */
export const retryStep = (d: Delivery): Delivery | null => {
  const failed = failedStep(d)
  if (d.finishedAt !== undefined || !failed) return null
  return { ...d, steps: d.steps.map(s => (s.key === failed.key ? { key: s.key, status: 'todo' } : s)) }
}

/** « ✕ Abandonner » une livraison arrêtée (une étape échouée) : fermée, elle laisse partir une autre livraison (le push fait, ses missions sont closes). */
export const abandonDelivery = (d: Delivery, now: number): Delivery | null => (d.finishedAt === undefined && failedStep(d) ? { ...d, finishedAt: now } : null)

/** Relit une livraison gardée : null si elle est mal formée (rien ne part d'un état qu'on ne sait pas lire). */
export const parseDelivery = (raw: unknown): Delivery | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || !isId(x.id) || !isTime(x.startedAt) || !Array.isArray(x.missions) || !Array.isArray(x.steps)) return null
  const missions: Delivery['missions'] = []
  for (const m of x.missions.slice(0, 20)) {
    const o = m !== null && typeof m === 'object' ? (m as Record<string, unknown>) : {}
    if (!isId(o.id) || typeof o.title !== 'string' || !isTime(o.validatedAt)) return null
    missions.push({ id: o.id, title: o.title.slice(0, 200), validatedAt: o.validatedAt })
  }
  const steps: DeliveryStep[] = []
  for (const s of x.steps) {
    const o = s !== null && typeof s === 'object' ? (s as Record<string, unknown>) : {}
    if (!isKey(o.key) || !['todo', 'running', 'done', 'failed'].includes(String(o.status)) || steps.some(t => t.key === o.key)) return null
    steps.push({ key: o.key, status: o.status as DeliveryStep['status'], ...(isTime(o.at) ? { at: o.at } : {}), ...(typeof o.detail === 'string' ? { detail: o.detail.slice(0, DETAIL_MAX) } : {}) })
  }
  // L'ordre des étapes est fixe : un état qui l'a perdu ne se lit pas.
  const order = steps.map(s => DELIVERY_KEYS.indexOf(s.key))
  // Toujours la version, le push et les étapes du projet ; la pull request seule est facultative.
  if (steps.length === 0 || order.some((v, i) => i > 0 && v <= order[i - 1]!) || !['version', 'push', 'project'].every(k => steps.some(s => s.key === k))) return null
  return { v: 1, id: x.id, missions, steps, startedAt: x.startedAt, ...(isTime(x.finishedAt) ? { finishedAt: x.finishedAt } : {}) }
}
