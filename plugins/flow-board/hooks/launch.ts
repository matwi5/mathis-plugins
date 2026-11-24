// La carte de lancement du COO : le Claude du COO propose de lancer une mission (titre, point de départ
// d'après ask-matt, mode, effort, dossier `travail/<sujet>/`), la personne clique, et le mod écrit un
// enregistrement de lancement dans son stockage (`$.store`) ; la nouvelle discussion le consomme à son
// premier appel de l'outil `flow`, et sa mission se rattache à la carte.
//
// Module pur, sans import du modèle : `register.tsx` écrit et relit l'enregistrement, ce module dit sa
// forme, ce qu'une carte montre et pourquoi une consommation est refusée.
//
// Invariant : « Une carte ne lance qu'une mission ; un enregistrement de lancement n'est consommé qu'une
// fois, par une seule discussion, dans les 10 minutes. » La garde, décidée avec la personne : l'enregistrement
// porte la marque de la discussion qui le prend, relue 1,5 s plus tard ; la mission lancée porte l'id de
// l'enregistrement (`Run.launch`, posé une fois), et un id déjà porté par une mission du fichier des
// missions est refusé ; seule une mission créée après le clic peut le consommer.

import type { Run, RunLaunch } from '../types'
import { clip, isTime } from './basics.ts'
import { asciiJson, isSafeId, neutralInPrompt, shellQuote } from './closing.ts'
import { isEntryId } from './coordination.ts'
import { ROADMAP_STATUSES, isRoadmapId, roadmapIdsIn, type Roadmap, type RoadmapEntry } from './roadmap.ts'
import { isOpenPending } from './complement.ts'
import { TRUST_COMMAND } from './catalog.ts'
import { shellSafeTitle } from './named-mark.ts'

export type { RunLaunch }

/** Au-delà, un enregistrement de lancement est périmé : il ne se consomme plus, et s'efface au clic ou au chargement suivant. */
export const LAUNCH_TTL_MS = 10 * 60_000

/**
 * Une carte en « lancement en cours » revient un peu après la péremption de son enregistrement : une
 * mission consommée juste avant la péremption a le temps d'arriver au fichier des missions relu.
 */
export const LAUNCH_GRACE_MS = 60_000

/** Une date de clic venue d'ailleurs ne vaut pas au-delà de cette avance sur l'horloge d'ici. */
export const CLOCK_SKEW_MS = 60_000

/** Ce que dit une mission qui n'a pas pu consommer son lancement : elle reste en manuel. */
export const LAUNCH_STALE = "Accord de lancement périmé : la mission est en manuel, allume l'auto ici si tu veux"

/** Le temps qu'une discussion laisse à une autre, après avoir pris l'enregistrement à son nom, avant de relire. */
export const LAUNCH_CLAIM_SETTLE_MS = 1500

/** La clé d'un enregistrement de lancement dans le stockage du mod. */
export const launchKey = (id: string): string => `coo-launch:${id}`
export const LAUNCH_KEY_PREFIX = 'coo-launch:'

