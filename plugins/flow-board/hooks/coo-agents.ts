// La liste des agents du COO, lue des registres : ce que fait la discussion d'un manager (« travaille », « attend ta
// réponse », « au repos ») et combien de spécialistes sont au travail, sur la ligne d'un manager comme d'un worker.
// À chaque veille du siège (5 s), le titulaire liste le dossier des registres (`registryFiles`), lit l'en-tête de chaque
// registre listé dont le nom est déjà sa forme fichier (`registrySlug` ; un autre est écarté), rattache un registre à une ligne par son contenu, puis lit en entier les seuls registres rattachés ;
// le résultat est gardé en mémoire du mod jusqu'à la relecture suivante, pour la vue. Rien n'est écrit : ni registre, ni
// relais, ni `$.store`.
//
// Invariant de cette lecture : « Pour sa liste des agents, le COO ne lit un registre que
// sous un nom rendu par la liste du dossier des registres, et cette lecture n'écrit rien : ni registre, ni relais. »
// L'id d'une discussion noté dans une mission (`owner`) ou déclaré dans un registre ne sert qu'à comparer, jamais à
// construire un chemin. Ces mémoires sont à part de celles de l'onglet Agents d'une discussion (`otherHeads`,
// `otherRegistries` de `register.tsx`) : ni l'une ni l'autre n'efface l'autre.

import type { Board, SessionRegistry } from '../types'
import { isClosedLink } from './link.ts'
import { isSameProject } from './linked.ts'
import { parseOwnRegistry, registrySlug, runningOf } from './registry.ts'
import { readPiece, readRegistry } from './registry-file.ts'
import { declaredGroup } from './relay.ts'
import { registryFiles } from './register.tsx'

/** Ce que la liste dit d'une ligne d'après son registre : l'état d'un manager, le nombre de spécialistes au travail. */
export type CooAgentInfo = { state?: 'travaille' | 'attend ta réponse' | 'au repos'; running?: number }

/** Un en-tête de registre lu sous un nom de la liste du dossier, avec la date de son fichier. */
export type ListedHead = { session: string; mtime: number; head: SessionRegistry }

/** La clé d'une ligne : la mission pour son manager, `<mission>:<groupe>` pour un worker. */
const lineIdOf = (mission: string, group?: string): string => (group === undefined ? mission : `${mission}:${group}`)

/**
 * Le rattachement des registres aux lignes de la liste, par leur contenu seul : au manager, le registre dont la session
 * est la discussion qui tient la mission (`owner`) ; au worker, le registre qui déclare la mission et le groupe (`run`,
 * `group`, lu comme le relais le lit), écrit depuis son dernier envoi, le plus récemment mis à jour s'il y en a plusieurs. Un registre d'un autre projet (racine hors du projet et
 * de ses worktrees), d'une mission inconnue, d'un groupe inconnu du plan ou pas confié n'est rattaché à aucune ligne.
 * Rend, par clé de ligne, le nom du registre (un nom de la liste du dossier).
 */
export const attachRegistries = (board: Board, heads: readonly ListedHead[]): Map<string, string> => {
  const mine = heads.filter(h => isSameProject(board.root, h.head.root))
  const out = new Map<string, string>()
  for (const run of board.runs) {
    if (run.archivedAt !== undefined || (run.status !== 'active' && run.status !== 'paused')) continue
    const owner = typeof run.owner === 'string' && run.owner !== '' ? run.owner : null
    // Le nom d'un registre est la forme fichier de sa session (`registrySlug`) : comparé, jamais ouvert.
    const manager = owner === null ? undefined : mine.find(h => h.session === registrySlug(owner))
    if (manager) out.set(lineIdOf(run.id), manager.session)
    for (const g of run.groups ?? []) {
      // Les groupes que le relevé tient pour un worker : confié, ou rendu sans être fermé (`workersOf`, `coo.ts`).
      const isWorker = g.linked !== undefined || (g.delegated !== undefined && !isClosedLink(g.delegated))
      if (!isWorker) continue
      // Le groupe déclaré se lit comme le relais le lit (« Groupe B », « B · Lecture » : `declaredGroup`), et seul un
      // registre écrit depuis le dernier envoi du groupe compte : celui d'une session d'un envoi précédent n'est plus le sien.
      const sentAt = g.linked?.at ?? 0
      const declared = mine
        .filter(h => h.head.run === run.id && declaredGroup(h.head.group).toLowerCase() === g.id.toLowerCase() && (h.head.updatedAt ?? 0) >= sentAt)
        .sort((x, y) => (y.head.updatedAt ?? 0) - (x.head.updatedAt ?? 0))[0]
      if (declared) out.set(lineIdOf(run.id, g.id), declared.session)
    }
  }
  return out
}

