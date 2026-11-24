// La rétro d'une mission close, proposée par le COO : une mission à part, lancée par une carte du mod, qui
// garde l'id de la mission close et lit ses transcripts ; ses pistes se cochent chez le COO.
// Invariant : « Une piste de la rétro n'est découpée que si l'utilisateur l'a cochée ; une piste non cochée
// part dans À reprendre, jamais nulle part. » Depuis la liste d'attente (R11 de coo-autonome) : ou reste dans
// la liste, « pas encore validée », relue là (rétro qui relit la liste) ; jamais nulle part.

import type { FlowItem, Run } from '../types'
import { clip } from './basics.ts'
import { isSessionId, missionSessionId, neutralInPrompt, neutralLine } from './closing.ts'
import type { CoordRetro } from './coordination.ts'
import { CARD_GOAL_MAX, CLOCK_SKEW_MS, cardLine, LAUNCH_TTL_MS, RETRO_ADVICE_LEAD, RETRO_START, hasRetro, isFolderName, isRecordStale, launchFirstLine, runOfCard, runOfLaunch, soundRunLaunch, type LaunchCard, type LaunchRecord } from './launch.ts'
import { linkedSessionsOf } from './link.ts'
import { printOf } from './oppositions.ts'

/**
 * L'id de la carte « Pistes de rétro » qui reprend les pistes rendues d'une mission « Pistes de rétro » finie,
 * tiré de la mission et des pistes qu'elle portera : toujours le même pour elles (une seule carte, même rejouée ou
 * après un rechargement), un autre pour d'autres pistes (une seconde fin de la mission, reprise après le lancement
 * de la première carte) ; jamais celui d'une carte de rétro (`kr`), donc un dossier (`pistes-de-retro-<id sans k>`)
 * qui diffère de celui de la mission finie. Préfixe `kn` : la carte qui reprend des pistes dont la carte a disparu,
 * tirée de l'ancienne carte au lieu de la mission.
 */
export const pistesBackCardId = (mission: string, pistes: readonly string[], prefix: 'kq' | 'kn' = 'kq'): string => {
  const print = printOf([mission, ...[...pistes].sort()].join('\n')).replace('.', '').padStart(8, '0')
  return `${prefix}${print}`.slice(0, 25)
}

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

/** La carte « ▶ Rétro de « M » » d'une mission close (livrée ou non) : départ rétro, auto recommandé, effort high, objectif écrit par le mod. */
export const retroCard = (run: Run, report: string | null, now: number): LaunchCard => {
  const reason = retroReason(run, report)
  return {
    id: retroCardId(run.id),
    title: clip(`Rétrospective · ${neutralLine(run.title)}`, 70),
    start: RETRO_START,
    of: run.id,
    askMatt: reason ? `${RETRO_ADVICE_LEAD.recommandée}${reason}` : `${RETRO_ADVICE_LEAD.facultative}rien de signalé dans le rapport, pas de worker`,
    alts: [],
    mode: 'auto',
    modeWhy: 'tu coches ses pistes chez le COO, puis elle continue seule',
    effort: 'high',
    effortWhy: 'un jugement sur un existant ; xhigh se choisit à la main',
    folder: retroFolder(run),
    at: now,
    // Aplati et coupé comme à la relecture (`cardLine`) : un titre neutralisé qui garde deux blancs à la suite ne change pas à la première réécriture.
    goal: cardLine(`Relire ce qui s'est passé dans « ${neutralLine(run.title)} », puis proposer ses pistes, à cocher ici.`, CARD_GOAL_MAX),
  }
}

/** Les discussions d'une mission dont la rétro lit les transcripts : celle où elle est née, la dernière qui l'a portée, et ses workers. */
export const retroSessions = (closed: Run): string[] => [...new Set([...(closed.bornIn ? [closed.bornIn] : []), ...(closed.owner ? [closed.owner] : []), ...linkedSessionsOf(closed).ids])].filter(isSessionId)