/** Les points de départ d'une mission que la carte propose : les skills d'ask-matt qui ouvrent une mission. */
export const LAUNCH_STARTS = ['grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'tdd', 'diagnosing-bugs', 'triage', 'improve-codebase-architecture', 'code-review', 'research', 'to-questionnaire', 'wizard', 'prototype'] as const
export type LaunchStart = (typeof LAUNCH_STARTS)[number]
const isStart = (v: unknown): v is LaunchStart => typeof v === 'string' && (LAUNCH_STARTS as readonly string[]).includes(v)

/**
 * Le départ d'une rétro proposée par le mod du COO à la livraison d'une mission : jamais par Claude (le champ
 * `card` le refuse), toujours avec l'id de la mission close (`of`).
 */
export const RETRO_START = 'retro'

/** L'avis d'une carte de rétro, en tête de sa ligne d'ask-matt (`retroCard`) : recommandée (avec sa raison), ou facultative. */
export type RetroAdvice = 'recommandée' | 'facultative'

/** Le début de la ligne d'ask-matt d'une carte de rétro pour chaque avis : `retroCard` l'écrit, `retroAdviceOf` le relit. */
export const RETRO_ADVICE_LEAD: Record<RetroAdvice, string> = { recommandée: 'recommandée : ', facultative: 'facultative : ' }

/** L'avis d'une carte de rétro, lu en tête de sa ligne d'ask-matt ; null pour toute autre carte, ou une ligne qui ne le dit pas. */
export const retroAdviceOf = (c: { start: string; of?: string; askMatt: string }): RetroAdvice | null =>
  c.start !== RETRO_START || c.of === undefined ? null : ((Object.keys(RETRO_ADVICE_LEAD) as RetroAdvice[]).find(a => c.askMatt.startsWith(RETRO_ADVICE_LEAD[a])) ?? null)
export type CardStart = LaunchStart | typeof RETRO_START

/** Le départ et la mission close d'une carte, d'un enregistrement ou d'un rattachement relus : une rétro porte son `of`, un autre départ jamais. */
const startOf = (start: unknown, of: unknown): { start: CardStart; of?: string } | null =>
  isStart(start) && of === undefined ? { start } : start === RETRO_START && isSafeId(of) ? { start: RETRO_START, of } : null

export type LaunchMode = 'auto' | 'manual'
export type LaunchEffort = 'medium' | 'high' | 'xhigh'
const EFFORTS: readonly LaunchEffort[] = ['medium', 'high', 'xhigh']

/** Une carte de lancement, gardée par la discussion du COO (`$.state`), recalculée à chaque envoi de Claude. */
export type LaunchCard = {
  id: string
  title: string
  /** L'idée de la feuille de route qu'elle lance, par son id. */
  idea?: string
  start: CardStart
  /** Une rétro : l'id de la mission close qu'elle étudie, posé par le mod du COO. */
  of?: string
  /** La ligne d'ask-matt qui justifie le départ, telle que Claude l'a citée (une rétro : pourquoi elle est recommandée ou non). */
  askMatt: string
  /** Les autres départs possibles, que la personne peut choisir avant de cliquer. */
  alts: LaunchStart[]
  mode: LaunchMode
  modeWhy: string
  effort: LaunchEffort
  effortWhy: string
  /** Le sujet du dossier de la mission : `travail/<folder>/` du projet. */
  folder: string
  at: number
  /** Le dernier clic : l'id de son enregistrement, sa date, son mode. */
  launch?: { id: string; at: number; mode: LaunchMode }
  /**
   * Les entrées de la feuille de route que la carte couvre (ids d'idées I<n> et de choses à reprendre R<n>), sans
   * doublon, dans l'ordre donné ; absente plutôt que vide. Seul un envoi du COO qui vise la carte les change ; une carte
   * de rétro ou « Pistes de rétro » n'en porte jamais.
   */
  entries?: string[]
  /**
   * Le rang de la carte parmi les cartes prêtes (un entier à partir de 1, sans borne haute à la relecture : tout entier
   * sûr ≥ 1 est un rang, que seul l'envoi de l'ordre change), posé par le seul envoi de l'ordre du COO ; absent : sans rang. Un rang relu hors
   * forme se lit sans rang ; une carte de rétro ou « Pistes de rétro » n'en a jamais.
   */
  rank?: number
  /**
   * L'objectif de la mission : ce qu'elle veut obtenir, sur une ligne, coupé à `CARD_GOAL_MAX` signes. Exigé d'une carte
   * du Claude du COO, écrit par le mod pour une carte de rétro ou « Pistes de rétro » ; absent d'une carte d'avant (relue
   * sans lui, elle reste en forme et lançable). Il ne sert qu'à l'affichage : ni l'enregistrement de lancement ni le
   * texte de lancement ne le portent.
   */
  goal?: string
}

/** La borne de l'objectif d'une carte, à la pose comme à la relecture (celle de la ligne d'ask-matt). */
export const CARD_GOAL_MAX = 240

/** Le nombre d'entrées qu'une carte reçoit au plus à sa pose ; relue, elle garde tous ses ids en forme. */
export const CARD_ENTRIES_MAX = 20

/** Le nombre de cartes qu'un envoi de l'ordre nomme au plus (un rang relu plus grand reste un rang). */
export const CARDS_ORDER_MAX = 200

/** Un id d'entrée de carte : un id de la feuille de route, d'une idée (I) ou d'une chose à reprendre (R). */
export const isCardEntryId = (v: unknown): v is string => isRoadmapId(v) && (v[0] === 'I' || v[0] === 'R')

/**
 * Les entrées qu'un envoi du COO donne à une carte (`raw`, son champ `entries`), contrôlées : `undefined` quand l'envoi
 * n'en dit rien, sinon la liste sans doublon (la première occurrence gardée), vide comprise ; ou la raison du refus
 * (pas une liste, un id hors forme ou d'une autre lettre que I ou R, plus de `CARD_ENTRIES_MAX` ids) : rien n'est coupé.
 */
const parseCardEntries = (raw: unknown): { entries: string[] | undefined } | { refused: string } => {
  if (raw === undefined) return { entries: undefined }
  if (!Array.isArray(raw)) return { refused: '"entries" must be a list of roadmap ids (I<n> for an idea, R<n> for a thing to pick up)' }
  const bad = raw.filter(v => !isCardEntryId(v))
  if (bad.length > 0) {
    // Chaque valeur en cause, une fois, exacte (hors ASCII imprimable échappé : un caractère invisible se voit), coupée après.
    const shown = [...new Set(bad.map(v => clip(asciiJson(v), 40)))]
    const named = shown.slice(0, 5).join(', ')
    return { refused: `"entries" takes only ids of roadmap ideas (I<n>) or things to pick up (R<n>), as the COO statement gives them: ${named}${shown.length > 5 ? ` and ${shown.length - 5} more` : ''} ${shown.length > 1 ? 'are' : 'is'} not one` }
  }
  const entries = [...new Set(raw as string[])]
  if (entries.length > CARD_ENTRIES_MAX) return { refused: `"entries" takes ${CARD_ENTRIES_MAX} ids at most; this card has ${entries.length}: split it into several cards` }
  return { entries }
}

/** Les entrées relues d'une carte gardée : tous ses ids en forme, sans doublon, dans leur ordre, sans borne ; le reste ignoré. */
const soundEntries = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.filter(isCardEntryId))] : [])

/**
 * La carte qu'un envoi du COO écrit (`card`, déjà contrôlée par `parseCard` sur l'envoi `raw` : précondition, un envoi
 * aux entrées hors forme y est refusé avant), ses entrées réglées : celles de l'envoi quand il en donne (une liste vide
 * les retire), sinon celles de la carte d'avant (`before`, même dossier), gardées telles quelles, sans nouveau contrôle.
 */
export const withEntries = (card: LaunchCard, raw: unknown, before: LaunchCard | undefined): LaunchCard => {
  const parsed = parseCardEntries(raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).entries : undefined)
  const given = 'refused' in parsed ? undefined : parsed.entries
  const { entries: _, ...rest } = card
  const entries = given ?? before?.entries ?? []
  return entries.length > 0 && isOrdinaryCard(card) ? { ...rest, entries: [...entries] } : rest
}

