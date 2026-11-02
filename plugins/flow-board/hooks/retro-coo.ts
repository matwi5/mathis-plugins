// La rétro d'une mission livrée, proposée par le COO : une mission à part, lancée par une carte du mod, qui
// garde l'id de la mission close et lit ses transcripts ; ses pistes se cochent chez le COO.
// Invariant : « Une piste de la rétro n'est découpée que si l'utilisateur l'a cochée ; une piste non cochée
// part dans À reprendre, jamais nulle part. »

import type { FlowItem, Run } from '../types'
import { clip } from './basics.ts'
import { isSafeId, isSessionId, neutralLine } from './closing.ts'
import { RETRO_START, isFolderName, liveLaunchOf, soundRunLaunch, type LaunchCard } from './launch.ts'
import { linkedSessionsOf } from './link.ts'
import { printOf } from './oppositions.ts'

/** L'id de la carte de rétro d'une mission : toujours le même pour elle (une seule carte, même après un rechargement). */
export const retroCardId = (mission: string): string => {
  const print = printOf(mission).replace('.', '').padStart(8, '0')
  return `kr${print}`.slice(0, 25)
}

/**
 * Le sujet du dossier de la rétro : `retro-`, celui de la mission (son dossier de lancement, sinon son titre), puis
 * une marque tirée de son id (son empreinte entière), pour que deux missions, ou une rétro et la rétro de sa rétro, n'aient pas le même dossier.
 */
export const retroFolder = (run: Run): string => {
  const launched = soundRunLaunch(run.launch)?.folder
  const base = (launched ?? run.title)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
    .replace(/-+$/g, '')
  const mark = printOf(run.id).replace('.', '')
  const folder = `retro-${base || 'mission'}-${mark}`
  return isFolderName(folder) ? folder : `retro-mission-${mark}`
}

/** Le rapport dit ce qui s'est mal passé : sa section « ## Ce qui s'est mal passé » (format du compte rendu) a une ligne qui n'est pas « Rien. ». */
export const wentWrong = (report: string): boolean => {
  const lines = report.split(/\r?\n/)
  const at = lines.findIndex(l => /^##\s+Ce qui s.est mal pass/i.test(l))
  if (at < 0) return false
  for (const l of lines.slice(at + 1)) {
    if (/^#{1,2}\s/.test(l)) break
    const text = l.replace(/^\s*[-*]\s*/, '').trim()
    if (text !== '' && !/^(?:rien|néant|aucun(?:e)?)\b[\s.!]*$/i.test(text)) return true
  }
  return false
}

/** Pourquoi la rétro est recommandée (rapport qui dit ce qui s'est mal passé, workers), ou null. */
export const retroReason = (run: Run, report: string | null): string | null => {
  const why = [...(report !== null && wentWrong(report) ? ['son rapport dit ce qui s’est mal passé'] : []), ...(linkedSessionsOf(run).count > 0 ? ['elle a eu des workers'] : [])]
  return why.length > 0 ? why.join(', ') : null
}

/** La carte « ▶ Rétro de « M » » d'une mission livrée : départ rétro, auto recommandé, effort high. */
export const retroCard = (run: Run, report: string | null, now: number): LaunchCard => {
  const reason = retroReason(run, report)
  return {
    id: retroCardId(run.id),
    title: clip(`Rétrospective · ${neutralLine(run.title)}`, 70),
    start: RETRO_START,
    of: run.id,
    askMatt: reason ? `recommandée : ${reason}` : 'facultative : rien de signalé dans le rapport, pas de worker',
    alts: [],
    mode: 'auto',
    modeWhy: 'tu coches ses pistes chez le COO, puis elle continue seule',
    effort: 'high',
    effortWhy: 'un jugement sur un existant ; xhigh se choisit à la main',
    folder: retroFolder(run),
    at: now,
  }
}

/** Une rétro lancée par le COO : l'id de la mission close qu'elle étudie, ou null (une rétro lancée à la main n'en a pas). */
export const retroOf = (run: Run): string | null => {
  const l = liveLaunchOf(run)
  return l?.of && isSafeId(l.of) ? l.of : null
}

/** La mission close a déjà sa rétro (lancée par le COO). */
export const hasRetro = (runs: readonly Run[], mission: string): boolean => runs.some(r => retroOf(r) === mission)

/** Les discussions d'une mission dont la rétro lit les transcripts : celle où elle est née, la dernière qui l'a portée, et ses workers. */
export const retroSessions = (closed: Run): string[] => [...new Set([...(closed.bornIn ? [closed.bornIn] : []), ...(closed.owner ? [closed.owner] : []), ...linkedSessionsOf(closed).ids])].filter(isSessionId)

/**
 * Les transcripts de la mission close parmi ceux du projet (listés sous le dossier des projets de Claude, jamais
 * un chemin construit d'une valeur relue) ; les discussions sans transcript trouvé, nommées pour que la rétro le dise.
 */
export const retroTranscripts = (closed: Run, listed: readonly { path: string; id: string }[]): { found: string[]; missing: string[] } => {
  const found: string[] = []
  const missing: string[] = []
  for (const id of retroSessions(closed)) {
    const hit = listed.filter(t => t.id === id).map(t => t.path)
    if (hit.length > 0) found.push(...hit)
    else missing.push(id)
  }
  return { found, missing }
}

/** L'empreinte des pistes montrées au clic (ids et libellés, dans l'ordre) : changées depuis, la sélection ne s'applique pas. */
export const picksPrint = (items: readonly Pick<FlowItem, 'id' | 'label'>[]): string => `p${printOf(JSON.stringify(items.map(i => [i.id, i.label]))).replace('.', '')}`

/**
 * Les pistes d'une phase de rétro que vise une sélection, dans l'ordre de la phase ; null quand ce ne sont plus
 * les pistes montrées au clic (une absente, un libellé changé) : la sélection ne vaut plus.
 */
export const pickedOf = (pick: { picked: readonly string[]; left: readonly string[]; print: string }, items: readonly FlowItem[]): FlowItem[] | null => {
  const shown = items.filter(i => pick.picked.includes(i.id) || pick.left.includes(i.id))
  return shown.length === pick.picked.length + pick.left.length && picksPrint(shown) === pick.print ? shown : null
}

/**
 * Une sélection tient encore ses pistes (elles ne se recochent pas chez le COO) : appliquée (une non cochée
 * écartée, quels que soient les libellés depuis), ou en attente et encore applicable (les mêmes pistes, toutes
 * encore à faire). Rejetée ou périmée, elle ne tient rien : ses pistes se recochent.
 */
export const holdsPick = (pick: { picked: readonly string[]; left: readonly string[]; print: string }, items: readonly FlowItem[]): boolean => {
  const status = (id: string) => items.find(i => i.id === id)?.status
  if (pick.left.some(id => status(id) === 'dropped')) return true
  return pickedOf(pick, items) !== null && [...pick.picked, ...pick.left].every(id => status(id) === 'todo')
}