/**
 * Les transcripts de la mission close parmi ceux du projet (listés sous le dossier des projets de Claude, jamais
 * un chemin construit d'une valeur relue) ; les discussions sans transcript trouvé, nommées pour que la rétro le dise ;
 * avec `here`, ceux de cette discussion-là (`own`), quand elle est une discussion de la mission close.
 */
export const retroTranscripts = (closed: Run, listed: readonly { path: string; id: string }[], here?: string): { found: string[]; missing: string[]; own?: string[] } => {
  const found: string[] = []
  const missing: string[] = []
  const own: string[] = []
  for (const id of retroSessions(closed)) {
    const hit = listed.filter(t => t.id === id).map(t => t.path)
    if (hit.length > 0) found.push(...hit)
    else missing.push(id)
    // La rétro tourne dans une discussion de la mission étudiée (celle de son manager) : son transcript est parmi eux.
    if (here !== undefined && id === here) own.push(...hit)
  }
  return here === undefined ? { found, missing } : { found, missing, own }
}

/**
 * La discussion du manager d'une mission étudiée, où son clic « Lancer » envoie la rétro : celle que
 * `missionSessionId` désigne (`bornIn` puis `owner`, un id de session en forme, jamais celle du COO, jamais une
 * discussion que nomme une autre mission non archivée), et qu'aucune mission en cours ne tient (la reprendre la mettrait en pause). null : le chemin
 * d'aujourd'hui, une nouvelle discussion. Une discussion de l'autre surface (app ou terminal) ne lit pas le lancement
 * gardé, propre au stockage de chacune : elle ne le prend jamais, et la demande reste sans prise.
 */
export const retroTarget = (studied: Run, runs: readonly Run[], here: string): string | null => {
  const id = missionSessionId(studied, runs, here)
  if (typeof id !== 'string') return null
  if (runs.some(r => r.status === 'active' && r.owner === id)) return null
  return id
}

/**
 * Pourquoi une discussion n'applique pas une demande de rétro (null : elle la prend). `stale` : plus vieille que la
 * durée d'un lancement, ou datée du futur ; `other` : pas pour cette discussion (ni désignée, ni `bornIn` ni `owner`
 * de la mission étudiée) ; `absent` : la mission étudiée n'est pas dans le fichier des missions ; `state` : archivée,
 * plus close, ou qui a déjà une rétro ; `busy` : une mission en cours ici ; `launch` : le lancement absent, d'un
 * autre projet ou d'une autre mission, périmé ou à moins de `RETRO_TAKE_MARGIN_MS` de sa péremption (la rétro doit
 * encore le consommer), déjà pris (par n'importe qui : une prise d'ici date d'une application déjà faite) ou porté par
 * une mission ; `turn` : un tour ouvert ici, la demande attend la relecture suivante.
 * Invariant : « Une demande de rétro n'est jamais appliquée deux fois, ni dans une discussion qui tient une mission
 * en cours ou qui n'est pas celle de la mission étudiée. »
 */
export type RetroRequestRefusal = 'stale' | 'other' | 'absent' | 'state' | 'busy' | 'launch' | 'turn'

/**
 * Le temps qu'il doit rester au lancement avant sa péremption pour qu'une discussion le prenne : la rétro qu'elle lance
 * le consomme ensuite à son premier appel de l'outil, et `consumeRefusal` juge la péremption sans tenir compte de la prise.
 */
export const RETRO_TAKE_MARGIN_MS = 2 * 60_000

/**
 * Le temps que laisse la reprise au terminal pour rouvrir la discussion (processus d'arrière-plan, plugins chargés),
 * finir le tour de son message fixe, la relire (5 s) et prendre le lancement (1,5 s).
 */
export const RETRO_RESUME_LEAD_MS = 90_000

/**
 * L'heure (ms) au-delà de laquelle la reprise de la discussion du manager ne sert plus : la discussion rouverte ne prend
 * plus le lancement à moins de `RETRO_TAKE_MARGIN_MS` de sa péremption, et il lui faut `RETRO_RESUME_LEAD_MS` pour le
 * prendre.
 */
export const retroResumeUntil = (record: Pick<LaunchRecord, 'at'>): number => record.at + LAUNCH_TTL_MS - RETRO_TAKE_MARGIN_MS - RETRO_RESUME_LEAD_MS