/**
 * Les entrées qu'un envoi du COO donne et que la pose contrôle : celles de la liste qu'il donne, sans doublon ; aucune
 * quand il n'en dit rien (une mise à jour garde alors celles d'avant sans les recontrôler) ou donne une liste vide.
 */
export const entriesToCheck = (raw: unknown): string[] => {
  const parsed = parseCardEntries(raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).entries : undefined)
  return 'refused' in parsed ? [] : (parsed.entries ?? [])
}

/** Le statut d'une entrée dit au COO par son seul mot du vocabulaire (« rattachée à … »), jamais par son texte libre. */
const statusWord = (e: RoadmapEntry): string => {
  const word = (ROADMAP_STATUSES[e.section] ?? []).find(s => e.status === s || (s.endsWith(' ') && e.status.startsWith(s)))
  return word === undefined ? 'unknown' : word.endsWith(' ') ? `${word.replace(/ : $/, '').trimEnd()} …` : word
}

/**
 * Une entrée ouverte : une idée « à lancer » ou « plus tard », une chose à reprendre « à décider » ou « plus tard », ou un
 * complément lu comme une chose à décider (`isOpenPending`, d'après toutes les entrées lues).
 */
const isOpenEntry = (e: RoadmapEntry, entries: readonly RoadmapEntry[]): boolean =>
  e.section === 'Idées' ? e.status === 'à lancer' || e.status === 'plus tard' : isOpenPending(e, entries)

/**
 * Les entrées d'une carte que d'autres cartes citent déjà (`others` : les autres cartes prêtes ou en lancement, la carte
 * elle-même exclue par l'appelant), par leurs entrées, leur idée ou leur titre : une raison par entrée, vide sinon.
 */
export const entriesCitedElsewhere = (entries: readonly string[], others: readonly Pick<LaunchCard, 'id' | 'title' | 'idea' | 'entries'>[]): string[] =>
  entries.flatMap(id => {
    const by = others.find(c => cardRoadmapIds(c).includes(id))
    return by ? [`${id} is already cited by the launch card ${by.id}`] : []
  })

/**
 * Pourquoi les entrées qu'un envoi du COO donne à une carte ne s'écrivent pas, ou null quand elles passent : la feuille
 * de route relue à l'instant (`read`) doit se lire et montrer chacune ouverte, et aucune autre carte prête ou en
 * lancement (`others`) ne doit déjà la citer. Toutes les entrées en cause sont nommées, chacune avec sa raison ; seuls des
 * ids à la forme contrôlée et des mots du vocabulaire des statuts entrent dans la réponse.
 */
export const entriesRefusal = (entries: readonly string[], read: Roadmap | null | 'unread', others: readonly Pick<LaunchCard, 'id' | 'title' | 'idea' | 'entries'>[]): string | null => {
  if (entries.length === 0) return null
  const cited = entriesCitedElsewhere(entries, others)
  // Sans feuille de route lisible, aucune entrée ne peut être vue ouverte : toutes sont nommées, avec celles déjà citées.
  const unseen = read === null ? 'the roadmap does not exist yet' : read === 'unread' || !read.ok ? 'the roadmap cannot be read' : null
  if (unseen !== null) return `${unseen}, so ${entries.join(', ')} cannot be seen open${cited.length > 0 ? `; ${cited.join('; ')}` : ''}. Nothing is shown or written: a card with "entries" needs the roadmap (a card without them is shown as before)`
  const roadmap = read as Extract<Roadmap, { ok: true }>
  const why = entries.flatMap(id => {
    const e = roadmap.entries.find(x => x.id === id)
    if (!e) return [`${id} is not in the roadmap`]
    return isOpenEntry(e, roadmap.entries) ? [] : [`${id} is not open (status « ${statusWord(e)} »)`]
  })
  const all = [...why, ...cited]
  const inCause = new Set(all.map(r => r.split(' ')[0]))
  return all.length > 0 ? `${all.join('; ')}. Nothing is shown or written; propose the card again without ${inCause.size > 1 ? 'these entries' : 'this entry'}` : null
}

/** L'enregistrement de lancement, écrit par le clic dans le stockage du mod, consommé une fois par la nouvelle discussion. */
export type LaunchRecord = {
  v: 1
  id: string
  card: string
  root: string
  title: string
  start: CardStart
  /** Une rétro : l'id de la mission close. */
  of?: string
  mode: LaunchMode
  effort: LaunchEffort
  folder: string
  at: number
  /** La discussion du clic. */
  by: string
  /** La discussion qui l'a pris à son nom, en train de le consommer. */
  claim?: { by: string; at: number }
}

/** L'id d'un enregistrement : `l` puis 8 à 24 lettres minuscules ou chiffres. */
export const isLaunchId = (v: unknown): v is string => typeof v === 'string' && /^l[a-z0-9]{8,24}$/.test(v)

/** Un id neuf, d'après la date et un tirage (`rand` dans [0, 1)). */
export const newLaunchId = (now: number, rand: number): string =>
  `l${Math.max(0, Math.floor(now)).toString(36)}${Math.floor(Math.min(Math.max(rand, 0), 0.999999) * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`.slice(0, 25)

/** L'id d'une carte : `k` puis 6 à 24 lettres minuscules ou chiffres. */
export const isCardId = (v: unknown): v is string => typeof v === 'string' && /^k[a-z0-9]{6,24}$/.test(v)