/**
 * Ce qu'un registre lu en entier dit de sa ligne : sur la piste principale, un segment en cours (sans fin) qui est une
 * attente de la personne, « attend ta réponse » ; un segment en cours d'une autre sorte, « travaille » ; aucun, « au
 * repos » ; et le nombre de spécialistes au travail, absent quand il est nul.
 */
export const registryInfo = (reg: SessionRegistry): CooAgentInfo => {
  const open = (reg.main?.segments ?? []).filter(s => s.e === undefined)
  const state = open.some(s => s.k === 'waitPerson') ? 'attend ta réponse' : open.length > 0 ? 'travaille' : 'au repos'
  const running = runningOf(reg).length
  return { state, ...(running > 0 ? { running } : {}) }
}

/** Les en-têtes lus, par nom de la liste du dossier. */
let heads = new Map<string, { mtime: number; head: SessionRegistry }>()
/** Les registres rattachés lus en entier, par nom. */
let wholes = new Map<string, { mtime: number; reg: SessionRegistry }>()
/** Ce que dit chaque ligne, par clé de ligne. */
let infos = new Map<string, CooAgentInfo>()
/** Le rang de la dernière relecture lancée ou du dernier oubli : une relecture dépassée ne garde pas son résultat. */
let generations = 0

/** Ce que la dernière relecture dit d'une ligne (rien sans registre rattaché lu en entier). */
export const cooAgentInfoOf = (mission: string, group?: string): CooAgentInfo | undefined => infos.get(lineIdOf(mission, group))

/** Oublie les lectures gardées (le siège perdu) ; vrai quand il y en avait. */
export const clearCooAgents = (): boolean => {
  generations++
  const had = infos.size > 0
  heads = new Map()
  wholes = new Map()
  infos = new Map()
  return had
}

/**
 * Relit les registres de la liste des agents du COO (à la veille du siège) et garde ce qu'ils disent ; vrai quand ce
 * que dit une ligne a changé (la vue se redessine alors). Un registre ne s'ouvre que sous un nom rendu par la liste du
 * dossier ; un en-tête ou un registre qui ne se relit pas garde la lecture d'avant, un registre lu mais pas entier n'en
 * donne aucune nouvelle ; un nom qui a quitté la liste (registre effacé) est oublié. Une relecture dépassée (un oubli du siège, ou une relecture plus récente) s'arrête sans rien garder.
 */
export async function refreshCooAgents($: any, board: Board): Promise<boolean> {
  // Une relecture lancée avant un oubli (le siège perdu) ou doublée par une plus récente ne garde rien, ni dans ses
  // mémoires d'en-têtes et de registres : elle s'arrête après chaque lecture qu'une autre a dépassée.
  const generation = ++generations
  const isPassed = () => generation !== generations
  // Seuls les noms qui sont déjà leur forme fichier : un autre (« -x ») ouvrirait le fichier d'un autre nom.
  const files = (await registryFiles($)).filter(f => registrySlug(f.session) === f.session)
  if (isPassed()) return false
  const listed = new Set(files.map(f => f.session))
  for (const name of [...heads.keys()]) if (!listed.has(name)) heads.delete(name)
  for (const { session, mtime } of files) {
    const kept = heads.get(session)
    if (kept && mtime >= 0 && kept.mtime === mtime) continue
    const piece = await readPiece($, session, 0)
    if (isPassed()) return false
    const head = piece.ok ? parseOwnRegistry(piece.value, session) : null
    if (head) heads.set(session, { mtime, head })
  }
  const attached = attachRegistries(
    board,
    [...heads].map(([session, x]) => ({ session, mtime: x.mtime, head: x.head })),
  )
  const wanted = new Set(attached.values())
  for (const name of [...wholes.keys()]) if (!wanted.has(name)) wholes.delete(name)
  for (const name of wanted) {
    const mtime = heads.get(name)?.mtime ?? -1
    const kept = wholes.get(name)
    if (kept && mtime >= 0 && kept.mtime === mtime) continue
    const got = await readRegistry($, name)
    if (isPassed()) return false
    if (got.ok && got.value && got.isWhole) wholes.set(name, { mtime, reg: got.value })
  }
  const next = new Map<string, CooAgentInfo>()
  for (const [key, name] of attached) {
    const whole = wholes.get(name)
    if (whole) next.set(key, registryInfo(whole.reg))
  }
  const isChanged = JSON.stringify([...next]) !== JSON.stringify([...infos])
  infos = next
  return isChanged
}
