// La table des numéros courts du COO : chaque carte de lancement et chaque mission du projet reçoit un
// numéro entier, pris à un compteur unique par projet et par poste. Une carte s'affiche « L<n> », une
// mission « M<n> » ; lancée, la mission prend le numéro de sa carte (« L12 » devient « M12 »).
//
// Module pur, sans import du modèle : `register.tsx` lit et écrit le fichier (par le seul titulaire du
// siège), ce module dit sa forme, les numéros qu'il donne, ce qu'une veille du siège y ajoute et ce
// qu'une écriture peut en changer.
//
// Invariant, décidé avec la personne : « Un numéro court ne désigne
// jamais deux missions, ni deux cartes, ni une carte et une autre mission que celle qu'elle a lancée ;
// une mission ne change jamais de numéro, et une carte garde le sien tant qu'aucune mission ne l'a pris ;
// seul le COO titulaire du siège écrit la table. » La seule exception est le geste de la personne
// « Repartir d'une table neuve », sur une table hors forme.

import type { Run } from '../types'
import { isSafeId } from './closing.ts'
import { cardStateOf, isFolderName, liveLaunchOf, sameFolder, type LaunchCard } from './launch.ts'

/** Le plus grand numéro attribué ; au-delà, plus rien ne s'attribue (le prochain peut valoir ce plafond plus un). */
const NUMBER_MAX = 99_999

/**
 * La table gardée sur le poste : le prochain numéro, les attributions aux cartes (un dossier `travail/<sujet>/`,
 * l'id d'une carte changeant quand elle est reproposée) et aux missions (un id de mission). Elle ne fait que
 * s'allonger : une attribution ne se retire ni ne se change, et le prochain numéro ne recule jamais.
 */
export type NumberTable = { v: 1; root: string; next: number; cards: { folder: string; n: number }[]; runs: { run: string; n: number }[] }

/** La table telle que le COO l'a relue : absente (vide), lue, lecture ratée, ou hors forme (`bad` : rien n'est montré ni écrit). */
export type NumberRead = { state: 'absent' } | { state: 'read'; table: NumberTable } | { state: 'unread' } | { state: 'bad' }

/** Une table vide, pour un projet qui n'en a pas encore. */
export const emptyNumberTable = (root: string): NumberTable => ({ v: 1, root, next: 1, cards: [], runs: [] })

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= NUMBER_MAX

/**
 * La table relue, d'après ses formes : hors forme en entier (null) pour un texte qui ne se
 * lit pas, une autre racine, une valeur hors forme, deux missions au même numéro, une mission à deux numéros, deux
 * dossiers au même numéro, ou un prochain numéro inférieur ou égal à un numéro attribué. Une clé en forme mais
 * inconnue (mission effacée, carte disparue) reste ; un dossier et une mission au même numéro (la carte lancée et sa
 * mission) et un dossier à plusieurs attributions (la dernière compte) sont en forme.
 */
export const parseNumberTable = (text: string, root: string): NumberTable | null => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || x.root !== root || !Array.isArray(x.cards) || !Array.isArray(x.runs)) return null
  if (typeof x.next !== 'number' || !Number.isInteger(x.next) || x.next < 1 || x.next > NUMBER_MAX + 1) return null
  const cards: NumberTable['cards'] = []
  for (const c of x.cards) {
    const one = c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null
    if (!one || !isFolderName(one.folder) || !isNumber(one.n)) return null
    cards.push({ folder: one.folder, n: one.n })
  }
  const runs: NumberTable['runs'] = []
  for (const r of x.runs) {
    const one = r !== null && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null
    if (!one || !isSafeId(one.run) || !isNumber(one.n)) return null
    runs.push({ run: one.run, n: one.n })
  }
  // Une mission, un numéro ; un numéro, une mission.
  if (new Set(runs.map(r => r.run)).size !== runs.length || new Set(runs.map(r => r.n)).size !== runs.length) return null
  // Un numéro de carte ne désigne qu'un dossier (à la casse près).
  const folderOf = new Map<number, string>()
  for (const c of cards) {
    const seen = folderOf.get(c.n)
    if (seen !== undefined && !sameFolder(seen, c.folder)) return null
    folderOf.set(c.n, c.folder)
  }
  let top = 0
  for (const one of [...cards, ...runs]) if (one.n > top) top = one.n
  if (x.next <= top) return null
  return { v: 1, root, next: x.next, cards, runs }
}

/** Le numéro de cette mission, son attribution ; undefined sans attribution. */
export const runNumberOf = (t: NumberTable, run: string): number | undefined => t.runs.find(r => r.run === run)?.n

/** Une mission tient déjà ce numéro. */
const isHeld = (t: NumberTable, n: number): boolean => t.runs.some(r => r.n === n)

/** La dernière attribution d'un dossier (à la casse près). */
const lastOfFolder = (t: NumberTable, folder: string): number | undefined => {
  return t.cards.findLast(c => sameFolder(c.folder, folder))?.n
}

/**
 * Le numéro d'une carte, d'après son dossier : la dernière attribution du dossier, tant qu'aucune mission ne tient ce
 * numéro (une carte et une autre mission que la sienne ne portent jamais le même) ; undefined sinon.
 */