/** Le sujet du dossier d'une mission : lettres, chiffres et tirets (jamais `..` ni `/`), 60 au plus. */
export const isFolderName = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(v) && v.length <= 60

/**
 * La carte « Pistes de rétro », posée par le mod du COO au clic « ✂ Découper la sélection » des pistes en attente :
 * départ `to-tickets`, son dossier tiré de son id (`pistes-de-retro-<id sans k>`), sans champ de plus (R39) ; une
 * carte de Claude ne prend jamais un dossier de cette forme. Ses pistes portent son id dans la liste d'attente.
 */
const PISTES_CARD_PREFIX = 'pistes-de-retro-'
export const pistesCardFolder = (id: string): string => `${PISTES_CARD_PREFIX}${id.slice(1)}`
export const isPistesCard = (card: Pick<LaunchCard, 'id' | 'start' | 'folder' | 'of'>): boolean => card.of === undefined && card.start === 'to-tickets' && sameFolder(card.folder, pistesCardFolder(card.id))
/** Une carte de lancement ordinaire, proposée par le Claude du COO : ni carte de rétro, ni carte « Pistes de rétro ». */
export const isOrdinaryCard = (card: Pick<LaunchCard, 'id' | 'start' | 'folder' | 'of'>): boolean => card.of === undefined && !isPistesCard(card)

/**
 * Les entrées de la feuille de route qu'une carte cite : son champ `idea`, puis les ids `R<chiffres>` ou `I<chiffres>` de
 * son titre, puis ses entrées, dans l'ordre et sans doublon. Leur forme est contrôlée ici : seuls ces ids entrent dans la
 * demande au COO.
 */
export const cardRoadmapIds = (card: Pick<LaunchCard, 'title' | 'idea' | 'entries'>): string[] => {
  const found = [...(card.idea !== undefined && isRoadmapId(card.idea) ? [card.idea] : []), ...roadmapIdsIn(card.title, 'RI'), ...(card.entries ?? []).filter(isCardEntryId)]
  return [...new Set(found)]
}

/**
 * La ligne qui fait rattacher une mission à son lancement, dans le premier message de sa discussion (nouvelle
 * discussion, ou commande de rétro lancée par le mod dans la discussion du manager) : seul l'id du lancement y entre.
 */
export const launchFirstLine = (launch: string): string => `Lancée par le COO : appelle d'abord l'outil flow de flow-board avec {"launch": ${asciiJson(launch)}}, une fois le skill chargé, avant toute autre écriture.`

/** Une carte qui a un tour d'intention (`demande.md`) : ni une rétro (la mission close est sa demande) ni des pistes de rétro (ses pistes). */
export const hasIntentTurn = (card: Pick<LaunchCard, 'id' | 'start' | 'folder' | 'of'>): boolean => card.of === undefined && !isPistesCard(card)