/**
 * La reprise au terminal de la discussion du manager servirait-elle la demande de rétro `ask` ? Jugé chez le COO à la
 * composition du repli, d'après les refus que cette discussion opposerait une fois rouverte (`retroRequestRefusal`, et
 * les retours anticipés de son application) : ni la discussion d'ici (le siège du COO n'applique rien), ni une
 * discussion où la mission étudiée n'est ni née ni tenue, une mission étudiée absente, archivée, plus close ou qui a
 * déjà sa rétro, une mission en cours dans cette discussion, une demande déjà notée appliquée chez elle (`applied`), ni
 * un lancement trop près de sa péremption (`retroResumeUntil`). Les autres refus (demande ou lancement périmé, pris ou
 * porté par une mission) écartent le repli entier, plus tôt.
 */
export const isRetroResumeUseful = (o: { ask: CoordRetro; runs: readonly Run[]; here: string; applied: ReadonlySet<string>; record: Pick<LaunchRecord, 'at'>; now: number }): boolean => {
  const { ask, runs } = o
  if (ask.session === o.here || o.applied.has(ask.id) || o.now >= retroResumeUntil(o.record)) return false
  const studied = runs.find(r => r.id === ask.run)
  if (!studied || (studied.bornIn !== ask.session && studied.owner !== ask.session)) return false
  if (studied.archivedAt !== undefined || studied.status !== 'done' || hasRetro(runs, studied.id)) return false
  return !runs.some(r => r.status === 'active' && r.owner === ask.session)
}

/** La demande de rétro est plus vieille que la durée d'un lancement (plus `grace`), ou datée du futur. */
export const isRetroRequestStale = (entry: Pick<CoordRetro, 'at'>, now: number, grace = 0): boolean => now - entry.at >= LAUNCH_TTL_MS + grace || entry.at > now + CLOCK_SKEW_MS

export const retroRequestRefusal = (o: { entry: CoordRetro; runs: readonly Run[]; here: string; root: string; record: LaunchRecord | null; isTurnOpen: boolean; now: number }): RetroRequestRefusal | null => {
  const { entry, runs, here, record, now } = o
  if (isRetroRequestStale(entry, now)) return 'stale'
  if (entry.session !== here) return 'other'
  const studied = runs.find(r => r.id === entry.run)
  if (!studied) return 'absent'
  if (studied.bornIn !== here && studied.owner !== here) return 'other'
  if (studied.archivedAt !== undefined || studied.status !== 'done' || hasRetro(runs, studied.id)) return 'state'
  if (runs.some(r => r.status === 'active' && r.owner === here)) return 'busy'
  if (!record || record.id !== entry.launch || record.root !== o.root || record.of !== studied.id || isRecordStale(record, now) || record.at + LAUNCH_TTL_MS - now < RETRO_TAKE_MARGIN_MS) return 'launch'
  if (record.claim !== undefined || runOfLaunch(runs, record.id) || runOfCard(runs, record.card, record.folder)) return 'launch'
  if (o.isTurnOpen) return 'turn'
  return null
}

/**
 * Les arguments de la commande de rétro que le mod lance dans la discussion du manager : le premier message
 * d'aujourd'hui (la rétrospective de la mission, son dossier, la ligne qui fait rattacher le lancement), qui dit que
 * la rétro tourne dans cette discussion, celle du manager de la mission étudiée. Le titre vient de l'enregistrement
 * (contrôlé à sa pose), neutralisé ; le dossier, en forme.
 */
export const retroCommandArgs = (record: Pick<LaunchRecord, 'id' | 'title' | 'folder'>): string =>
  `Rétrospective de la mission close « ${neutralInPrompt(record.title.replace(/^Rétrospective · /, ''))} », lancée par le COO dans cette discussion, celle du manager de la mission étudiée (le dossier de la rétro est travail/${record.folder}/), puis cette ligne telle quelle : « ${launchFirstLine(record.id)} » Rien d'autre : le tableau de bord de cette discussion lui donne la mission close et ses transcripts.`

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