export const cardNumberOf = (t: NumberTable, folder: string): number | undefined => {
  const n = lastOfFolder(t, folder)
  return n !== undefined && !isHeld(t, n) ? n : undefined
}

/**
 * Ce qu'une veille du siège ajoute à la table relue (null : rien), en une seule passe sur une seule relecture :
 * d'abord chaque carte pas encore lancée dont le dossier n'a pas d'attribution, ou dont la dernière est tenue par une
 * mission, dans l'ordre de leur date ; puis chaque mission de la vue (pas archivée) sans numéro, dans l'ordre de leur
 * début, selon le rattachement :
 * - un lancement vivant dont le dossier a une attribution qu'aucune mission ne tient : ce numéro ;
 * - aucun lancement (`launch` absent), née après le dernier clic d'une carte encore « en lancement » : rien pour
 *   l'instant (elle prendra le numéro de sa carte en rattachant son lancement) ;
 * - sinon (lancement vivant sans attribution libre, lancement perdu ou hors forme, aucun lancement) : le prochain.
 * Les états des cartes se lisent sur toutes les missions du fichier, archivées comprises, comme le relevé.
 */
export const assignNumbers = (table: NumberTable, cards: readonly LaunchCard[], runs: readonly Run[], now: number): NumberTable | null => {
  const t: NumberTable = { ...table, cards: [...table.cards], runs: [...table.runs] }
  const take = (): number | null => (t.next > NUMBER_MAX ? null : t.next++)
  const states = cards.filter(c => isFolderName(c.folder)).map(c => ({ card: c, state: cardStateOf(c, runs, now) }))
  for (const { card } of states.filter(x => x.state.kind !== 'launched').sort((a, b) => a.card.at - b.card.at || (a.card.id < b.card.id ? -1 : 1))) {
    const last = lastOfFolder(t, card.folder)
    if (last !== undefined && !isHeld(t, last)) continue
    const n = take()
    if (n === null) break
    t.cards.push({ folder: card.folder, n })
  }
  const launching = states.flatMap(x => (x.state.kind === 'launching' && x.card.launch ? [x.card.launch.at] : []))
  const shown = runs.filter(r => r.archivedAt === undefined && isSafeId(r.id)).sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1))
  for (const run of shown) {
    if (runNumberOf(t, run.id) !== undefined) continue
    // L'intervalle du lancement : une mission ne rattache son lancement qu'à son premier appel de l'outil `flow`.
    if (run.launch === undefined && launching.some(at => run.startedAt >= at)) continue
    const live = liveLaunchOf(run)
    const own = live ? lastOfFolder(t, live.folder) : undefined
    if (own !== undefined && !isHeld(t, own)) {
      t.runs.push({ run: run.id, n: own })
      continue
    }
    const n = take()
    if (n === null) break
    t.runs.push({ run: run.id, n })
  }
  return t.cards.length === table.cards.length && t.runs.length === table.runs.length ? null : t
}

/**
 * La garde de l'invariant à l'écriture : la table écrite garde chaque attribution de la table relue, à sa place et
 * telle quelle, ne fait pas reculer le prochain numéro, et reste en forme.
 */
export const keepsNumbers = (before: NumberTable, after: NumberTable): boolean =>
  after.root === before.root &&
  after.next >= before.next &&
  after.cards.length >= before.cards.length &&
  after.runs.length >= before.runs.length &&
  before.cards.every((c, i) => after.cards[i]?.folder === c.folder && after.cards[i]?.n === c.n) &&
  before.runs.every((r, i) => after.runs[i]?.run === r.run && after.runs[i]?.n === r.n) &&
  parseNumberTable(JSON.stringify(after), after.root) !== null

/**
 * La table neuve de « Repartir d'une table neuve » : vide, son prochain numéro après le plus grand entier de 1 à
 * 99 999 lisible dans le texte de l'ancienne (1 si aucun ne se lit). Un entier au-delà de 99 999 est ignoré.
 */
export const freshNumberTable = (oldText: string, root: string): NumberTable => {
  let top = 0
  for (const m of oldText.match(/\d+/g) ?? []) {
    const n = Number(m)
    if (Number.isInteger(n) && n >= 1 && n <= NUMBER_MAX && n > top) top = n
  }
  return { ...emptyNumberTable(root), next: top + 1 }
}

/** Ce que la vue et le relevé reçoivent : l'état de la table, et les numéros des missions (par id) et des cartes (par id de carte). */
export type CooNumbers = { state: NumberRead['state']; runs: Record<string, number>; cards: Record<string, number> }

/** Les numéros que montrent la vue et le relevé, d'après la table relue (aucun hors d'une table lue). */
export const numbersView = (got: NumberRead, cards: readonly LaunchCard[]): CooNumbers => {
  if (got.state !== 'read') return { state: got.state, runs: {}, cards: {} }
  const t = got.table
  const out: Record<string, number> = {}
  for (const c of cards) {
    const n = cardNumberOf(t, c.folder)
    if (n !== undefined) out[c.id] = n
  }
  return { state: 'read', runs: Object.fromEntries(t.runs.map(r => [r.run, r.n])), cards: out }
}