export const pistesCard = (id: string, now: number): LaunchCard => ({
  id,
  // L'heure du clic la distingue d'une autre carte « Pistes de rétro » (la vue nomme la carte de chaque piste).
  title: `Pistes de rétro · ${new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
  start: 'to-tickets',
  askMatt: 'pistes cochées dans « Pistes en attente » : leur découpage en tickets puis en groupes',
  alts: [],
  mode: 'manual',
  modeWhy: 'tu suis le découpage',
  effort: 'high',
  effortWhy: 'découpage en tickets',
  folder: pistesCardFolder(id),
  at: now,
  goal: 'Découper en tickets les pistes cochées dans « Pistes en attente ».',
})

/** Le refus d'une carte de Claude sans objectif : ce qu'il faut écrire. */
const GOAL_REFUSED = '"goal" must say what the mission wants to obtain, in one to three short lines in the user\'s language (not the title again)'

/** Un texte de la carte : sur une ligne, coupé ; aussi celui qu'écrit le mod (l'objectif d'une rétro), pour qu'une relecture ne le change pas. */
export const cardLine = (v: unknown, max: number): string => (typeof v === 'string' ? clip(v.replace(/\s+/g, ' ').trim(), max) : '')

/**
 * La carte que propose Claude (le champ `card` de l'outil `flow`), contrôlée : un départ de la liste, un
 * mode et un effort connus, jamais xhigh en auto, un dossier en forme, un objectif (exigé de Claude, facultatif à la relecture). Rend la carte, ou la raison du refus. Le rang
 * ne se lit qu'à la relecture de la liste (`isMod`) : un rang donné par Claude est ignoré.
 */
export const parseCard = (raw: unknown, now: number, id: string, isMod = false): { card: LaunchCard } | { refused: string } => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { refused: '"card" must be a JSON object' }
  const x = raw as Record<string, unknown>
  const title = cardLine(x.title, 70)
  if (title === '') return { refused: 'the card has no title' }
  // Une rétro (`of` compris) ne vient que du mod ; une carte de Claude ne porte jamais `of`.
  const started = isMod ? startOf(x.start, x.of) : isStart(x.start) ? { start: x.start } : null
  if (!started) return { refused: `"start" must be one of ${LAUNCH_STARTS.join(', ')}` }
  const askMatt = cardLine(x.askMatt, 240)
  if (askMatt === '') return { refused: '"askMatt" must quote the line of ask-matt that justifies the start (read it first)' }
  if (x.mode !== 'auto' && x.mode !== 'manual') return { refused: '"mode" must be "auto" or "manual"' }
  if (!EFFORTS.includes(x.effort as LaunchEffort)) return { refused: '"effort" must be "medium", "high" or "xhigh"' }
  if (x.mode === 'auto' && x.effort === 'xhigh') return { refused: 'xhigh is never proposed for a mission in auto: high at most' }
  if (!isFolderName(x.folder)) return { refused: `"folder" must be the subject of travail/<subject>/: letters, digits and dashes only (no "/", no ".."); ask the user for one` }
  if (!isMod && x.folder.toLowerCase().startsWith(PISTES_CARD_PREFIX)) return { refused: `a folder that starts with "${PISTES_CARD_PREFIX}" is the dashboard's own (« Pistes de rétro » cards): choose another` }
  if (x.idea !== undefined && !isRoadmapId(x.idea)) return { refused: '"idea" must be the id of an idea of the roadmap, as the COO statement gives it' }
  const alts = (Array.isArray(x.alts) ? x.alts : []).filter(isStart).filter((s, i, all) => s !== x.start && all.indexOf(s) === i).slice(0, 4)
  // Les entrées : contrôlées à la pose (refus entier, rien de coupé) ; relues, tous les ids en forme gardés, le reste ignoré.
  // Une carte de rétro ou « Pistes de rétro » n'en porte jamais.
  const given = isMod ? { entries: soundEntries(x.entries) } : parseCardEntries(x.entries)
  if ('refused' in given) return { refused: given.refused }
  const ordinary = isOrdinaryCard({ id, start: started.start, folder: x.folder, of: started.of })
  const entries = ordinary && given.entries && given.entries.length > 0 ? given.entries : undefined
  // Le rang : relu seulement (un rang donné par un envoi du COO est ignoré : seul l'envoi de l'ordre en pose un).
  const rank = isMod && ordinary && Number.isSafeInteger(x.rank) && (x.rank as number) >= 1 ? (x.rank as number) : undefined
  // L'objectif : exigé d'un envoi de Claude (après ses autres refus, qui gardent leur raison) ; facultatif à la relecture,
  // absent plutôt que vide (une carte d'avant se réécrit sans clé de plus).
  const goal = cardLine(x.goal, CARD_GOAL_MAX)
  if (!isMod && goal === '') return { refused: GOAL_REFUSED }
  return {
    card: {
      id,
      title,
      ...(typeof x.idea === 'string' ? { idea: x.idea } : {}),
      start: started.start,
      ...(started.of ? { of: started.of } : {}),
      askMatt,
      alts,
      mode: x.mode,
      modeWhy: cardLine(x.modeWhy, 160),
      effort: x.effort as LaunchEffort,
      effortWhy: cardLine(x.effortWhy, 160),
      folder: x.folder,
      at: now,
      ...(entries ? { entries } : {}),
      ...(rank !== undefined ? { rank } : {}),
      ...(goal !== '' ? { goal } : {}),
    },
  }
}

/** Une carte relue de la liste des cartes du projet (ou de l'ancien état d'une discussion) : seulement en forme ; null sinon. */
export const soundCard = (raw: unknown): LaunchCard | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (!isCardId(x.id) || !isTime(x.at)) return null
  const parsed = parseCard(x, x.at, x.id, true)
  if ('refused' in parsed) return null
  const l = x.launch as Record<string, unknown> | undefined
  const launch = l && isLaunchId(l.id) && isTime(l.at) && (l.mode === 'auto' || l.mode === 'manual') ? { id: l.id, at: l.at, mode: l.mode as LaunchMode } : undefined
  return { ...parsed.card, ...(launch ? { launch } : {}) }
}

/** Un enregistrement relu du stockage : seulement en forme ; null sinon (il ne se consomme pas). */
export const soundRecord = (raw: unknown): LaunchRecord | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  const started = startOf(x.start, x.of)
  if (x.v !== 1 || !isLaunchId(x.id) || !isCardId(x.card) || typeof x.root !== 'string' || !started || (x.mode !== 'auto' && x.mode !== 'manual')) return null
  if (!EFFORTS.includes(x.effort as LaunchEffort) || !isFolderName(x.folder) || !isTime(x.at) || !isSafeId(x.by) || typeof x.title !== 'string') return null
  const c = x.claim as Record<string, unknown> | undefined
  const claim = c && isSafeId(c.by) && isTime(c.at) ? { by: c.by, at: c.at } : undefined
  if (x.claim !== undefined && !claim) return null
  return { v: 1, id: x.id, card: x.card, root: x.root, title: clip(x.title, 70), start: started.start, ...(started.of ? { of: started.of } : {}), mode: x.mode, effort: x.effort as LaunchEffort, folder: x.folder, at: x.at, by: x.by, ...(claim ? { claim } : {}) }
}

/** Le rattachement d'une mission relu du fichier des missions : seulement en forme ; null sinon. */
export const soundRunLaunch = (raw: unknown): RunLaunch | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  const started = startOf(x.start, x.of)
  if (!isLaunchId(x.id) || !isCardId(x.card) || !isTime(x.at) || !isFolderName(x.folder) || !started || (x.mode !== 'auto' && x.mode !== 'manual')) return null
  if (x.lostAt !== undefined && !isTime(x.lostAt)) return null
  return { id: x.id, card: x.card, at: x.at, folder: x.folder, start: started.start, ...(started.of ? { of: started.of } : {}), mode: x.mode, ...(isTime(x.lostAt) ? { lostAt: x.lostAt } : {}) }
}

/**
 * Le rattachement qui compte d'une mission : en forme, et pas perdu (une autre mission, qui le précède,
 * porte le même lancement ou la même carte). Un rattachement présent mais hors forme compte aussi comme
 * posé pour la consommation (la mission ne prend jamais un second lancement), jamais pour la carte.
 */
export const liveLaunchOf = (run: Run): RunLaunch | null => {
  const l = soundRunLaunch(run.launch)
  return l && l.lostAt === undefined ? l : null
}

/** Deux sujets de dossier désignent le même dossier (macOS et Windows ne tiennent pas compte de la casse). */
export const sameFolder = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** L'enregistrement est périmé (ou daté loin dans le futur) à cet instant. */
export const isRecordStale = (r: { at: number }, now: number): boolean => now - r.at >= LAUNCH_TTL_MS || r.at > now + CLOCK_SKEW_MS

/** La mission du fichier des missions qui porte déjà cet enregistrement, cette carte, ou ce dossier. */
export const runOfLaunch = (runs: readonly Run[], id: string): Run | undefined => runs.find(r => liveLaunchOf(r)?.id === id)
export const runOfCard = (runs: readonly Run[], card: string, folder?: string): Run | undefined =>
  runs.find(r => {
    const l = liveLaunchOf(r)
    return l !== null && (l.card === card || (folder !== undefined && sameFolder(l.folder, folder)))
  })

/**
 * Une autre mission que `self` qui porte, vivant, le même lancement, la même carte ou le même dossier que
 * `launch`. La règle est à sens unique : la mission qui en voit une autre perd (au pire les deux perdent et
 * restent en manuel, jamais les deux gagnent).
 */
export const otherCarrierOf = (runs: readonly Run[], launch: RunLaunch, self: string): Run | undefined =>
  runs.find(r => {
    if (r.id === self) return false
    const l = liveLaunchOf(r)
    return l !== null && (l.id === launch.id || l.card === launch.card || sameFolder(l.folder, launch.folder))
  })

/** Où en est une carte, d'après le fichier des missions relu : prête, en lancement, ou lancée (sa mission). */
export type CardState = { kind: 'ready' } | { kind: 'launching'; mode: LaunchMode } | { kind: 'launched'; run: { id: string; title: string } }

export const cardStateOf = (card: LaunchCard, runs: readonly Run[], now: number): CardState => {
  // Une mission qui porte la carte, ou son dossier (une carte reproposée après la perte de la sienne a un autre id) : lancée.
  const run = runOfCard(runs, card.id, card.folder)
  if (run) return { kind: 'launched', run: { id: run.id, title: run.title } }
  if (card.launch && now - card.launch.at < LAUNCH_TTL_MS + LAUNCH_GRACE_MS) return { kind: 'launching', mode: card.launch.mode }
  return { kind: 'ready' }
}

/**
 * Pourquoi la mission `run` ne consomme pas l'enregistrement `record` (null : elle le peut). Contrôlés :
 * le même projet, pas périmé, pas déjà porté par une mission du fichier des missions, la mission pas déjà
 * rattachée, et créée après le clic.
 */
export const consumeRefusal = (record: LaunchRecord | null, run: Run, runs: readonly Run[], root: string, now: number): string | null => {
  if (run.launch !== undefined) return 'attached'
  if (!record) return 'unknown'
  if (record.root !== root) return 'unknown'
  if (isRecordStale(record, now)) return 'stale'
  // Déjà porté par une mission : ce lancement, sa carte, ou son dossier (une carte ne lance qu'une mission).
  if (runOfLaunch(runs, record.id) || runOfCard(runs, record.card, record.folder)) return 'consumed'
  // Seule une mission ouverte après le clic (le COO et la mission tournent sur le même poste, à la même horloge) :
  // une mission plus ancienne qui recevrait l'id ne s'en sert pas.
  if (run.startedAt < record.at) return 'older'
  return null
}

/**
 * Les chemins possibles du skill ask-matt d'après le registre des plugins de Claude Code
 * (`<home>/plugins/installed_plugins.json`, relu tel quel) : l'`installPath` de chaque installation de
 * `mattpocock-skills`, seulement sous `<home>/plugins/` et sans « .. ». L'appelant garde le premier qui existe.
 */
export const askMattCandidates = (raw: unknown, home: string): string[] => {
  const plugins = raw !== null && typeof raw === 'object' ? (raw as { plugins?: unknown }).plugins : undefined
  if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) return []
  const out: string[] = []
  for (const [key, list] of Object.entries(plugins as Record<string, unknown>)) {
    if (!key.startsWith('mattpocock-skills@') || !Array.isArray(list)) continue
    for (const one of list) {
      const path = one !== null && typeof one === 'object' ? (one as { installPath?: unknown }).installPath : undefined
      const install = typeof path === 'string' ? path.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      if (!install.startsWith(`${home}/plugins/`) || install.split('/').includes('..')) continue
      out.push(`${install}/skills/engineering/ask-matt/SKILL.md`)
    }
  }
  return out
}

/** La carte, dite à Claude dans le relevé du COO (textes de Claude, neutralisés par l'appelant). */
export const cardStatus = (s: CardState): string => (s.kind === 'launched' ? 'launched' : s.kind === 'launching' ? `launching (${s.mode})` : 'ready')

/** Le rang d'une carte au relevé du COO, suivi d'une virgule (rien sans rang). */
export const cardRankEn = (card: Pick<LaunchCard, 'rank'>): string => (card.rank !== undefined ? `rank ${card.rank}, ` : '')

/** Les entrées d'une carte au relevé du COO, suivies d'une virgule (rien sans entrées) ; seuls des ids en forme. */
export const cardEntriesEn = (card: Pick<LaunchCard, 'entries'>): string => {
  const ids = (card.entries ?? []).filter(isCardEntryId)
  return ids.length > 0 ? `covers ${ids.length} ${ids.length > 1 ? 'entries' : 'entry'} ${ids.join(', ')}, ` : ''
}

/** Le nombre d'ids montrés sous une carte, avant « … ». */
const CARD_ENTRIES_SHOWN = 10

/** La ligne montrée sous une carte qui porte des entrées : « couvre n entrées : » et les 10 premiers ids, puis « … » ; null sans entrées. */
export const cardEntriesFr = (card: Pick<LaunchCard, 'entries'>): string | null => {
  const ids = (card.entries ?? []).filter(isCardEntryId)
  if (ids.length === 0) return null
  return `couvre ${ids.length} ${ids.length > 1 ? 'entrées' : 'entrée'} : ${ids.slice(0, CARD_ENTRIES_SHOWN).join(', ')}${ids.length > CARD_ENTRIES_SHOWN ? '…' : ''}`
}

// ─── Allumage depuis la vue Coordination ──────────────────────────────────
//
// « ⚡ Auto » puis « Confirmer » sur la ligne d'une mission, chez le titulaire du siège, écrit un
// enregistrement d'allumage dans le stockage du mod, une clé par mission : sur le modèle de
// l'enregistrement de lancement, pris au nom de la discussion de la mission (celle qui la porte au clic,
// `owner`), relu 1,5 s plus tard, effacé avant d'allumer, consommé une fois, dans les 10 minutes.
// Invariant (validé par Mathis) : « L'auto d'une mission ne s'allume jamais sans un clic de Mathis,
// consommé une seule fois, par la seule discussion de cette mission, dans les 10 minutes ; une lecture ou
// une écriture ratée laisse l'auto éteint, sauf deux reprises d'elles-mêmes, dans la discussion qui l'avait allumé :
// celle d'une pause « plus rien ne peut avancer sans toi », une fois toutes ses questions bloquantes répondues, et celle
// d'une pause « discussion arrêtée », quand cette discussion est relancée sous son id dans les 24 h qui suivent la
// dernière activité de la mission. » Un id consommé se note
// dans les entrées appliquées de la mission (`coo-applied:<mission>`), avant l'effacement : une copie rejouée du même
// clic n'allume plus rien, même quand l'allumage a raté. Le COO n'écrit jamais l'état auto ni la date gardée d'un
// clic : la discussion de la mission les pose elle-même, comme pour « Confirmer » dans la mission.

/** L'enregistrement d'allumage d'une mission, écrit par le clic chez le COO, consommé une fois par la discussion de la mission. */
export type AutoOnRecord = {
  v: 1
  id: string
  /** La mission visée. */
  run: string
  root: string
  /** La date du clic. */
  at: number
  /** La discussion du clic (le COO). */
  by: string
  /** La discussion qui portait la mission au clic : la seule qui peut le prendre. */
  owner: string
  /** La discussion qui l'a pris à son nom, en train de le consommer. */
  claim?: { by: string; at: number }
}

/** La clé de l'enregistrement d'allumage d'une mission dans le stockage du mod. */
export const autoOnKey = (runId: string): string => `${AUTO_ON_KEY_PREFIX}${runId}`
export const AUTO_ON_KEY_PREFIX = 'coo-auto-on:'

/** Un enregistrement d'allumage relu : seulement en forme ; null sinon (il ne se consomme pas). */
export const soundAutoOnRecord = (raw: unknown): AutoOnRecord | null => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const x = raw as Record<string, unknown>
  if (x.v !== 1 || !isEntryId(x.id) || !isSafeId(x.run) || typeof x.root !== 'string' || !isTime(x.at) || !isSafeId(x.by) || !isSafeId(x.owner)) return null
  const c = x.claim as Record<string, unknown> | undefined
  const claim = c && isSafeId(c.by) && isTime(c.at) ? { by: c.by, at: c.at } : undefined
  if (x.claim !== undefined && !claim) return null
  return { v: 1, id: x.id, run: x.run, root: x.root, at: x.at, by: x.by, owner: x.owner, ...(claim ? { claim } : {}) }
}

/**
 * Pourquoi la discussion `session` (son id qui pose `owner`) ne consomme pas `record` pour la mission
 * `run` (null : elle le peut). Contrôlés : la même mission et le même projet ; la mission active ici et
 * portée par cette discussion, celle du clic ; pas périmé (10 minutes, horloge future comprise) ; aucune
 * date de l'auto (allumé ou éteint, `dates`) d'après le clic : un rejeu après un allumage ou une coupure
 * meurt par la mission elle-même ; pas pris par une autre discussion.
 */
export const autoOnRefusal = (record: AutoOnRecord, run: Run, isActiveHere: boolean, session: string, here: string, root: string, dates: { onAt?: number; offAt?: number }, now: number): 'other' | 'stale' | 'later' | 'taken' | null => {
  if (record.run !== run.id || record.root !== root || !isActiveHere || run.owner !== session || record.owner !== session) return 'other'
  if (isRecordStale(record, now)) return 'stale'
  if ((dates.onAt !== undefined && dates.onAt >= record.at) || (dates.offAt !== undefined && dates.offAt >= record.at)) return 'later'
  if (record.claim !== undefined && record.claim.by !== here) return 'taken'
  return null
}

/** Une rétro lancée par le COO : l'id de la mission close qu'elle étudie, ou null (une rétro lancée à la main n'en a pas). */
export const retroOf = (run: Run): string | null => {
  const l = liveLaunchOf(run)
  return l?.of && isSafeId(l.of) ? l.of : null
}

/** La mission close a déjà sa rétro (lancée par le COO). */
export const hasRetro = (runs: readonly Run[], mission: string): boolean => runs.some(r => retroOf(r) === mission)

/**
 * La mission a droit à sa carte de rétro : close, pas archivée, l'id en forme, ni une rétro (sa première phase, ou le
 * lancement d'une rétro du COO) ni une mission qui a déjà la sienne (`runs` : toutes les missions, archivées comprises).
 */
export const isRetroCardDue = (run: Run, runs: readonly Run[]): boolean =>
  run.status === 'done' && run.archivedAt === undefined && isSafeId(run.id) && run.phases[0]?.skill !== 'retro' && retroOf(run) === null && !hasRetro(runs, run.id)

/** Le début de la demande de lancement d'une carte : il la reconnaît dans le prompt du COO. */
export const LAUNCH_ASK_START = '◆ COO : lance maintenant la mission'

/** Le texte de `missionLaunchText`, la commande du départ déjà lue (`/<skill>` tel que ce poste le nomme). */
export const launchText = (card: LaunchCard, launchId: string, mode: LaunchMode, command: string): string => {
  const title = neutralInPrompt(card.title)
  // Le titre qui entre dans la commande du shell : lettres, chiffres, espaces et ponctuation simple, rien d'autre.
  const shellTitle = shellSafeTitle(card.title)
  const firstLine = launchFirstLine(launchId)
  // Les entrées de la feuille de route que cite la carte : leur fichier part avec elles, sans quoi la nouvelle discussion le cherchait.
  // Pas pour une rétro : son premier message n'a « rien d'autre », la mission close est sa demande (son titre en reprend les ids).
  const ids = card.of ? [] : cardRoadmapIds(card)
  const roadmap = ids.length > 0 ? `La carte cite ${ids.join(', ')} de la feuille de route : dans le premier message, écris à côté de ${ids.length > 1 ? 'ces entrées' : 'cette entrée'} le chemin de la feuille de route que donne ton relevé, pour que la nouvelle discussion la lise sans la chercher. ` : ''
  const xhigh =
    card.effort === 'xhigh'
      ? "Effort xhigh : si tu as start_session (l'app), demande-moi d'abord de taper /effort xhigh dans cette discussion (l'app ne donne jamais à la session un effort plus haut que le sien), attends que ce soit fait, lance, puis rappelle-moi de redescendre cette discussion en high. "
      : ''
  return (
    `${LAUNCH_ASK_START} « ${title} » dans une nouvelle discussion (je viens de cliquer « ${mode === 'auto' ? 'Lancer en auto' : 'Lancer en manuel'} » sur sa carte ; le lancement vaut 10 minutes). ` +
    (card.of
      ? `Son premier message : ${command} Rétrospective de la mission livrée « ${neutralInPrompt(card.title.replace(/^Rétrospective · /, ''))} », proposée par le COO à sa livraison (son dossier est travail/${card.folder}/), puis cette ligne telle quelle : « ${firstLine} » Rien d'autre : le tableau de bord de la nouvelle discussion lui donne la mission close et ses transcripts ; l'effort part au lancement, ci-dessous. `
      : `Son premier message : ${command} suivi du sujet de la mission en quelques phrases (ce que je t'ai demandé, dans mes mots ; son dossier est travail/${card.folder}/), puis cette ligne telle quelle : « ${firstLine} » Rien d'autre sur le mode : le tableau de bord de la nouvelle discussion le lit lui-même ; l'effort part au lancement, ci-dessous. `) +
    roadmap +
    xhigh +
    `Dans l'app (tu as l'outil start_session) : start_session avec initiation user_asked, context "fresh", effort "${card.effort}", use_worktree false, titre « ${title} ». ` +
    `Dans le CLI (pas de start_session) : par le shell, au premier plan, claude --bg -n ${shellQuote(shellTitle)} --effort ${card.effort} "<premier message>" (sans -w : elle travaille dans ce dossier ; le premier message écrit dans un fichier temporaire passé par "$(cat <fichier>)") ; ajoute --permission-mode au mode de cette discussion si tu le connais. S'il répond « Workspace not trusted », demande-moi de lancer claude une fois dans ce dossier, puis lis cette seule valeur par ${TRUST_COMMAND} (python sous Windows), jamais le fichier entier, qui peut porter des jetons. ` +
    `La nouvelle discussion tourne dans le même mode que celle-ci (app ou terminal) : l'enregistrement du lancement est dans le stockage du tableau de bord, propre à chacun. ` +
    (mode !== 'auto'
      ? ''
      : hasIntentTurn(card)
        ? `Avant de lancer, vérifie que travail/${card.folder}/demande.md existe et est commité (git log -1 -- travail/${card.folder}/demande.md ; dans un projet sans git, qu'il existe), et qu'il porte le tour d'intention de cette carte, pas celui d'une mission précédente du même dossier : le tour d'intention se recueille avant le clic. S'il manque, ne lance pas : dis-le-moi en une ligne (le tour d'intention à recueillir et à commiter, puis un nouveau clic). S'il y est, lance-la tout de suite, sans me poser d'autre question d'abord (le lancement ne vaut que 10 minutes). `
        : `Lance-la tout de suite, sans me poser d'autre question d'abord (le lancement ne vaut que 10 minutes) : ${card.of ? 'une rétro' : 'un découpage de pistes de rétro'} n'a pas de tour d'intention. `) +
    `Ensuite, ne la suis pas activement : elle paraît dans ton relevé ; ${mode === 'auto' ? 'en auto, ses questions bloquantes paraissent ici' : 'en manuel, tu me préviens quand elle m’attend'}.`
  )
}
