// La vue « Coordination » du COO (maquette validée : variante D, chaque chose dans un rectangle, la même structure au
// terminal et sur l'ordinateur), décrite en lignes de morceaux de texte, chacune avec le rectangle qui la contient
// (`CooFrame`), que `view.tsx` dessine : ce module ne dessine rien lui-même et n'importe pas la vue, qui l'importe.
//
// Cinq pages, choisies par une rangée de pastilles en tête (`COO_PAGES`) : Vue d'ensemble (l'encadré du point, puis le
// bloc « Projet » : ce qui t'attend, les retenues, le plan et la vague, les alertes, les premiers choix d'endroit ; puis
// les missions et les cartes), Idées
// (jalon, étapes, idées), À reprendre, Pistes, Réglages. Seule la page choisie est décrite ; une section vide reste
// absente, une page vide dit « Rien pour l'instant. ».

import { shownGroupId } from './basics.ts'
import { C, SKILLS } from './catalog.ts'
import { COO_EFFORT, leadEffortPill } from './effort.ts'
import { neutralLine } from './closing.ts'
import { WAITS_FR, cardTag, cooAgentRows, runTag, cooPoint, roadmapNow, waveText, type CooCard, type CooMission, REPORT_CHANGED, REPORT_PAUSED, type CooDelivery, type CooReport, type CooRetroPicks, type CooRoadmap, type CooAutonomy, type CooStatement, type CooStation, type CooWait } from './coo.ts'
import { cardEntriesFr, isOrdinaryCard, retroAdviceOf, type LaunchMode, type LaunchStart } from './launch.ts'
import { roadmapTextPrint, type RoadmapEntry } from './roadmap.ts'
import { titleOf, type RoadmapTitles } from './titles.ts'
import { complementsOf } from './complement.ts'
import { SECURITY_UNREAD_FR, securityToggleLabel, securityToggleTarget, type SecurityReview } from './security-setting.ts'
import { AUTONOMY_CASES, type AutonomyCaseId } from './autonomy-setting.ts'

/**
 * Un morceau de texte d'une ligne, avec son style. `mark` : un signe vivant à la place du texte, qui en est le texte de
 * remplacement : un point qui pulse (`pulse`), un point fixe (`still`) ou un arc qui tourne (`spin`) ; dessinés hors du
 * terminal, au terminal un glyphe (● et ○ qui alternent à la seconde pour un point qui pulse).
 */
export type CooPart = { text: string; color?: string; bold?: boolean; dim?: boolean; mark?: CooMark; bar?: CooBar }
/**
 * La barre des tickets d'une mission, à la place du texte du morceau (son texte de remplacement) : les faits en vert, la
 * part en cours (un ticket par worker au travail) qui respire ; au terminal, une barre en blocs.
 */
export type CooBar = { done: number; doing: number; total: number }
/** Un signe vivant d'une ligne (`CooPart`). */
export type CooMark = 'pulse' | 'still' | 'spin'
/**
 * Une tuile de chiffre de l'encadré du point : son compte (null : non mesuré, montré « — »), son libellé, son sous-titre,
 * sa couleur et son signe vivant quand elle en a un.
 */
export type CooTile = { key: string; count: number | null; label: string; sub: string; color: string; mark?: CooMark }
/**
 * Un geste d'une ligne de la vue : passer une idée « plus tard » ou l'écarter, remettre une entrée
 * disparue ou un ancien texte disparu (désigné par l'id qui le portait et son empreinte), réparer un
 * fichier hors format (ces gestes demandent au Claude du COO, qui seul écrit la feuille de route), ou
 * choisir où elle vit (`where`, le clic de la personne, gardé par le mod).
 */
export type CooDo =
  | { kind: 'later' | 'drop' | 'restore' | 'repair'; id?: string }
  | { kind: 'restore-text'; id: string; print: string }
  | { kind: 'where'; where: 'repo' | 'poste' }
  | { kind: 'where-ask' }
  | { kind: 'where-cancel' }
  | { kind: 'where-confirm'; where: 'repo' | 'poste' }
  | { kind: 'coord-fresh' }
  | { kind: 'numbers-fresh' }
  | { kind: 'force'; mission: string; held: string; run: string; group: string; on?: 'plan' }
  | { kind: 'pending-launch' | 'pending-attach' | 'pending-later' | 'pending-drop'; id: string }
  | { kind: 'idea-launch'; id: string }
  | { kind: 'launch'; card: string; mode: LaunchMode; at: number }
  | { kind: 'card-start'; card: string; start: LaunchStart }
  | { kind: 'plan-validate'; key: string }
  | { kind: 'wave'; key: string }
  | { kind: 'gesture'; mission: string; question: string; print: string; answer: 'yes' | 'no' }
  | { kind: 'answer-fill'; mission: string; question: string; print: string }
  | { kind: 'report-read'; mission: string; print: string }
  | { kind: 'report-validate'; mission: string; print: string }
  | { kind: 'report-redo'; mission: string }
  | { kind: 'deliver'; key: string }
  | { kind: 'deliver-step'; gesture: 'retry' | 'resume' | 'check' }
  | { kind: 'deliver-drop' }
  | { kind: 'deliver-finish' }
  | { kind: 'retro-tick'; retro: string; item: string }
  | { kind: 'retro-tick-all'; retro: string }
  | { kind: 'retro-pick'; retro: string; print: string }
  | { kind: 'piste-tick'; piste: string }
  | { kind: 'pistes-tick-all'; pistes: string[] }
  | { kind: 'pistes-cut'; print: string }
  | { kind: 'pistes-where'; where: 'repo' | 'poste' }
  | { kind: 'archive'; ids: string[]; print: string }
  | { kind: 'card-remove'; card: string; at?: number }
  | { kind: 'security'; to: 'on' | 'off' }
  | { kind: 'autonomy-ask'; case: AutonomyCaseId }
  | { kind: 'autonomy-confirm'; case: AutonomyCaseId }
  | { kind: 'autonomy-off'; case: AutonomyCaseId }
  | { kind: 'autonomy-cancel' }
  | { kind: 'cut-auto'; mission: string }
  | { kind: 'auto-ask'; mission: string }
  | { kind: 'auto-confirm'; mission: string }
  | { kind: 'night-ask' }
  | { kind: 'night-confirm' }
  | { kind: 'night-stop' }
  | { kind: 'propose' }
/** Une page de la vue Coordination. */
export type CooPage = 'overview' | 'ideas' | 'pending' | 'pistes' | 'settings'
/** Les cinq pages, dans l'ordre des pastilles, avec leur nom. */
const COO_PAGES: readonly (readonly [CooPage, string])[] = [
  ['overview', "Vue d'ensemble"],
  ['ideas', 'Idées'],
  ['pending', 'À reprendre'],
  ['pistes', 'Pistes'],
  ['settings', 'Réglages'],
]
/** La page montrée : celle de l'état d'affichage, « Vue d'ensemble » pour une page absente ou inconnue (une page gardée « todo » ou « missions » d'avant comprise). */
const cooPageOf = (page: string | undefined): CooPage => COO_PAGES.find(([p]) => p === page)?.[0] ?? 'overview'
/**
 * Ce que la vue montre, gardé dans l'état d'affichage du panneau (comme l'onglet choisi) : jamais une donnée du
 * projet. Un geste d'affichage le change sans passer par les gardes des gestes du COO.
 */
export type CooShown = {
  page?: string
  /** L'entrée « À reprendre » dépliée (`pendingOpenKey` : son id et son statut au dépliage), une seule à la fois. */
  open?: string
  /** « ▸ tout voir » de la page « À reprendre » : toutes ses entrées, pas seulement les 20 plus récentes. */
  isAllPending?: boolean
  /** Le bloc « Plus tard » de la page « À reprendre » est déplié. */
  isLaterOpen?: boolean
}
/** Un geste d'affichage : il ne change que l'état d'affichage du panneau ; `open: null` replie l'entrée dépliée. */
export type CooShow = { kind: 'show' } & Omit<CooShown, 'open'> & { open?: string | null }
/** Une pastille de page : sa page, son nom, son compte (aucun pour Réglages ; null quand sa source ne se lit pas, montré « — »), la page choisie, le compte en ambre. */
export type CooPill = { key: string; page: CooPage; name: string; count?: number | null; isCurrent: boolean; isAmber: boolean }
/**
 * Un bouton d'une ligne : sa clé, son libellé, son geste (un geste du COO, ou un geste d'affichage). Encadré par défaut ;
 * `isPrimary` : celui qu'on attend de la personne, coloré (un au plus par élément) ; `isPlain` : une case à cocher ou une
 * flèche de dépliage, en texte simple.
 */
export type CooAction = { key: string; label: string; act: CooDo | CooShow; isPrimary?: true; isPlain?: true }
/**
 * La frise d'une mission dans son couloir : ses stations (`CooMission.stations`), ce qu'est une station (phase ou étape),
 * et si la station en cours pulse (pas pour une mission en pause, close ou dont la discussion est arrêtée).
 */
export type CooRoad = { stations: CooStation[]; unit: 'phase' | 'étape'; isLive: boolean }
/**
 * Une ligne de la vue : un titre de section, une ligne de contenu avec ses boutons, la rangée des pastilles, les tuiles du
 * point ou la frise d'une mission. `isPart` :
 * la suite de l'élément d'au-dessus (le corps d'un rapport, les étapes d'une livraison, l'objectif d'une carte), sans
 * ligne vide avant elle.
 */
export type CooRow = {
  key: string
  kind: 'heading' | 'line' | 'pills' | 'tiles' | 'road'
  parts: CooPart[]
  actions?: CooAction[]
  pills?: CooPill[]
  /** Les tuiles de chiffres de l'encadré du point (`kind: 'tiles'`). */
  tiles?: CooTile[]
  /** La frise des stations d'une mission, dans son couloir (`kind: 'road'`). */
  road?: CooRoad
  /** Des morceaux posés à droite de la ligne (le nombre de missions en cours, à droite de la pastille du point). */
  aside?: CooPart[]
  isPart?: true
  /** Le rectangle de la chose qui porte la ligne (`CooFrame`) ; absent : une ligne hors de tout rectangle. */
  frame?: CooFrame
  /**
   * Dans le rectangle `frame`, le rectangle intérieur, à bordure simple, d'une chose qu'il contient : dans le couloir d'une
   * mission, ce qu'elle attend de la personne ; sur « À reprendre », l'entrée dépliée.
   */
  inner?: CooFrame
  /** Ses boutons encadrés se dessinent au bas de son rectangle, après les lignes qui la suivent (une carte : titre, départ, objectif, puis boutons). */
  isActsLast?: true
  /** Au plus ce nombre de lignes à l'écran, la dernière coupée par « … » (l'objectif d'une carte : trois). */
  maxLines?: number
}

/**
 * Le rectangle d'une chose : des lignes qui se suivent sous le même `id` sont dans le même rectangle, à bordure arrondie de
 * la couleur `color` (sa nature), avec sa pastille de nature `chip` en tête quand elle en a une. Le contenu reste les lignes
 * et les boutons, avec leurs clés.
 */
export type CooFrame = { id: string; color: string; chip?: string }

const NB = ' '

/**
 * Un texte replié en `max` lignes au plus de `cells` caractères, coupé aux espaces (un mot plus long que la ligne est coupé
 * dans le mot) ; un texte qui ne tient pas finit sa dernière ligne par « … ». Le texte ne perd rien d'autre.
 */
export const foldLines = (text: string, cells: number, max: number): string[] => {
  const width = Math.max(8, Math.floor(cells))
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(w => w !== '')) {
    let w = word
    while (w.length > 0) {
      const room = line === '' ? width : width - line.length - 1
      if (w.length <= room) {
        line = line === '' ? w : `${line} ${w}`
        w = ''
      } else if (line !== '' && (w.length <= width || room < 1)) {
        lines.push(line)
        line = ''
      } else {
        // Un mot plus long qu'une ligne, avec de la place sur celle-ci : il la remplit et continue sur la suivante.
        const cut = Math.max(1, room)
        lines.push(line === '' ? w.slice(0, cut) : `${line} ${w.slice(0, cut)}`)
        line = ''
        w = w.slice(cut)
      }
    }
  }
  if (line !== '') lines.push(line)
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  const last = kept[max - 1]!
  kept[max - 1] = `${last.length >= width ? last.slice(0, width - 1) : last}…`
  return kept
}

/** Les lignes d'une chose, dans son rectangle. */
const framed = (rows: readonly CooRow[], frame: CooFrame): CooRow[] => rows.map(r => ({ ...r, frame }))

/** Des lignes mises dans le rectangle `outer` : celles qui avaient déjà le leur l'y gardent en rectangle intérieur. */
const nested = (rows: readonly CooRow[], outer: CooFrame): CooRow[] => rows.map(r => (r.frame ? inLane(r, outer) : { ...r, frame: outer }))

/** Les pastilles de nature d'un rectangle (maquette D). */
const CHIP = {
  point: `◆${NB}COO${NB}·${NB}LE${NB}POINT`,
  question: `?${NB}Question`,
  spend: `?${NB}Dépense`,
  waiting: `◷${NB}T’attend`,
  toForce: `⇥${NB}À${NB}forcer`,
  report: `▤${NB}Rapport`,
  delivered: `✓${NB}Livrée`,
  delivery: `⬆${NB}Livraison`,
  alert: `⚠${NB}Alerte`,
  wave: `⇉${NB}Prochaine${NB}vague`,
  // Les pastilles de ce que la maquette D ne nommait pas : plan sans vague, rangement dû, réponse pas encore appliquée, choix d'endroit.
  plan: `⇉${NB}Plan`,
  tidy: `◷${NB}Rangement`,
  relay: `⚠${NB}Réponse`,
  where: `?${NB}Endroit`,
} as const

/** Le rectangle d'une alerte, à sa couleur d'aujourd'hui (ambre, ou rouge pour celles qui le sont). */
const alertFrame = (id: string, color: string = C.amber): CooFrame => ({ id: `alert-${id}`, color, chip: CHIP.alert })

const hhmm = (at: number): string => new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/**
 * Le titre d'une mission cité, précédé de son numéro court quand la table en donne un (« M12 « titre » ») : le numéro
 * reste hors des guillemets, le titre cité ne change pas.
 */
const named = (s: CooStatement, id: string, title: string): string => {
  const tag = runTag(s, id)
  return `${tag ? `${tag}${NB}` : ''}« ${neutralLine(title)} »`
}

/** Le numéro court en tête d'une ligne de mission ou de carte, en gras ; rien quand la table n'en donne pas. */
const tagPart = (tag: string): CooPart[] => (tag ? [{ text: tag, bold: true }] : [])

/**
 * L'en-tête du couloir d'une mission : son numéro court, son titre, puis sa marque de mode (« ⚡ Auto », avec « repris : … »
 * ou « discussion arrêtée » ; « ✋ Manuel », avec la raison de la pause posée par le mod ou « discussion arrêtée »).
 */
const missionHead = (m: CooMission, tag = ''): CooPart[] => {
  // Sa discussion d'arrière-plan arrêtée : « discussion arrêtée » à la place de « repris : … », ou d'un manuel sans pause écrite.
  const autoTail = m.stopped ?? m.resumed
  const manualTail = m.pause !== undefined ? neutralLine(m.pause) : m.stopped
  const mode: CooPart = m.mode === 'auto' ? { text: `⚡${NB}Auto${autoTail !== undefined ? ` · ${autoTail}` : ''}`, color: C.teal, bold: true } : { text: `✋${NB}Manuel${manualTail !== undefined ? ` · ${manualTail}` : ''}`, dim: true }
  return [...tagPart(tag), { text: neutralLine(m.title), bold: true }, mode]
}

/**
 * Les boutons d'une ligne de mission qui n'est pas close : « ✋ Couper l'auto » sur une mission en auto (une mission
 * en pause garde son auto allumé : il se coupe aussi), dont le clic écrit une entrée que le mod de la mission
 * applique, sans jamais rien allumer ; « ⚡ Auto » sur une mission en manuel ouverte dans une discussion, puis
 * « Confirmer » et « Annuler », dont le second clic écrit l'enregistrement que la discussion de la mission prend.
 */
const missionActions = (m: CooMission, ask: string | undefined): { actions?: CooAction[] } => {
  if (m.status === 'done') return {}
  if (m.mode === 'auto') return { actions: [{ key: `coo-cut-auto-${m.id}`, label: `✋${NB}Couper l’auto`, act: { kind: 'cut-auto', mission: m.id } }] }
  if (!m.isOpen) return {}
  if (ask === m.id)
    return {
      actions: [
        { key: `coo-auto-confirm-${m.id}`, label: 'Confirmer', act: { kind: 'auto-confirm', mission: m.id }, isPrimary: true },
        { key: `coo-auto-cancel-${m.id}`, label: 'Annuler', act: { kind: 'auto-ask', mission: m.id } },
      ],
    }
  return { actions: [{ key: `coo-auto-on-${m.id}`, label: `⚡${NB}Auto`, act: { kind: 'auto-ask', mission: m.id } }] }
}

/** La surveillance de nuit allumée, comme la montrent la vue Coordination et le bandeau du COO (libellé validé par la personne). */
export const nightParts = (night: { until: number }): CooPart[] => [{ text: `🌙${NB}Surveillance de nuit · jusqu’à ${hhmm(night.until)}`, color: C.violet, bold: true }]

/**
 * Le bouton d'allumage de la surveillance de nuit, dans l'encadré du point : « 🌙 Surveillance de nuit », puis
 * « Confirmer » et « Annuler », dont le second clic l'allume (seulement chez le titulaire du siège).
 */
const nightActions = (s: CooStatement): CooAction[] =>
  s.nightAsk
    ? [
        { key: 'coo-night-confirm', label: 'Confirmer', act: { kind: 'night-confirm' }, isPrimary: true },
        { key: 'coo-night-cancel', label: 'Annuler', act: { kind: 'night-ask' } },
      ]
    : [{ key: 'coo-night-ask', label: `🌙${NB}Surveillance de nuit`, act: { kind: 'night-ask' } }]

/**
 * Les genres des choses qui t'attendent, chacun avec son compte et son nom (un, plusieurs) : questions, missions qui
 * attendent, rapports, missions livrées (leurs lignes), retenues « à forcer » (pas les grises). La seule table de ce
 * compte : la pastille « Vue d'ensemble » et la tuile « t'attendent » en font la somme, le sous-titre de la tuile la nomme.
 */
const waitKindsOf = (s: CooStatement, deliveredCount: number): readonly (readonly [number, string, string])[] => [
  [s.waits.length, 'question', 'questions'],
  [s.waiting.length, 'mission', 'missions'],
  [(s.reports ?? []).length, 'rapport', 'rapports'],
  [deliveredCount, 'à archiver', 'à archiver'],
  [toForceCount(s), 'retenue', 'retenues'],
]

/** Les choses qui t'attendent, comptées par la pastille « Vue d'ensemble » : la somme des genres de `waitKindsOf`. */
const waitsCountOf = (s: CooStatement, deliveredCount: number): number => waitKindsOf(s, deliveredCount).reduce((n, [count]) => n + count, 0)

/**
 * Les missions en cours, que l'encadré du point compte et dont il fait pulser le point, comme celui de la tuile « missions » :
 * celles dont le couloir est « en cours » ou « worker au travail » (`laneStateOf`).
 */
const runningCount = (s: CooStatement): number => s.missions.filter(m => LANE_STATE[laneStateOf(s, m)].isLive).length

/** Un compte et son nom, accordé (« 1 question », « 2 questions »). */
const counted = (n: number, one: string, many: string): string => `${n}${NB}${n > 1 ? many : one}`

/**
 * Les quatre tuiles de l'encadré du point, dans l'ordre : « t'attendent » (le compte de la pastille « Vue d'ensemble »,
 * ses genres comptés en sous-titre, ambre avec un point qui pulse au-dessus de zéro), « missions » (celles de la vue, le
 * nombre en auto pas closes, son point pulse quand une mission est en cours), « workers » (confiés et pas rendus, un arc
 * qui tourne au-dessus de zéro), « au départ » (les cartes montrées ; « — » sur une liste des cartes illisible).
 */
const pointTiles = (s: CooStatement, deliveredCount: number, running: number): CooTile[] => {
  const waits = waitsCountOf(s, deliveredCount)
  const kinds = waitKindsOf(s, deliveredCount)
  const auto = s.missions.filter(m => m.mode === 'auto' && m.status !== 'done').length
  const workers = s.missions.reduce((n, m) => n + m.workers.filter(w => w.state === 'working').length, 0)
  const cards = s.cardsUnread ? null : shownCards(s).length
  return [
    {
      key: 'coo-tile-waits',
      count: waits,
      label: 't’attendent',
      sub: waits === 0 ? 'rien pour l’instant' : kinds.filter(([n]) => n > 0).map(([n, one, many]) => counted(n, one, many)).join(' · '),
      color: waits > 0 ? C.amber : C.gray,
      ...(waits > 0 ? { mark: 'pulse' as const } : {}),
    },
    { key: 'coo-tile-missions', count: s.missions.length, label: 'missions', sub: `${auto}${NB}en${NB}auto`, color: C.tangerine, ...(running > 0 ? { mark: 'pulse' as const } : {}) },
    { key: 'coo-tile-workers', count: workers, label: 'workers', sub: workers > 0 ? 'au travail' : 'aucun', color: C.blue, ...(workers > 0 ? { mark: 'spin' as const } : {}) },
    { key: 'coo-tile-cards', count: cards, label: 'au départ', sub: 'cartes à lancer', color: C.teal },
  ]
}

/** Les retenues « à forcer » du relevé : les seules retenues que comptent la pastille « Vue d'ensemble », le point et le bandeau. */
const toForceCount = (s: CooStatement): number => s.holds.filter(h => h.isToForce).length

/**
 * Le haut de la page « Vue d'ensemble » : l'encadré du point (le nombre en cours à droite de sa pastille, ses quatre
 * tuiles, la prochaine étape du projet et la surveillance de nuit dedans), puis le bloc « Projet » (ce qui ne tient à
 * aucune mission de la liste : ce qui tient à une mission listée est dans son couloir, `laneRows`),
 * sous un seul en-tête, une chose par rectangle : ce qui t'attend (questions, rapports, livraison, missions livrées,
 * réponses pas encore appliquées, missions qui t'attendent, retenues, puis le rangement dû), le plan du
 * projet et la prochaine vague, les alertes (départs croisés compris), les premiers choix d'endroit. Une retenue grise et
 * la ligne « compatibles » restent des lignes sans rectangle. Quand rien n'attend dans le bloc,
 * une ligne d'abord, puis les alertes et les choix d'endroit dessous : « Rien pour l'instant. » quand rien ne t'attend
 * nulle part (le compte de la tuile « t'attendent » à zéro), sinon le renvoi aux couloirs.
 */
const todoRows = (s: CooStatement, delivered: CooRow[]): CooRow[] => {
  const point = cooPoint(s)
  const alerts = [...(s.roadmap ? roadmapAlertRows(s.roadmap) : []), ...crossedRows(s), ...outsideRows(s), ...oppositionRows(s), ...coordinationFileRows(s), ...numbersRows(s), ...(s.cardsUnread ? cardsUnreadRows(s.cardsUnread) : [])]
  const where = [...(s.roadmap ? roadmapWhereRows(s.roadmap) : []), ...pistesWhereRows(s)]
  const plan = planWaveRows(s)
  const tidy = tidyUpRow(s)
  // Ce qui tient à une mission de la liste va dans son couloir ; le reste (sa mission absente de la liste) reste ici.
  const isListed = (id: string): boolean => s.missions.some(m => m.id === id)
  const projectWaits = s.waits.filter(w => !isListed(w.missionId))
  const projectWaiting = s.waiting.map((w, i) => [w, i] as const).filter(([w]) => !isListed(w.missionId))
  const projectHolds = s.holds.filter(h => !isListed(h.missionId))
  const pointFrame: CooFrame = { id: 'coo-point', color: C.teal, chip: CHIP.point }
  const running = runningCount(s)
  return [
    ...framed(
      [
        // L'en-tête de l'encadré : sa pastille, et à droite le point des missions en cours et leur nombre.
        { key: 'coo-point', kind: 'heading', parts: [], aside: [{ text: 'missions en cours', color: C.tangerine, mark: running > 0 ? 'pulse' : 'still' }, { text: `${running}${NB}en${NB}cours`, color: C.tangerine, bold: true }] },
        { key: 'coo-tiles', kind: 'tiles', parts: [], tiles: pointTiles(s, delivered.length, running) },
        // Les tuiles disent les deux premières phrases du point ; reste la prochaine étape du projet.
        ...point.slice(2).map((text, i) => ({ key: `coo-point-${i + 2}`, kind: 'line' as const, parts: [{ text }] })),
        // La surveillance de nuit : allumée, son bandeau et « Arrêter » ; éteinte, le seul bouton qui l'allume, sous le point.
        s.night
          ? { key: 'coo-night', kind: 'line' as const, parts: nightParts(s.night), actions: [{ key: 'coo-night-stop', label: 'Arrêter', act: { kind: 'night-stop' as const } }] }
          : { key: 'coo-night', kind: 'line' as const, parts: [], actions: nightActions(s), isPart: true as const },
      ],
      pointFrame,
    ),
    { key: 'coo-project', kind: 'heading', parts: [{ text: 'Projet', bold: true }] },
    ...(projectWaits.length + projectWaiting.length + s.relays.length + (s.reports ?? []).length + (s.delivery ? 1 : 0) + delivered.length + projectHolds.length + (tidy ? 1 : 0) + plan.length === 0
      ? [
          waitsCountOf(s, delivered.length) === 0
            ? { key: 'coo-waits-none', kind: 'line' as const, parts: [{ text: 'Rien pour l’instant.', dim: true }] }
            : { key: 'coo-waits-lanes', kind: 'line' as const, parts: [{ text: `↓${NB}ce qui t’attend est dans les couloirs, plus bas`, dim: true }] },
        ]
      : [
          ...projectWaits.map(w => waitRow(s, w)),
          ...(s.reports ?? []).flatMap(r => framed(reportRows(s, r), { id: `report-${neutralLine(r.missionId)}`, color: C.pink, chip: CHIP.report })),
          ...(s.delivery ? framed(deliveryRows(s.delivery), { id: 'delivery', color: C.sky, chip: CHIP.delivery }) : []),
          ...delivered,
          // Une réponse donnée ici qui ne s'applique pas encore : la mission fermée, ou la question changée depuis.
          ...s.relays.map((r, i) => ({
            key: `coo-relay-${i}`,
            kind: 'line' as const,
            frame: { id: `relay-${i}`, color: C.amber, chip: CHIP.relay },
            parts: [
              { text: '⚠', color: C.amber, bold: true },
              {
                text:
                  r.state === 'paused'
                    ? `Ta réponse à ${neutralLine(r.question)} de ${named(s, r.missionId, r.mission)} attend : reprends-la pour que la réponse s’applique.`
                    : `La question ${neutralLine(r.question)} de ${named(s, r.missionId, r.mission)} a changé depuis ta réponse : relis-la, elle n’est pas répondue.`,
              },
            ],
          })),
          ...projectWaiting.map(([w, i]) => waitingRow(s, w, i)),
          ...holdRows(s, projectHolds),
          ...(tidy ? [{ ...tidy, frame: { id: 'tidy-up', color: C.amber, chip: CHIP.tidy } }] : []),
          ...plan,
        ]),
    ...alerts,
    ...where,
  ]
}

/** Une question bloquante d'une mission, dans son rectangle ambre (« ? Question », ou « ? Dépense » pour une dépense). */
const waitRow = (s: CooStatement, w: CooWait): CooRow => ({
  key: `coo-wait-${waitKey(w)}`,
  kind: 'line',
  frame: { id: `wait-${waitKey(w)}`, color: C.amber, chip: w.gesture?.kind === 'spend' ? CHIP.spend : CHIP.question },
  parts: [
    { text: '?', color: C.amber, bold: true },
    { text: `${neutralLine(w.id)} « ${neutralLine(w.text)} »` },
    ...(w.gesture?.kind === 'flaw' ? [{ text: `(laisse ${w.gesture.dismissed ?? 0} faille${(w.gesture.dismissed ?? 0) > 1 ? 's' : ''}${w.target ? ` · ${neutralLine(w.target)}` : ''})`, color: C.amber }] : []),
    ...(w.isMod ? [{ text: 'réponds dans la mission', dim: true }] : []),
    { text: `· ${runTag(s, w.missionId) ? `${runTag(s, w.missionId)}${NB}` : ''}${neutralLine(w.mission)}${w.at !== null ? ` · depuis ${hhmm(w.at)}` : ''}`, dim: true },
    ...(w.relay ? [{ text: `◷${NB}réponse en cours d’application`, color: C.amber, bold: true }] : []),
  ],
  ...(w.relay || w.isMod ? {} : { actions: waitActions(w) }),
})

/** La ligne « t'attend » d'une mission dont le tour fini demande la personne (en manuel, ou en auto mis en pause), dans son rectangle ambre ; `i` : son rang dans le relevé, qui fait sa clé. */
const waitingRow = (s: CooStatement, w: CooStatement['waiting'][number], i: number): CooRow => ({
  key: `coo-waiting-${i}`,
  kind: 'line',
  frame: { id: `waiting-${i}`, color: C.amber, chip: CHIP.waiting },
  parts: [{ text: '◷', color: C.amber, bold: true }, { text: `La mission ${named(s, w.missionId, w.mission)} t’attend : ${WAITS_FR[w.kind]}, depuis ${hhmm(w.since)}` }],
})

/**
 * Le rangement dû hors d'une livraison, dans le bloc « Projet » : « Rangement : n à faire », précisé « attend ta
 * réponse » quand le COO a déclaré un relevé remis ; aucune ligne quand rien n'est dû. Le travail du COO, pas un geste
 * de la personne : il n'entre pas dans le compte de la pastille « Vue d'ensemble ».
 */
const tidyUpRow = (s: CooStatement): CooRow | null =>
  s.tidyUp && s.tidyUp.count > 0
    ? { key: 'coo-tidy-up', kind: 'line', parts: [{ text: '◷', color: C.amber, bold: true }, { text: `Rangement : ${s.tidyUp.count} à faire` }, ...(s.tidyUp.waitsUser ? [{ text: '· attend ta réponse', color: C.amber }] : [])] }
    : null

/**
 * Le plan du projet et la prochaine vague, dans un même rectangle cyan du bloc « Projet » : pastille « ⇉ Prochaine vague »
 * quand une vague attend son départ, sinon « ⇉ Plan » quand il montre un plan, sinon aucune ; un plan illisible est une
 * alerte à part, la vague garde alors son rectangle, sans « ⇉ Plan ».
 */
const planWaveRows = (s: CooStatement): CooRow[] => {
  const plan = planRows(s)
  const wave = waveRows(s)
  const isWaiting = (s.wave?.next.length ?? 0) > 0
  const frameOf = (hasPlan: boolean): CooFrame => ({ id: 'plan', color: C.cyan, ...(isWaiting ? { chip: CHIP.wave } : hasPlan ? { chip: CHIP.plan } : {}) })
  if (s.plan?.unread) return [...framed(plan, alertFrame('plan')), ...framed(wave, frameOf(false))]
  return framed([...plan, ...wave], frameOf(plan.length > 0))
}

/** L'état d'un couloir, le premier qui vaut (`laneStateOf`). */
type LaneState = 'close' | 'pause' | 'stopped' | 'waits' | 'worker' | 'nowhere' | 'running'

/**
 * Le libellé, la couleur et le point de chaque état d'un couloir : le point pulse pour « en cours » et « worker au
 * travail » seulement. Le COO ne sait pas si une autre discussion est au milieu d'un tour : jamais « Claude travaille ».
 */
const LANE_STATE: Record<LaneState, { text: string; color: string; isLive: boolean }> = {
  close: { text: 'close', color: C.gray, isLive: false },
  pause: { text: 'en pause', color: C.gray, isLive: false },
  stopped: { text: 'discussion arrêtée', color: C.gray, isLive: false },
  waits: { text: 't’attend', color: C.amber, isLive: false },
  worker: { text: 'worker au travail', color: C.blue, isLive: true },
  nowhere: { text: 'ouverte nulle part', color: C.gray, isLive: false },
  running: { text: 'en cours', color: C.tangerine, isLive: true },
}

/**
 * L'état d'un couloir, le premier qui vaut : close ; en pause ; discussion arrêtée (verdict du signal de vie) ; t'attend
 * (le signal « t'attend » de la mission, son tour fini ; une question bloquante seule ne le donne pas) ; worker au travail
 * (un worker confié et pas rendu) ; ouverte nulle part (aucune discussion ne la tient) ; sinon en cours.
 */
const laneStateOf = (s: CooStatement, m: CooMission): LaneState =>
  m.status === 'done'
    ? 'close'
    : m.status === 'paused'
      ? 'pause'
      : m.stopped !== undefined
        ? 'stopped'
        : s.waiting.some(w => w.missionId === m.id)
          ? 'waits'
          : m.workers.some(w => w.state === 'working')
            ? 'worker'
            : !m.isOpen
              ? 'nowhere'
              : 'running'

/** Une ligne mise dans le rectangle `lane` (un couloir, un bloc) : son propre rectangle, quand elle en a un, devient un rectangle intérieur. */
const inLane = (row: CooRow, lane: CooFrame): CooRow => {
  const { frame, ...rest } = row
  return { ...rest, frame: lane, ...(frame ? { inner: frame } : {}) }
}

/**
 * Ce qu'un couloir porte pour la personne, dans l'ordre : les questions bloquantes de la mission, la ligne « t'attend » de
 * son tour fini, les retenues où elle est la mission qui attend (« à forcer » puis grises) ; `count` : ce qui compte pour la
 * personne (« n pour toi », la bordure ambre et le rang), jamais une retenue grise.
 */
const laneThings = (s: CooStatement, m: CooMission): { rows: CooRow[]; count: number } => {
  const waits = s.waits.filter(w => w.missionId === m.id)
  const waiting = s.waiting.map((w, i) => [w, i] as const).filter(([w]) => w.missionId === m.id)
  const holds = s.holds.filter(h => h.missionId === m.id)
  return {
    rows: [...waits.map(w => waitRow(s, w)), ...waiting.map(([w, i]) => waitingRow(s, w, i)), ...holdRows(s, holds)],
    count: waits.length + waiting.length + holds.filter(h => h.isToForce).length,
  }
}

/**
 * Le couloir d'une mission : en tête son numéro court, son titre et sa marque de mode ; puis sa ligne d'état (le point, qui
 * pulse pour « en cours » et « worker au travail », l'état, ses workers, la barre de ses tickets et « n pour toi ») ; puis
 * la frise de ses stations, qui dit sa phase ; puis, chacune dans un rectangle intérieur, les choses qu'elle attend de la
 * personne ; ses boutons au bas.
 * Bordure ambre quand elle attend la personne, grise en pause, close ou discussion arrêtée, sinon la couleur du skill de sa phase.
 */
const laneRows = (s: CooStatement, m: CooMission, things: { rows: CooRow[]; count: number }): CooRow[] => {
  const state = laneStateOf(s, m)
  const look = LANE_STATE[state]
  const def = SKILLS[m.phase]
  const color = things.count > 0 ? C.amber : state === 'close' || state === 'pause' || state === 'stopped' ? C.gray : (def?.color ?? C.gray)
  const lane: CooFrame = { id: `mission-${m.id}`, color }
  const working = m.workers.filter(w => w.state === 'working').length
  // Les comptes relayés quand le relais se lit (le même compteur que la page Mission), les stockés sinon.
  const done = m.relayedDone ?? m.done
  const stateParts: CooPart[] = [
    { text: look.text, color: look.color, mark: look.isLive ? 'pulse' : 'still' },
    { text: look.text, color: look.color, bold: true },
    // En manuel, ouverte dans aucune discussion (en pause comprise) : elle ne peut pas s'allumer d'ici.
    ...(m.mode === 'manual' && m.status !== 'done' && !m.isOpen ? [{ text: 'Reprends-la pour l’allumer', dim: true }] : []),
    ...m.workers.flatMap((w): CooPart[] => [
      ...(w.state === 'working' ? [{ text: `worker ${shownGroupId(w.group)} au travail`, color: C.blue, mark: 'spin' as const }] : []),
      { text: `↗${w.group}${NB}${(w.relayed ?? w).done}/${(w.relayed ?? w).total}${w.state === 'returned' || w.state === 'reported' ? `${NB}rendu` : ''}`, color: C.blue, bold: true },
    ]),
    ...(m.total > 0
      ? [
          { text: `${done} ${done > 1 ? 'tickets faits' : 'ticket fait'} sur ${m.total}`, bar: { done, doing: Math.min(working, Math.max(0, m.total - done)), total: m.total } },
          { text: `${done}/${m.total}${NB}tickets`, dim: true },
        ]
      : []),
    ...(things.count > 0 ? [{ text: `·${NB}${things.count}${NB}pour${NB}toi`, color: C.amber, bold: true }] : []),
  ]
  return [
    { key: `coo-mission-${m.id}`, kind: 'line', frame: lane, parts: missionHead(m, runTag(s, m.id)), ...missionActions(m, s.autoAsk), isActsLast: true },
    { key: `coo-mission-${m.id}-state`, kind: 'line', frame: lane, parts: stateParts },
    // La frise : sa station en cours ne pulse pas quand la mission est en pause, close ou que sa discussion est arrêtée.
    ...(m.stations.length > 0
      ? [{ key: `coo-mission-${m.id}-road`, kind: 'road' as const, frame: lane, parts: [], road: { stations: m.stations, unit: m.stationUnit, isLive: state !== 'close' && state !== 'pause' && state !== 'stopped' } }]
      : []),
    ...things.rows.map(r => inLane(r, lane)),
  ]
}

/**
 * Le bas de la page « Vue d'ensemble » : les missions en couloirs (celles qui attendent la personne d'abord, puis les
 * autres, chaque rang dans l'ordre du relevé), puis les cartes de lancement (« Au départ »).
 */
const missionsRows = (s: CooStatement): CooRow[] => {
  const lanes = s.missions.map(m => ({ m, things: laneThings(s, m) }))
  return [
    { key: 'coo-missions', kind: 'heading', parts: [{ text: `Missions · ${s.missions.length}`, bold: true }] },
    ...(s.missions.length === 0
      ? [{ key: 'coo-missions-none', kind: 'line' as const, parts: [{ text: 'Aucune mission dans ce projet.', dim: true }] }]
      : [...lanes.filter(l => l.things.count > 0), ...lanes.filter(l => l.things.count === 0)].flatMap(l => laneRows(s, l.m, l.things))),
    ...cardRows(s),
  ]
}

/** Les lignes d'une page, sans la rangée de pastilles. */
const pageRows = (s: CooStatement, page: CooPage, shown: CooShown, security: SecurityReview, delivered: CooRow[]): CooRow[] => {
  switch (page) {
    // Ce que montraient les deux pages d'avant, « À faire » puis « Missions », avec leurs clés ; ce qui tient à une mission
    // de la liste passe dans son couloir.
    case 'overview':
      return [...todoRows(s, delivered), ...missionsRows(s)]
    // Une feuille de route illisible ou hors format : ni idée ni entrée ne se montre, et la page renvoie à son alerte plutôt
    // que de dire qu'il n'y a rien.
    case 'ideas':
      return isRoadmapUnread(s.roadmap) ? roadmapUnreadRows(page) : s.roadmap ? roadmapIdeaRows(s.roadmap, shown) : []
    case 'pending':
      return isRoadmapUnread(s.roadmap) ? roadmapUnreadRows(page) : s.roadmap ? roadmapPendingRows(s.roadmap, shown) : []
    case 'pistes':
      return [...retroPickRows(s), ...pistesWaitingRows(s)]
    case 'settings':
      return [...roadmapPlaceRows(s.roadmap, s.whereAsk === true), ...securitySettingRows(security), ...autonomyRows(s.autonomy)]
  }
}

/** Les entrées ouvertes de la feuille de route, quand elle se lit ; sinon rien. */
const roadmapOpen = (r: CooRoadmap | undefined) => (r && r.read !== 'unread' && r.read !== null && r.read.ok ? roadmapNow(r) : null)

/** La liste principale de la page « À reprendre », que comptent son en-tête et sa pastille : les « à décider » et les rattachées. */
const pendingMainCount = (now: NonNullable<ReturnType<typeof roadmapOpen>>): number => now.pending.filter(e => e.status !== 'plus tard').length + now.attached.length

/** La feuille de route existe mais ne se lit pas (lecture ratée, ou hors format) : ses comptes ne sont pas mesurés. */
const isRoadmapUnread = (r: CooRoadmap | undefined): boolean => r !== undefined && (r.read === 'unread' || (r.read !== null && !r.read.ok))

/** Les pages « Idées » et « À reprendre » sur une feuille de route illisible : un renvoi à l'alerte de « Vue d'ensemble ». */
const roadmapUnreadRows = (page: CooPage): CooRow[] => [
  { key: `coo-page-${page}-unread`, kind: 'line', parts: [{ text: 'Feuille de route illisible : voir l\'alerte sur « Vue d\'ensemble »', dim: true }] },
]

/**
 * Les pastilles des pages et leurs comptes : « Vue d'ensemble » ce qui t'attend (`waitsCountOf`, ambre au-dessus de zéro ; le
 * compte des missions reste dans l'en-tête « Missions · n » de la page), « Idées » les idées ouvertes, « À reprendre » comme l'en-tête de sa page (les entrées « à décider »
 * et les rattachées ; les « plus tard » ont leur propre bloc), « Pistes »
 * les pistes « pas encore validée » et celles à cocher d'une rétro lancée par le COO, « Réglages » sans compte.
 */
const pillsOf = (s: CooStatement, page: CooPage, deliveredCount: number): CooPill[] => {
  const now = roadmapOpen(s.roadmap)
  // Une feuille de route illisible ou hors format, une liste d'attente illisible ou qui a perdu des pistes déjà vues (ni l'une
  // ni l'autre n'est montrée) : un compte non mesuré (null, « — »), jamais 0.
  const roadmapUnread = isRoadmapUnread(s.roadmap)
  const waitlistUnread = s.waitlist !== undefined && (s.waitlist.state === 'unread' || s.waitlist.state === 'missing' || s.waitlist.seenUnread === true)
  const w = s.pistesWaiting
  const retroPicksCount = (s.retroPicks ?? []).filter(p => !p.isSent).reduce((n, p) => n + p.items.length, 0)
  const counts: Record<CooPage, number | null | undefined> = {
    overview: waitsCountOf(s, deliveredCount),
    ideas: roadmapUnread ? null : (now?.ideas.length ?? 0),
    pending: roadmapUnread ? null : now ? pendingMainCount(now) : 0,
    // Les pistes d'une rétro lancée par le COO, à cocher sur la même page, comptent aussi : rien ne la signalait sinon.
    pistes: waitlistUnread ? null : (w ? (w.pending ?? w.rows.filter(r => r.state === 'pending').length) : 0) + retroPicksCount,
    settings: undefined,
  }
  return COO_PAGES.map(([p, name]) => {
    const count = counts[p]
    return { key: `coo-page-${p}`, page: p, name, ...(count === undefined ? {} : { count }), isCurrent: p === page, isAmber: p === 'overview' && (count ?? 0) > 0 }
  })
}

/** « · 2 spécialistes au travail » d'une ligne de la liste des agents ; rien à zéro ou sans registre lu en entier. */
const runningParts = (running: number | undefined): CooPart[] =>
  running !== undefined && running > 0 ? [{ text: `·${NB}${running}${NB}${running > 1 ? 'spécialistes' : 'spécialiste'} au travail`, color: C.gray }] : []

/**
 * L'onglet Agents du COO, avant son dessin : la liste des managers et de leurs workers (`cooAgentRows`, `coo.ts`), une
 * ligne par manager (« ◆ M12 Titre · ⚙ Implémentation · attend ta réponse »), ses workers en retrait sous lui
 * (« ↗ A 2/3 · en cours », l'état dans les mots et la couleur de la ligne du groupe de la page Mission) ; « aucune
 * mission en cours » pour une liste vide ; sur chaque ligne, le nombre de spécialistes au travail quand le registre de
 * sa discussion le dit (« · 2 spécialistes au travail »). Ni frise, ni sélecteur, ni ligne de spécialiste, ni ligne pour le COO.
 */
export const agentsListRows = (s: CooStatement): CooRow[] => {
  const rows = cooAgentRows(s)
  if (rows.length === 0) return [{ key: 'coo-agents-none', kind: 'line', parts: [{ text: 'aucune mission en cours', dim: true }] }]
  return rows.map((r, i): CooRow => {
    if (r.kind === 'worker')
      return {
        key: `coo-agent-${r.mission}-${r.group}`,
        kind: 'line',
        isPart: true,
        parts: [
          { text: `${NB}${NB}${NB}↗${NB}${shownGroupId(r.group)}${NB}${r.done}/${r.total}`, color: C.blue, bold: true },
          // En gras comme la ligne du groupe de la page Mission (`linkLabel`).
          { text: `·${NB}${r.state.text}`, color: r.state.color, bold: true },
          ...runningParts(r.running),
        ],
      }
    const def = SKILLS[r.phase]
    return {
      key: `coo-agent-${r.mission}`,
      kind: 'line',
      ...(i > 0 ? {} : { isPart: true as const }),
      parts: [
        { text: `◆${r.tag ? `${NB}${r.tag}` : ''}`, color: C.violet, bold: true },
        { text: r.title, bold: true },
        { text: `·${NB}${def ? `${def.glyph}${NB}${def.label}` : 'phase inconnue'}`, color: def?.color ?? C.gray },
        ...(r.state !== undefined ? [{ text: `·${NB}${r.state.text}`, color: r.state.color }] : []),
        ...runningParts(r.running),
      ],
    }
  })
}

/**
 * Les lignes de l'onglet Coordination, calculées sur le relevé et l'état d'affichage : la rangée des pastilles, puis les
 * seules lignes de la page choisie (« Vue d'ensemble » pour une page absente ou inconnue) ; une page sans rien à montrer dit
 * « Rien pour l'instant. ». `security` : le réglage de la revue de sécurité, que montre la page « Réglages ».
 */
export const coordinationRows = (s: CooStatement, shown: CooShown = {}, security: SecurityReview = 'unread'): CooRow[] => {
  const page = cooPageOf(shown.page)
  // Les lignes des missions livrées dans le bloc « Projet » (chacune sans carte de rétro prête, puis « Tout archiver » dès
  // deux, cartes comprises) : la pastille et « Rien pour l'instant » comptent ces mêmes lignes, jamais un autre compte.
  const delivered = deliveredRows(s)
  const rows = pageRows(s, page, shown, security, delivered)
  return [
    { key: 'coo-pages', kind: 'pills', parts: [], pills: pillsOf(s, page, delivered.length) },
    ...(rows.length === 0 ? [{ key: `coo-page-${page}-none`, kind: 'line' as const, parts: [{ text: 'Rien pour l’instant.', dim: true }] }] : rows),
  ]
}

/** Le rectangle d'un réglage de la page « Réglages » : gris. */
const settingFrame = (id: string): CooFrame => ({ id, color: C.gray })

/**
 * Les cases d'autonomie du mode auto, sur la page « Réglages » (textes validés par la personne) : chacune
 * « ☐ » ou « ☑ » d'après le fichier relu ; une case vide ouvre « Cocher « <case> » ? » avec « Confirmer » et « Annuler »
 * (seul « Confirmer », qui porte sa case, écrit) ; une case cochée se décoche d'un clic. Le geste dit toujours l'état
 * visé, jamais « inverser ». Cases illisibles (texte hors forme, lecture ratée, projet hors git) : la ligne ambre, les
 * cinq cases décochées. Rien sans relevé.
 */
const autonomyRows = (a: CooAutonomy | undefined): CooRow[] => {
  if (!a) return []
  return framed([
    { key: 'coo-autonomy', kind: 'heading', parts: [{ text: 'Autonomie du mode auto', bold: true }] },
    { key: 'coo-autonomy-why', kind: 'line', parts: [{ text: 'Case cochée : une mission en auto tranche seule, avec sa recommandation. Décochée : elle te pose la question.', dim: true }] },
    ...(a.state === 'unread' ? [{ key: 'coo-autonomy-unread', kind: 'line' as const, parts: [{ text: '⚠', color: C.amber, bold: true }, { text: 'Cases illisibles : toutes décochées.', color: C.amber }] }] : []),
    ...AUTONOMY_CASES.flatMap((c): CooRow[] => {
      const isOn = a.cases[c.id]
      const row: CooRow = {
        key: `coo-autonomy-${c.id}`,
        kind: 'line',
        parts: [{ text: c.label }],
        actions: [{ key: `coo-autonomy-tick-${c.id}`, label: isOn ? '☑' : '☐', act: isOn ? { kind: 'autonomy-off', case: c.id } : { kind: 'autonomy-ask', case: c.id }, isPlain: true }],
      }
      if (isOn || a.asking !== c.id) return [row]
      return [
        row,
        {
          key: `coo-autonomy-ask-${c.id}`,
          kind: 'line',
          parts: [{ text: `Cocher « ${c.label} » ? Les missions en auto de ce projet trancheront seules.` }],
          actions: [
            { key: `coo-autonomy-confirm-${c.id}`, label: 'Confirmer', act: { kind: 'autonomy-confirm', case: c.id }, isPrimary: true },
            { key: 'coo-autonomy-cancel', label: 'Annuler', act: { kind: 'autonomy-cancel' } },
          ],
        },
      ]
    }),
    { key: 'coo-autonomy-always', kind: 'line', parts: [{ text: 'Toujours posées : suppression sans retour ou exposition, faille laissée sans correctif, chemin Fable, invariant affaibli.', dim: true }] },
  ], settingFrame('autonomy'))
}

/**
 * La bascule de la revue de sécurité du projet, dans la vue du COO : son état relu à l'instant (une lecture
 * ratée se montre « activée », avec une ligne ambre) ; un clic pose l'état inverse de celui qu'elle montre. Dans un
 * rectangle gris, ambre quand l'état ne se lit pas.
 */
const securitySettingRows = (review: SecurityReview): CooRow[] => framed([
  { key: 'coo-security', kind: 'heading', parts: [{ text: 'Revue de sécurité de ce projet', bold: true }] },
  {
    key: 'coo-security-line',
    kind: 'line',
    parts: review === 'unread' ? [{ text: '⚠', color: C.amber, bold: true }, { text: SECURITY_UNREAD_FR, color: C.amber }] : [{ text: 'Gardée sur ce poste, pour tout le dépôt (worktrees des workers compris).', dim: true }],
    actions: [{ key: 'coo-security-toggle', label: securityToggleLabel(review), act: { kind: 'security', to: securityToggleTarget(review) } }],
  },
], review === 'unread' ? { id: 'security', color: C.amber } : settingFrame('security'))

/** L'identité d'une question à l'écran : sa mission, son id et l'empreinte de son texte, jamais la place de sa ligne. */
export const waitKey = (w: Pick<CooWait, 'missionId' | 'id' | 'print'>): string => `${neutralLine(w.missionId)}-${neutralLine(w.id)}-${w.print}`

/** Les boutons d'une question bloquante : ceux de son geste, faits d'un clic sur le texte affiché ; sinon « ✎ Répondre ». */
const waitActions = (w: CooWait): CooAction[] => {
  // La clé suit la question (sa mission et l'empreinte de son texte), jamais la place de la ligne : un nouveau rendu ne
  // met pas le geste d'une autre question sous le bouton que la personne a sous le pointeur.
  const id = waitKey(w)
  const gesture = (answer: 'yes' | 'no', label: string): CooAction => ({ key: `coo-gesture-${answer}-${id}`, label, act: { kind: 'gesture', mission: w.missionId, question: w.id, print: w.print, answer } })
  if (w.gesture?.kind === 'flaw') return [gesture('yes', `Laisser${NB}sans${NB}correctif`), gesture('no', `⛨${NB}Faire${NB}corriger`)]
  if (w.gesture) return [gesture('yes', `✓${NB}Autoriser`), gesture('no', `✗${NB}Refuser`)]
  return [{ key: `coo-answer-${id}`, label: `✎${NB}Répondre`, act: { kind: 'answer-fill', mission: w.missionId, question: w.id, print: w.print }, isPrimary: true }]
}

/**
 * Le rapport d'une mission à valider : « ▸ Lire » l'ouvre en entier ; ouvert, « ✓ Valider » (sur la version
 * affichée, seulement quand la mission est ouverte dans une discussion) et « ✎ À reprendre ».
 */
const reportRows = (s: CooStatement, r: CooReport): CooRow[] => {
  // L'identité de la ligne : sa mission, jamais sa place (un rapport qui arrive ne décale pas les boutons sous le pointeur).
  const i = neutralLine(r.missionId)
  const state: CooPart[] =
    !r.isMissionOpen
      ? [{ text: REPORT_PAUSED, color: C.amber, bold: true }]
      : r.state === 'validating'
        ? [{ text: `◷${NB}validation en cours d’application`, color: C.amber, bold: true }]
        : r.state === 'changed' || r.state === 'stale'
          ? [{ text: REPORT_CHANGED, color: C.amber, bold: true }]
          : []
  const rows: CooRow[] = [
    {
      key: `coo-report-${i}`,
      kind: 'line',
      parts: [{ text: '▤', color: C.amber, bold: true }, { text: `Rapport de ${named(s, r.missionId, r.mission)} à valider` }, ...state],
      actions: [{ key: `coo-report-read-${i}`, label: r.state === 'stale' ? `↻${NB}Relire` : r.isOpen ? `▾${NB}Replier` : `▸${NB}Lire`, act: { kind: 'report-read', mission: r.missionId, print: r.print } }],
    },
  ]
  if (!r.isOpen) return rows
  // Le rapport en entier, une ligne par ligne du texte : la personne valide ce qu'elle a lu.
  for (const [j, text] of r.text.split(/\r?\n/).entries()) rows.push({ key: `coo-report-${i}-line-${j}`, kind: 'line', parts: [{ text: text === '' ? NB : neutralLine(text) }], isPart: true })
  // Jamais sur une version que la personne n'a pas ouverte (`stale` : changée depuis l'ouverture).
  const canValidate = r.isMissionOpen && r.state !== 'validating' && r.state !== 'stale'
  rows.push({
    key: `coo-report-${i}-acts`,
    kind: 'line',
    parts: [{ text: `fin du rapport de ${named(s, r.missionId, r.mission)}`, dim: true }],
    isPart: true,
    actions: [
      ...(canValidate ? [{ key: `coo-report-validate-${i}`, label: `✓${NB}Valider`, act: { kind: 'report-validate' as const, mission: r.missionId, print: r.print }, isPrimary: true as const }] : []),
      { key: `coo-report-redo-${i}`, label: `✎${NB}À${NB}reprendre`, act: { kind: 'report-redo', mission: r.missionId } },
    ],
  })
  return rows
}

/** Des titres de missions entre guillemets, neutralisés, séparés par des virgules. */
const quotedTitles = (titles: readonly string[]): string => titles.map(t => `« ${neutralLine(t)} »`).join(', ')

/**
 * La carte de livraison : avant le clic, ce qui partira (commits par mission, « hors mission » sinon) et les
 * missions à attendre ; puis les étapes et leur état, avec le seul bouton que l'état permet.
 */
const deliveryRows = (d: CooDelivery): CooRow[] => {
  const head: CooPart[] = [{ text: '⬆', color: C.sky, bold: true }, { text: `Livraison de ${d.missions.map(m => `« ${neutralLine(m)} »`).join(', ')}` }]
  if (d.state === 'unread') return [{ key: 'coo-delivery', kind: 'line', parts: [{ text: '⚠', color: C.amber, bold: true }, { text: 'L’état de la livraison ne se lit pas : rien ne part.' }] }]
  if (d.state === 'ready') {
    const rows: CooRow[] = [{ key: 'coo-delivery', kind: 'line', parts: [...head, { text: 'prête', dim: true }], actions: [{ key: 'coo-deliver', label: `▶${NB}Livrer`, act: { kind: 'deliver', key: d.key ?? '' }, isPrimary: true }] }]
    for (const [i, c] of d.commits.entries())
      rows.push({ key: `coo-delivery-commits-${i}`, kind: 'line', parts: [{ text: '·', dim: true }, { text: `${c.mission === null ? 'hors mission' : `« ${neutralLine(c.mission)} »`} : ${c.lines.length} commit${c.lines.length > 1 ? 's' : ''}`, dim: true }, { text: c.lines.slice(0, 3).map(l => neutralLine(l)).join(' · '), dim: true }], isPart: true })
    if (d.more !== undefined && d.more > 0) rows.push({ key: 'coo-delivery-more', kind: 'line', parts: [{ text: '·', dim: true }, { text: `et ${d.more} commit${d.more > 1 ? 's' : ''} de plus`, dim: true }], isPart: true })
    const waits = [
      ...(d.waitFor.length > 0 ? [`${quotedTitles(d.waitFor)} pas finie${d.waitFor.length > 1 ? 's' : ''}, avec des groupes déjà fusionnés`] : []),
      ...(d.waitCommits.length > 0 ? [`${quotedTitles(d.waitCommits)} pas finie${d.waitCommits.length > 1 ? 's' : ''}, des commits partent`] : []),
    ]
    if (waits.length > 0)
      rows.push({ key: 'coo-delivery-wait', kind: 'line', parts: [{ text: '⚠', color: C.amber, bold: true }, { text: `Mieux vaut attendre : ${waits.join(' ; ')}.`, color: C.amber }], isPart: true })
    return rows
  }
  const GLYPH = { todo: '○', running: '◷', done: '✓', failed: '✗' } as const
  // Le rangement : « ✕ Finir sans ranger » toujours, « ▶ Reprendre à rangement » quand il n'est pas armé ici, jamais « ↻ Demander l’issue ».
  const finish: CooAction = { key: 'coo-deliver-finish', label: `✕${NB}Finir${NB}sans${NB}ranger`, act: { kind: 'deliver-finish' } }
  const action: CooAction[] = d.isTidy
    ? d.state === 'failed'
      ? [{ key: 'coo-deliver-retry', label: `↻${NB}Réessayer`, act: { kind: 'deliver-step', gesture: 'retry' } }, finish]
      : d.isArmed
        ? [finish]
        : [{ key: 'coo-deliver-resume', label: `▶${NB}Reprendre${NB}à${NB}rangement`, act: { kind: 'deliver-step', gesture: 'resume' } }, finish]
    : d.state === 'failed'
      ? [{ key: 'coo-deliver-retry', label: `↻${NB}Réessayer`, act: { kind: 'deliver-step', gesture: 'retry' } }, { key: 'coo-deliver-drop', label: `✕${NB}Abandonner`, act: { kind: 'deliver-drop' } }]
      : d.state === 'paused' && !d.isArmed
        ? [{ key: 'coo-deliver-resume', label: `▶${NB}Reprendre${d.step ? ` à ${d.step}` : ''}`, act: { kind: 'deliver-step', gesture: 'resume' } }]
        : d.state === 'running'
          ? [{ key: 'coo-deliver-check', label: `↻${NB}Demander${NB}l’issue`, act: { kind: 'deliver-step', gesture: 'check' } }]
          : []
  const state = d.state === 'failed' ? `arrêtée à ${d.step ?? '?'}` : d.state === 'running' ? `${d.step ?? ''} en cours` : d.isArmed ? `${d.step ?? ''} part ensuite` : `à reprendre à ${d.step ?? '?'}`
  return [
    { key: 'coo-delivery', kind: 'line', parts: [...head, { text: state, color: d.state === 'failed' ? C.amber : C.sky, bold: true }], ...(action.length > 0 ? { actions: action } : {}) },
    ...(d.steps ?? []).map((s, i) => ({ key: `coo-delivery-step-${i}`, kind: 'line' as const, parts: [{ text: GLYPH[s.status], ...(s.status === 'failed' ? { color: C.amber } : {}) }, { text: s.label }, ...(s.detail ? [{ text: neutralLine(s.detail), dim: true }] : [])], isPart: true as const })),
  ]
}

const unitText = (key: string): string => (key === '*' ? 'le lot' : `groupe${NB}${key}`)

const MODE_FR: Record<LaunchMode, string> = { auto: 'auto', manual: 'manuel' }

/**
 * La prochaine vague du projet, avec « ⇉ Lancer la vague » (pas pendant qu'une vague se lance), et les groupes
 * d'une vague lancée qui ne sont pas partis ou que le plan retient.
 */
const waveRows = (s: CooStatement): CooRow[] => {
  const w = s.wave
  if (!w || (w.next.length === 0 && !w.report.some(r => r.state === 'missed' || r.state === 'held'))) return []
  const rows: CooRow[] = [{ key: 'coo-wave', kind: 'heading', parts: [{ text: 'Prochaine vague du projet', bold: true }] }]
  if (w.next.length > 0)
    rows.push({
      key: 'coo-wave-next',
      kind: 'line',
      parts: [{ text: '⇉', color: C.cyan, bold: true }, { text: w.next.map(m => `${named(s, m.id, m.title)} : ${m.groups.map(g => neutralLine(g).slice(0, 12)).join(', ')}`).join(' · ') }, ...(w.isLaunching ? [{ text: `◷${NB}lancement en cours`, color: C.amber, bold: true }] : [])],
      ...(w.isLaunching ? {} : { actions: [{ key: 'coo-wave-launch', label: `⇉${NB}Lancer${NB}la${NB}vague`, act: { kind: 'wave' as const, key: w.key } }] }),
    })
  for (const [i, r] of w.report.filter(x => x.state === 'missed').entries())
    rows.push({ key: `coo-wave-missed-${i}`, kind: 'line', parts: [{ text: '⚠', color: C.amber, bold: true }, { text: `groupe${NB}${neutralLine(r.group).slice(0, 12)} de « ${neutralLine(r.mission)} » n’est pas parti : reprends la mission pour le lancer` }] })
  for (const [i, r] of w.report.filter(x => x.state === 'held').entries())
    rows.push({ key: `coo-wave-held-${i}`, kind: 'line', parts: [{ text: '⏸', color: C.amber, bold: true }, { text: `groupe${NB}${neutralLine(r.group).slice(0, 12)} de « ${neutralLine(r.mission)} » retenu par le plan ou un fichier en commun : il partira à son tour` }] })
  return rows
}

/**
 * Le plan des vagues du projet : vague par vague, chaque mission et ses groupes, puis la livraison unique
 * après la dernière vague ; un plan qui change l'ordre validé se propose avec « ✓ Valider le plan ».
 */
const planRows = (s: CooStatement): CooRow[] => {
  const p = s.plan
  if (!p) return []
  if (p.unread) return [{ key: 'coo-plan', kind: 'heading', parts: [{ text: `⚠${NB}Plan du projet illisible : aucun départ, retenues gardées`, color: C.amber, bold: true }] }]
  if (p.computed.waves.length < 2 && p.isValidated) return []
  const rows: CooRow[] = [
    {
      key: 'coo-plan',
      kind: 'heading',
      parts: [{ text: p.isValidated ? `Plan du projet · ${p.computed.waves.length} vagues` : `Plan du projet proposé · ${p.computed.waves.length} vagues`, bold: true, ...(p.isValidated ? {} : { color: C.amber }) }],
    },
    ...(p.isValidated
      ? []
      : [{ key: 'coo-plan-ask', kind: 'line' as const, parts: [{ text: 'Il change l’ordre des départs : validé, les missions le suivent (en auto, d’office).', dim: true }], actions: [{ key: 'coo-plan-validate', label: `✓${NB}Valider${NB}le${NB}plan`, act: { kind: 'plan-validate' as const, key: p.key } }] }]),
  ]
  for (const [i, w] of p.computed.waves.entries()) {
    rows.push({ key: `coo-plan-wave-${i}`, kind: 'line', parts: [{ text: `Vague${NB}${i + 1}`, color: C.cyan, bold: true }, { text: waveText(w, (t, run) => named(s, run, t)) }] })
  }
  // Une seule livraison, après la dernière vague, pour toutes les missions du plan.
  const delivery = p.computed.delivery
  if (delivery.length > 0)
    rows.push({ key: 'coo-plan-delivery', kind: 'line', parts: [{ text: '→', dim: true }, { text: `une livraison : ${delivery.map(d => named(s, d.run, d.title)).join(', ')}`, dim: true }] })
  return rows
}

/** Les deux lancements d'une carte, le mode recommandé en tête, coloré ; jamais en auto une carte en xhigh. */
const launchButtons = (c: CooCard): CooAction[] => {
  const button = (mode: LaunchMode): CooAction => ({ key: `coo-card-${mode}-${c.id}`, label: `▶${NB}Lancer${NB}en${NB}${MODE_FR[mode]}`, act: { kind: 'launch', card: c.id, mode, at: c.at }, ...(mode === c.mode ? { isPrimary: true as const } : {}) })
  const modes: LaunchMode[] = c.effort === 'xhigh' ? ['manual'] : c.mode === 'auto' ? ['auto', 'manual'] : ['manual', 'auto']
  return modes.map(button)
}

/**
 * Les cartes de lancement, dans l'ordre de `cardsInOrder` (une carte rangée porte sa place devant son numéro), chacune dans
 * un rectangle vert d'eau : son titre, son départ (une carte de rétro : « · recommandée » ou « · facultative » à côté), puis son objectif replié sur trois lignes au plus, les entrées qu'elle
 * couvre et le quota, puis ses boutons au bas du rectangle (une carte d'avant, sans objectif, montre son titre et ses boutons seuls) ; ni
 * les raisons (ask-matt, mode, effort), ni l'effort, ni le dossier, qui restent gardés dans la carte ; un clic lance (une carte ne lance qu'une fois : « lancement en cours », puis elle n'est plus
 * montrée) ; les autres départs se choisissent avant le clic. Une carte dont la mission est lancée n'est plus montrée ni
 * comptée : elle reste gardée dans la liste des cartes du projet (aucun plafond ne la retire), et le relevé du COO
 * la donne tant qu'une entrée de la feuille de route qu'elle cite reste à passer, ou que la feuille ne se lit pas
 * (`isLaunchedCardListed`, `coo.ts`). `quota` : celui de la
 * discussion, sous une carte prête en xhigh (une limite atteinte arrêterait la mission en plein travail).
 */
const cardRows = (s: CooStatement): CooRow[] => {
  // La liste des cartes illisible : son alerte est plus haut sur la page, avec les autres fichiers illisibles ; ici, un renvoi.
  if (s.cardsUnread) return [{ key: 'coo-cards-unread-see', kind: 'line', parts: [{ text: `⚠${NB}Liste des cartes illisible : voir l’alerte du bloc « Projet », plus haut`, color: C.amber }] }]
  const { quota, delivered } = s
  const cards = shownCards(s)
  // La ligne « Au départ · n » paraît toujours (n = 0 compris), avec le bouton « ✦ Proposer les missions » : une consigne fixe au COO (`coo-asks.ts`).
  const rows: CooRow[] = [{ key: 'coo-cards', kind: 'heading', parts: [{ text: `Au départ · ${cards.length}`, bold: true }], actions: [{ key: 'coo-cards-propose', label: `✦${NB}Proposer${NB}les${NB}missions`, act: { kind: 'propose' } }] }]
  let place = 0
  for (const c of cards) {
    // Devant le numéro d'une carte rangée : sa place parmi les cartes rangées montrées (1, 2, 3, sans trou).
    const placed: CooPart[] = c.rank !== undefined ? [{ text: `${++place}${NB}·`, bold: true }] : []
    const def = SKILLS[c.start]
    const advice = retroAdviceOf(c)
    const state: CooPart[] = c.state.kind === 'launching' ? [{ text: `◷${NB}lancement en cours (${MODE_FR[c.state.mode]})`, color: C.amber, bold: true }] : []
    // Un rectangle vert d'eau par carte : son titre et son départ, son objectif, puis ses boutons, au bas du rectangle.
    const frame: CooFrame = { id: `card-${c.id}`, color: C.teal }
    rows.push({
      key: `coo-card-${c.id}`,
      kind: 'line',
      frame,
      isActsLast: true,
      parts: [
        { text: '▶', color: C.teal, bold: true },
        ...placed,
        ...tagPart(cardTag(s, c.id)),
        { text: neutralLine(c.title), bold: true },
        { text: def ? `${def.glyph}${NB}/${c.start}` : `/${c.start}`, ...(def?.color ? { color: def.color } : {}) },
        // Une carte de rétro dit si elle est recommandée ou facultative, à côté de son départ.
        ...(advice ? [{ text: `·${NB}${advice}`, ...(advice === 'recommandée' ? { color: C.teal } : { dim: true as const }) }] : []),
        ...state,
      ],
      ...(c.state.kind === 'ready'
        ? {
            actions: [
              ...launchButtons(c),
              ...c.alts.map(a => ({ key: `coo-card-alt-${c.id}-${a}`, label: `→${NB}/${a}`, act: { kind: 'card-start' as const, card: c.id, start: a } })),
              // La rétro d'une mission qui attend « ✓ Archiver » (livrée, ou close sans livraison) : il archive la mission, et sa carte part avec elle.
              ...(c.of && delivered?.list.some(d => d.id === c.of) ? [archiveAction(`coo-card-archive-${c.id}`, `✓${NB}Archiver`, [c.of], delivered.print)] : []),
              // Une carte de rétro dont la mission n'attend pas « ✓ Archiver » et n'a plus droit à sa carte, une carte « Pistes de rétro » ou une
              // carte ordinaire : « ✕ Retirer » retire la carte, sans rien écrire sur la mission ni sur la feuille de route. Une carte ordinaire
              // porte la date de la version montrée : un clic sur un dessin d'avant une carte reproposée ne retire pas la nouvelle.
              ...(c.isRemovable ? [{ key: `coo-card-remove-${c.id}`, label: `✕${NB}Retirer`, act: { kind: 'card-remove' as const, card: c.id, ...(isOrdinaryCard(c) ? { at: c.at } : {}) } }] : []),
            ],
          }
        : {}),
    })
    // L'objectif de la carte, en couleur ordinaire, replié sur trois lignes au plus ; une carte d'avant, sans objectif, n'a pas cette ligne.
    if (c.goal) rows.push({ key: `coo-card-goal-${c.id}`, kind: 'line', frame, parts: [{ text: neutralLine(c.goal) }], isPart: true, maxLines: 3 })
    // Les entrées de la feuille de route que la carte couvre (des ids en forme seulement), sous la carte prête ou en lancement.
    const covers = cardEntriesFr(c)
    if (covers) rows.push({ key: `coo-card-entries-${c.id}`, kind: 'line', frame, parts: [{ text: covers, dim: true }], isPart: true })
    if (quota && c.effort === 'xhigh' && c.state.kind === 'ready') rows.push({ key: `coo-card-quota-${c.id}`, kind: 'line', frame, parts: [{ text: `quota de la discussion${NB}·${NB}${quota}`, dim: true }], isPart: true })
  }
  return rows
}

/** Les cartes montrées sous « Au départ » (celles dont la mission n'est pas lancée), dans leur ordre, que compte la tuile « au départ ». */
const shownCards = (s: CooStatement): CooCard[] => cardsInOrder((s.cards ?? []).filter(c => c.state.kind !== 'launched'))

/**
 * Les cartes montrées sous « Au départ », dans l'ordre : les cartes rangées par rang croissant (deux rangs égaux, relus
 * d'une copie forgée : l'ordre de la liste les départage), puis les cartes sans rang dans l'ordre de la liste.
 */
export const cardsInOrder = <C extends { rank?: number }>(cards: readonly C[]): C[] => [
  ...cards.filter(c => c.rank !== undefined).sort((a, b) => a.rank! - b.rank!),
  ...cards.filter(c => c.rank === undefined),
]

/** Un bouton d'archivage : les ids montrés et l'empreinte de la liste affichée, que le clic compare au fichier relu. */
const archiveAction = (key: string, label: string, ids: string[], print: string): CooAction => ({ key, label, act: { kind: 'archive', ids, print } })

/**
 * Les missions qui attendent « ✓ Archiver », dans le bloc « Projet » : une ligne « « M » livrée » avec « ✓ Archiver »
 * pour chaque mission livrée sans carte de rétro prête (sa carte, sous « Au départ », porte le même bouton ; une
 * mission close sans livraison n'est comptée qu'avec sa carte prête), puis, dès deux missions (avec ou sans carte),
 * « ✓ Tout archiver (n) », n étant le nombre de ces boutons.
 */
const deliveredRows = (s: CooStatement): CooRow[] => {
  const d = s.delivered
  if (!d) return []
  const rows: CooRow[] = d.list
    .filter(x => x.card === undefined)
    .map(x => ({
      key: `coo-delivered-${neutralLine(x.id)}`,
      kind: 'line' as const,
      frame: { id: `delivered-${neutralLine(x.id)}`, color: C.green, chip: CHIP.delivered },
      parts: [{ text: '✓', color: C.green, bold: true }, { text: `${named(s, x.id, x.title)} livrée` }, { text: 'rétro ou archivage', dim: true }],
      actions: [archiveAction(`coo-archive-${x.id}`, `✓${NB}Archiver`, [x.id], d.print)],
    }))
  if (d.list.length >= 2)
    rows.push({
      key: 'coo-delivered-all',
      kind: 'line',
      frame: { id: 'delivered-all', color: C.green, chip: CHIP.delivered },
      // « closes » dès qu'une mission non livrée est comptée ; sinon la phrase d'une liste toute livrée.
      parts: [{ text: `${d.list.length} missions ${d.list.some(x => x.isClosed) ? 'closes' : 'livrées'} attendent leur rétro ou leur archivage`, dim: true }],
      actions: [archiveAction('coo-archive-all', `✓${NB}Tout${NB}archiver${NB}(${d.list.length})`, d.list.map(x => x.id), d.print)],
    })
  return rows
}

/**
 * Les pistes d'une rétro lancée par le COO : une case par piste (une piste prise ailleurs n'en a pas), « Tout
 * cocher », et « ✂ Découper la sélection », qui dit combien partent dans « À reprendre » (une rétro qui relit la
 * liste d'attente n'a pas cette section : ses pistes sont dans « Pistes en attente »). Chaque rétro dans son rectangle :
 * ambre tant qu'elle est à cocher, vert d'eau une fois sa sélection envoyée.
 */
const retroPickRows = (s: CooStatement): CooRow[] =>
  (s.retroPicks ?? []).flatMap(p => framed(retroPickOf(s, p), { id: `retro-${p.retro}`, color: p.isSent ? C.teal : C.amber }))

/** Les lignes d'une rétro à cocher (`retroPickRows`). */
const retroPickOf = (s: CooStatement, p: CooRetroPicks): CooRow[] => {
  if (p.isSent)
    return [{ key: `coo-retro-${p.retro}`, kind: 'line' as const, parts: [{ text: '✂', color: C.teal, bold: true }, { text: `Sélection des pistes de ${named(s, p.retro, p.title)} envoyée à la rétro : rien à cocher ici (une demande de découpage perdue se relance depuis le panneau de la rétro, « ✂ Découper »).` }] }]
  const ticked = p.items.filter(i => i.isTicked).length
  const left = p.items.length - ticked
  return [
    {
      key: `coo-retro-${p.retro}`,
      kind: 'line' as const,
      parts: [{ text: '◷', color: C.amber, bold: true }, { text: `Pistes de la rétro ${named(s, p.retro, p.title)} · ${p.items.length}`, bold: true }],
      actions: [
        ...(ticked < p.items.length ? [{ key: `coo-retro-all-${p.retro}`, label: `☑${NB}Tout${NB}cocher`, act: { kind: 'retro-tick-all' as const, retro: p.retro } }] : []),
        { key: `coo-retro-pick-${p.retro}`, label: `✂${NB}Découper${NB}la${NB}sélection${NB}(${ticked}${NB}cochée${ticked > 1 ? 's' : ''},${NB}${left}${NB}vers${NB}À${NB}reprendre)`, act: { kind: 'retro-pick' as const, retro: p.retro, print: p.print }, isPrimary: true as const },
      ],
    },
    ...p.items.map(i => ({
      key: `coo-retro-${p.retro}-${i.id}`,
      kind: 'line' as const,
      parts: [{ text: `${i.id}.`, dim: true }, { text: neutralLine(i.label) }],
      actions: [{ key: `coo-retro-tick-${p.retro}-${i.id}`, label: i.isTicked ? '☑' : '☐', act: { kind: 'retro-tick' as const, retro: p.retro, item: i.id }, isPlain: true as const }],
    })),
    ...p.taken.map(i => ({
      key: `coo-retro-${p.retro}-${i.id}-taken`,
      kind: 'line' as const,
      parts: [{ text: `${i.id}.`, dim: true }, { text: neutralLine(i.label), dim: true }, { text: `déjà prise par ${neutralLine(i.by)}`, color: C.amber }],
    })),
  ]
}

/**
 * La section « Pistes en attente », commune à toutes les rétros qui relisent la liste : ses seules pistes « pas encore
 * validée », rangées par fichier (une ligne de fichier avant chaque rang), chacune avec sa case, son état, sa rétro, ses
 * fichiers, sa carte et son dernier commentaire ; « ☑ Tout cocher » en tête tant qu'une case montrée est vide ; une
 * ligne compte les pistes validées, en ticket ou en exécution, pas montrées ; « ✂ Découper la sélection » en bas. Chaque
 * fichier, sa ligne et ses pistes, dans un rectangle vert d'eau ; les lignes de compte et le découpage sous eux.
 */
const pistesWaitingRows = (s: CooStatement): CooRow[] => {
  const w = s.pistesWaiting
  if (!w) return []
  const rows: CooRow[] = [{ key: 'coo-pistes', kind: 'heading', parts: [{ text: `Pistes en attente · ${w.rows.length + w.more}`, bold: true }] }]
  const unticked = w.rows.filter(r => r.isTickable && !r.isTicked)
  if (unticked.length > 0)
    rows.push({
      key: 'coo-pistes-all',
      kind: 'line',
      parts: [],
      isPart: true,
      actions: [{ key: 'coo-pistes-all-go', label: `☑${NB}Tout${NB}cocher`, act: { kind: 'pistes-tick-all' as const, pistes: unticked.map(r => r.id) } }],
    })
  let file: string | null = null
  let box: CooFrame = { id: 'pistes-file', color: C.teal }
  for (const r of w.rows) {
    if (r.file !== file) {
      file = r.file
      box = { id: `pistes-file-${r.id}`, color: C.teal }
      rows.push({ key: `coo-pistes-file-${r.id}`, kind: 'line', frame: box, parts: [{ text: r.file === '' ? 'sans fichier' : neutralLine(r.file), dim: true, bold: true }] })
    }
    const extra = [
      `rétro « ${neutralLine(r.retro)} »`,
      ...(r.files.some(f => f !== r.file) ? [`fichiers : ${r.files.map(f => neutralLine(f)).join(', ')}`] : []),
      ...(r.card !== undefined ? [`carte « ${neutralLine(r.card)} »`] : []),
      ...(r.last !== undefined ? [`dernier commentaire : ${neutralLine(r.last.length > 120 ? `${r.last.slice(0, 119)}…` : r.last)}`] : []),
    ].join(' · ')
    rows.push({
      key: `coo-piste-${r.id}`,
      kind: 'line',
      frame: box,
      parts: [
        { text: `${neutralLine(r.id)}`, dim: true },
        { text: neutralLine(r.text.length > 160 ? `${r.text.slice(0, 159)}…` : r.text) },
        { text: neutralLine(r.stateText), color: r.state === 'pending' ? C.amber : C.teal },
        { text: extra, dim: true },
      ],
      ...(r.isTickable ? { actions: [{ key: `coo-piste-tick-${r.id}`, label: r.isTicked ? '☑' : '☐', act: { kind: 'piste-tick' as const, piste: r.id }, isPlain: true as const }] } : {}),
    })
  }
  if (w.more > 0) rows.push({ key: 'coo-pistes-more', kind: 'line', parts: [{ text: `${w.more} autre(s) piste(s) ouverte(s), pas montrée(s) ici.`, dim: true }] })
  const hidden = w.hidden ?? 0
  if (hidden > 0)
    rows.push({ key: 'coo-pistes-hidden', kind: 'line', parts: [{ text: hidden > 1 ? `${hidden} pistes validées ou en ticket, pas montrées` : '1 piste validée ou en ticket, pas montrée', dim: true }] })
  if (w.closed > 0) rows.push({ key: 'coo-pistes-closed', kind: 'line', parts: [{ text: `${w.closed} piste(s) faite(s) ou écartée(s), pas montrée(s).`, dim: true }] })
  if (w.rows.some(r => r.isTickable))
    rows.push({
      key: 'coo-pistes-cut',
      kind: 'line',
      parts: [{ text: `${w.ticked} cochée${w.ticked > 1 ? 's' : ''}`, dim: true }],
      actions: [{ key: 'coo-pistes-cut-go', label: `✂${NB}Découper${NB}la${NB}sélection`, act: { kind: 'pistes-cut' as const, print: w.print }, isPrimary: true }],
    })
  return rows
}

/**
 * Où garder la liste d'attente des rétros : la question et ses deux boutons, tant que la personne n'a pas choisi
 * et que la liste existe, sur ce poste ou déjà commitée dans le projet (rien à commiter avant) ; propre à la liste.
 */
const pistesWhereRows = (s: CooStatement): CooRow[] => {
  const w = s.waitlist
  if (!w || w.where !== 'unasked' || (w.state !== 'read' && w.state !== 'missing' && !w.committed)) return []
  return framed([
    { key: 'coo-pistes-where', kind: 'heading', parts: [{ text: 'Liste d’attente des rétros : la commiter dans ce projet ?', color: C.amber, bold: true }] },
    {
      key: 'coo-pistes-where-ask',
      kind: 'line',
      parts: [{ text: 'Dans un dépôt public, les pistes seraient publiées. En attendant ton choix, elle reste sur ce poste.', dim: true }],
      actions: [
        { key: 'coo-pistes-where-repo', label: `Commiter${NB}dans${NB}travail/`, act: { kind: 'pistes-where', where: 'repo' } },
        { key: 'coo-pistes-where-poste', label: `Garder${NB}sur${NB}le${NB}poste`, act: { kind: 'pistes-where', where: 'poste' } },
      ],
    },
  ], { id: 'where-pistes', color: C.amber, chip: CHIP.where })
}

/** Les décisions opposées entre missions (question posée à celle qui a décidé en second) et les sujets compatibles. */
const oppositionRows = (s: CooStatement): CooRow[] => [
  ...(s.decisions?.contradictions ?? []).map((c, i) => ({
    key: `coo-opposed-${i}`,
    kind: 'line' as const,
    frame: alertFrame(`opposed-${i}`),
    parts: [
      { text: '⚠', color: C.amber, bold: true },
      { text: `Décisions opposées sur ${neutralLine(c.subject)} : ${named(s, c.missionId, c.mission)} et « ${neutralLine(c.other)} »` },
      { text: c.isOpen ? `question posée à ${named(s, c.missionId, c.mission)}` : `la question attend que ${named(s, c.missionId, c.mission)} soit reprise`, dim: true },
      ...(c.isOtherArchived ? [{ text: `« ${neutralLine(c.other)} » archivée depuis : la question reste posée`, color: C.amber }] : []),
    ],
  })),
  ...(s.decisions?.compatibles ?? []).map((c, i) => ({
    key: `coo-compatible-${i}`,
    kind: 'line' as const,
    parts: [{ text: '≈', dim: true }, { text: `« ${neutralLine(c.a)} » et « ${neutralLine(c.b)} » décident tous deux sur ${neutralLine(c.subject)}, compatibles`, dim: true }],
  })),
]

/**
 * Qui attend qui entre les missions (celles d'une mission qui attend : dans son couloir ; sinon dans le bloc « Projet »), avec « ⇥ Forcer » par paire : les « à forcer » d'abord
 * (la marque en ambre, le temps depuis la fin du worker, « ⇥ Forcer » principal), puis les grises (atténuées, bouton
 * encadré sans couleur) ; dans chaque rang, par mission qui attend (l'ordre du relevé).
 */
const holdRows = (s: CooStatement, holds: readonly CooStatement['holds'][number][]): CooRow[] =>
  [...holds.filter(h => h.isToForce), ...holds.filter(h => !h.isToForce)].map(h => {
    // La clé nomme la paire, pas sa place : une marque qui change l'ordre ne met jamais un autre « ⇥ Forcer » sous le pointeur.
    const pair = [h.missionId, h.held, h.run, h.group, h.on].join('~')
    const what = `${unitText(h.held)} de ${named(s, h.missionId, h.mission)} attend ${unitText(h.group)} de ${named(s, h.run, h.title)}`
    const why = h.on === 'plan' ? '(plan du projet)' : `(${h.on === 'file' ? 'fichier commun' : 'ressource commune'} : ${neutralLine(h.shared)})`
    return {
      key: `coo-hold-${pair}`,
      kind: 'line' as const,
      // Une retenue « à forcer » est un rectangle ambre ; une grise, une ligne grise sans rectangle.
      ...(h.isToForce ? { frame: { id: `hold-${pair}`, color: C.amber, chip: CHIP.toForce } } : {}),
      parts: h.isToForce
        ? [{ text: `à${NB}forcer`, color: C.amber, bold: true }, { text: what }, { text: why, dim: true }, ...(h.deadSince !== undefined ? [{ text: `son worker a fini depuis ${Math.max(0, Math.floor((s.at - h.deadSince) / 60_000))} min` }] : [])]
        : [{ text: '⏸', dim: true }, { text: what, dim: true }, { text: why, dim: true }],
      actions: [{ key: `coo-force-${pair}`, label: `⇥${NB}Forcer`, act: { kind: 'force' as const, mission: h.missionId, held: h.held, run: h.run, group: h.group, ...(h.on === 'plan' ? { on: 'plan' as const } : {}) }, ...(h.isToForce ? { isPrimary: true as const } : {}) }],
    }
  })

/** Deux départs croisés à signaler, parmi les alertes du bloc « Projet ». */
const crossedRows = (s: CooStatement): CooRow[] =>
  s.crossed.map((c, i) => ({
    key: `coo-crossed-${i}`,
    kind: 'line' as const,
    frame: alertFrame(`crossed-${i}`),
    parts: [
      { text: '⚠', color: C.amber, bold: true },
      { text: `Lancés ensemble : ${unitText(c.a.group)} de ${named(s, c.a.run, c.a.title)} et ${unitText(c.b.group)} de ${named(s, c.b.run, c.b.title)}` },
      { text: `(${neutralLine(c.shared)} en commun)`, dim: true },
    ],
  }))

/** Les commits hors mission sur les fichiers d'un groupe en cours : une ligne par groupe, sans bouton ni notification. */
const outsideRows = (s: CooStatement): CooRow[] =>
  (s.outside ?? []).map(o => ({
    key: `coo-outside-${o.missionId}-${o.group}`,
    kind: 'line' as const,
    frame: alertFrame(`outside-${o.missionId}-${o.group}`),
    parts: [
      { text: '⚠', color: C.amber, bold: true },
      { text: `main a reçu ${o.count} commit(s) hors mission sur des fichiers du groupe ${shownGroupId(o.group)} de ${named(s, o.missionId, o.mission)}` },
    ],
  }))

/**
 * La liste des cartes illisible (décisions C3, L1), dans les alertes de « Vue d'ensemble » comme la feuille de route : aucune
 * carte, la ligne d'alerte suivie de l'endroit de la liste et de sa copie gardée ; aucun bouton (la personne répare ou
 * renomme le fichier à la main).
 */
const cardsUnreadRows = (u: NonNullable<CooStatement['cardsUnread']>): CooRow[] => framed([
  { key: 'coo-cards-unread', kind: 'heading', parts: [{ text: `⚠${NB}Liste des cartes illisible : aucune carte n’est montrée, rien ne s’y écrit`, color: C.amber, bold: true }] },
  { key: 'coo-cards-unread-path', kind: 'line', parts: [{ text: `Fichier : ${neutralLine(u.path)}`, dim: true }] },
  { key: 'coo-cards-unread-aside', kind: 'line', parts: [{ text: u.aside ? `Copie gardée : ${neutralLine(u.aside)}` : u.noCopy === 'read' ? 'Aucune copie gardée : la lecture a raté' : u.noCopy === 'write' ? 'Aucune copie gardée : son écriture a raté (réessayée à chaque relevé)' : 'Copie gardée au prochain relevé', dim: true }] },
], alertFrame('cards'))

/** Le fichier de coordination illisible : rien ne s'y écrit ; la personne seule repart d'un fichier neuf, la copie gardée. */
const coordinationFileRows = (s: CooStatement): CooRow[] =>
  s.coordination?.state !== 'unread'
    ? []
    : framed([
        { key: 'coo-coord', kind: 'heading', parts: [{ text: 'Coordination', bold: true }] },
        {
          key: 'coo-coord-unread',
          kind: 'line',
          parts: [
            { text: '⚠', color: C.amber, bold: true },
            { text: 'Fichier de coordination illisible : rien ne s’y écrit.' },
            ...(s.coordination.aside ? [{ text: `Copie gardée : ${neutralLine(s.coordination.aside)}`, dim: true }] : []),
          ],
          actions: [{ key: 'coo-coord-fresh', label: 'Repartir d’un fichier neuf', act: { kind: 'coord-fresh' } }],
        },
      ], alertFrame('coord'))

/** La table des numéros hors forme : aucun numéro n'est montré ; la personne seule repart d'une table neuve, l'ancienne copiée à côté. */
const numbersRows = (s: CooStatement): CooRow[] =>
  s.numbers?.state !== 'bad'
    ? []
    : [
        {
          key: 'coo-numbers-bad',
          kind: 'line',
          frame: alertFrame('numbers'),
          parts: [
            { text: '⚠', color: C.amber, bold: true },
            { text: 'Table des numéros illisible : aucun numéro n’est montré' },
          ],
          actions: [{ key: 'coo-numbers-fresh', label: 'Repartir d’une table neuve', act: { kind: 'numbers-fresh' } }],
        },
      ]

const entryParts = (glyph: string, color: string | undefined, id: string, text: string, status?: string): CooPart[] => [
  { text: glyph, ...(color ? { color } : {}), bold: true },
  { text: neutralLine(text) },
  { text: `${neutralLine(id)}${status ? ` · ${neutralLine(status)}` : ''}`, dim: true },
]

/** Une ligne par copie mise de côté de l'état gardé (B8), comme la copie gardée du fichier de coordination : la personne la recopie avec le COO. */
const roadmapAsideRows = (r: CooRoadmap): CooRow[] =>
  (r.asides ?? []).map((p, i) => ({
    key: `coo-roadmap-aside-${i}`,
    kind: 'line' as const,
    frame: alertFrame(`roadmap-aside-${i}`),
    parts: [
      { text: '⚠', color: C.amber, bold: true },
      { text: `État de la feuille de route mis de côté : ${neutralLine(p)}` },
    ],
  }))

/**
 * Les alertes de la feuille de route, sur la page « Vue d'ensemble » : copies mises de côté, feuille de route illisible, entrées
 * disparues, textes changés sous le même id, fichier hors format (avec « ↺ Réparer »).
 */
const roadmapAlertRows = (r: CooRoadmap): CooRow[] => {
  // Illisible (le fichier, ou ce que le mod en garde) : rien n'en est montré ni proposé, sauf ses copies mises de côté.
  if (r.read === 'unread') return [{ key: 'coo-roadmap', kind: 'heading', frame: alertFrame('roadmap'), parts: [{ text: `⚠${NB}Feuille de route illisible : rien n’en est montré`, color: C.amber, bold: true }] }, ...roadmapAsideRows(r)]
  const rows: CooRow[] = [...roadmapAsideRows(r)]
  // Chaque alerte de la feuille de route, son en-tête et ses lignes, dans un rectangle rouge.
  const gone = alertFrame('gone', C.red)
  const goneTexts = alertFrame('gone-texts', C.red)
  const bad = alertFrame('roadmap', C.red)
  if (r.gone.length > 0) {
    const title = r.read === null ? `⚠${NB}Feuille de route absente · ${r.gone.length} entrées connues` : `⚠${NB}Entrées disparues de la feuille de route · ${r.gone.length}`
    rows.push({ key: 'coo-gone', kind: 'heading', frame: gone, parts: [{ text: title, color: C.red, bold: true }] })
    for (const g of r.gone) rows.push({ key: `coo-gone-${neutralLine(g.id)}`, kind: 'line', frame: gone, parts: [{ text: neutralLine(g.line), dim: true }], actions: [{ key: `coo-restore-${neutralLine(g.id)}`, label: `↺${NB}Remettre`, act: { kind: 'restore', id: g.id } }] })
  }
  // Un ancien texte d'une entrée, changé sous le même id, qui n'est plus nulle part : une disparition aussi ; on le remet sous un id neuf, jamais on ne le laisse partir.
  const texts = r.goneTexts ?? []
  if (texts.length > 0) {
    rows.push({ key: 'coo-gone-texts', kind: 'heading', frame: goneTexts, parts: [{ text: `⚠${NB}Textes changés sous le même id · ${texts.length}`, color: C.red, bold: true }] })
    for (const t of texts) {
      const key = `${neutralLine(t.id)}-${roadmapTextPrint(t.text)}`
      rows.push({ key: `coo-gone-text-${key}`, kind: 'line', frame: goneTexts, parts: [{ text: neutralLine(t.line), dim: true }, { text: `ancien texte de ${neutralLine(t.id)} · ${neutralLine(t.section)}`, dim: true }], actions: [{ key: `coo-restore-text-${key}`, label: `↺${NB}Remettre`, act: { kind: 'restore-text', id: t.id, print: roadmapTextPrint(t.text) } }] })
    }
  }
  if (r.read !== null && !r.read.ok) {
    rows.push({ key: 'coo-roadmap', kind: 'heading', frame: bad, parts: [{ text: `⚠${NB}Feuille de route hors format`, color: C.red, bold: true }] })
    rows.push({ key: 'coo-roadmap-bad', kind: 'line', frame: bad, parts: [{ text: `ligne ${r.read.lineNo} : ${neutralLine(r.read.why)} ; rien n’en est montré.`, dim: true }], actions: [{ key: 'coo-repair', label: `↺${NB}Réparer`, act: { kind: 'repair' } }] })
  }
  return rows
}

/** Ce que la page « Réglages » dit quand la feuille de route vit sur le poste et qu'un fichier reste dans `travail/` du projet. */
const ROADMAP_REPO_LEFT_FR = 'Le fichier reste dans travail/ et dans l’historique git : retire-le toi-même si tu veux.'

/**
 * L'endroit de la feuille de route, sur la page « Réglages » : où elle vit, et « Changer l'endroit », confirmé par un second
 * clic (« Confirmer », principal, et « Annuler ») ; avant le premier choix, une ligne qui renvoie à la question de « Vue d'ensemble ».
 * `isAsking` : la confirmation en attente, en mémoire de la discussion du COO. Feuille de route illisible : rien. Le tout
 * dans un rectangle gris, comme chaque réglage.
 */
const roadmapPlaceRows = (r: CooRoadmap | undefined, isAsking: boolean): CooRow[] => {
  if (!r || r.read === 'unread') return []
  const head: CooRow = { key: 'coo-place', kind: 'heading', parts: [{ text: 'Feuille de route', bold: true }] }
  if (r.where === 'unasked') return framed([head, { key: 'coo-place-unasked', kind: 'line', parts: [{ text: 'Endroit pas encore choisi : la question est sur la page « Vue d\'ensemble ».', dim: true }] }], settingFrame('place'))
  const other = r.where === 'repo' ? 'poste' : 'repo'
  const actions: CooAction[] = isAsking
    ? [
        { key: 'coo-place-confirm', label: 'Confirmer', act: { kind: 'where-confirm', where: other }, isPrimary: true },
        { key: 'coo-place-cancel', label: 'Annuler', act: { kind: 'where-cancel' } },
      ]
    : [{ key: 'coo-place-change', label: `Changer${NB}l’endroit`, act: { kind: 'where-ask' } }]
  return framed([
    head,
    { key: 'coo-place-line', kind: 'line', parts: [{ text: r.where === 'repo' ? 'Feuille de route : dans ce projet (travail/feuille-de-route.md)' : 'Feuille de route : sur ce poste' }], actions },
    ...(r.where === 'poste' && r.isRepoLeft ? [{ key: 'coo-place-left', kind: 'line' as const, parts: [{ text: ROADMAP_REPO_LEFT_FR, dim: true }] }] : []),
  ], settingFrame('place'))
}

/** Le premier choix de l'endroit de la feuille de route, sur la page « Vue d'ensemble » tant qu'il n'est pas fait (illisible : rien). */
const roadmapWhereRows = (r: CooRoadmap): CooRow[] =>
  r.read === 'unread' || r.where !== 'unasked'
    ? []
    : framed([
        { key: 'coo-where', kind: 'heading', parts: [{ text: 'Feuille de route : la commiter dans ce projet ?', color: C.amber, bold: true }] },
        {
          key: 'coo-where-ask',
          kind: 'line',
          parts: [{ text: 'Dans un dépôt public, tes idées seraient publiées. En attendant ton choix, elle reste sur ce poste.', dim: true }],
          actions: [
            { key: 'coo-where-repo', label: `Commiter${NB}dans${NB}travail/`, act: { kind: 'where', where: 'repo' } },
            { key: 'coo-where-poste', label: `Garder${NB}sur${NB}le${NB}poste`, act: { kind: 'where', where: 'poste' } },
          ],
        },
      ], { id: 'where-roadmap', color: C.amber, chip: CHIP.where })

/**
 * La page « Idées » : le jalon en cours et les prochaines étapes dans un rectangle vert d'eau « Feuille de route », puis
 * les idées, chacune dans son rectangle violet avec ses boutons et ses compléments (`complementRows`) ; rien d'une feuille
 * de route qui ne se lit pas.
 */
const roadmapIdeaRows = (r: CooRoadmap, shown: CooShown): CooRow[] => {
  const now = roadmapOpen(r)
  if (!now) return []
  const plan: CooRow[] = []
  // Une section vide ne se dessine pas.
  if (now.milestones.length + now.steps.length > 0) plan.push({ key: 'coo-roadmap', kind: 'heading', parts: [{ text: 'Feuille de route', bold: true }] })
  for (const m of now.milestones) plan.push({ key: `coo-milestone-${neutralLine(m.id)}`, kind: 'line', parts: entryParts('◆', C.teal, m.id, m.text, 'jalon en cours') })
  for (const e of now.steps) plan.push({ key: `coo-step-${neutralLine(e.id)}`, kind: 'line', parts: entryParts('→', C.blue, e.id, e.text, e.status) })
  const rows: CooRow[] = framed(plan, { id: 'roadmap', color: C.teal })
  if (now.ideas.length > 0) rows.push({ key: 'coo-ideas', kind: 'heading', parts: [{ text: `Idées · ${now.ideas.length}`, bold: true }] })
  for (const e of now.ideas) {
    const actions: CooAction[] = [
      ...(e.status === 'à lancer' ? [{ key: `coo-idea-launch-${neutralLine(e.id)}`, label: `▶${NB}Lancer`, act: { kind: 'idea-launch' as const, id: e.id }, isPrimary: true as const }] : []),
      ...(e.status === 'à lancer' ? [{ key: `coo-later-${neutralLine(e.id)}`, label: `Plus${NB}tard`, act: { kind: 'later' as const, id: e.id } }] : []),
      { key: `coo-drop-${neutralLine(e.id)}`, label: 'Écarter', act: { kind: 'drop', id: e.id } },
    ]
    const idea: CooRow = { key: `coo-idea-${neutralLine(e.id)}`, kind: 'line', parts: entryParts('✦', C.violet, e.id, e.text, e.status), actions }
    rows.push(...framed([idea, ...complementRows(r, e, shown)], { id: `idea-${neutralLine(e.id)}`, color: C.violet }))
  }
  return rows
}

/** Au plus, les entrées « À reprendre » décrites avant « ▸ tout voir ». */
const PENDING_SHOWN = 20
/** Au plus, les caractères du début du texte d'une entrée sur sa ligne repliée. */
const PENDING_HEAD = 80

/**
 * Ce que l'état d'affichage garde d'une entrée « À reprendre » dépliée : son id et son statut. Une entrée dont le statut
 * change (passée « plus tard », remise « à décider ») quitte sa liste et revient repliée.
 */
const pendingOpenKey = (e: RoadmapEntry): string => `${e.id} ${e.status}`

/** La date d'une entrée (`AAAA-MM-JJ`) en « JJ/MM », telle quelle si elle n'a pas cette forme. */
const shortDate = (date: string): string => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${m[2]}/${m[1]}` : date
}

/** Le numéro d'un id d'entrée (« R214 » : 214), pour ranger deux entrées du même jour. */
const idNumber = (id: string): number => Number(id.slice(1)) || 0

/** De la plus récente à la plus ancienne : la date, puis le numéro de l'id. */
const newestFirst = (a: RoadmapEntry, b: RoadmapEntry): number => b.date.localeCompare(a.date) || idNumber(b.id) - idNumber(a.id)

/**
 * Une entrée « À reprendre » : repliée, une ligne (la flèche « ▸ », son titre quand le COO en a écrit un pour son texte du
 * moment, sinon le début de son texte coupé à 80 caractères, l'id et la date) ; dépliée (« ▾ », une seule à la fois), en plus son texte complet, sa provenance, puis ses boutons d'aujourd'hui
 * (« Lancer » coloré, « Rattacher », « Plus tard » sauf à « plus tard », « Écarter » ; une entrée rattachée : « Plus tard »
 * et « Écarter » seulement). La flèche est un geste d'affichage.
 */
const pendingEntryRows = (e: RoadmapEntry, isOpen: boolean, titles: RoadmapTitles | undefined): CooRow[] => {
  const id = neutralLine(e.id)
  const head = entryHead(e, titles)
  const isAttached = e.status.startsWith('rattachée à ')
  const status = e.status === 'à décider' ? '' : ` · ${neutralLine(e.status)}`
  const line: CooRow = {
    key: `coo-pending-${id}`,
    kind: 'line',
    parts: [{ text: '↺', color: C.amber, bold: true }, { text: head }, { text: `${id}${status} · ${neutralLine(shortDate(e.date))}`, dim: true }],
    actions: [{ key: `coo-pending-open-${id}`, label: isOpen ? '▾' : '▸', act: { kind: 'show', open: isOpen ? null : pendingOpenKey(e) }, isPlain: true }],
  }
  if (!isOpen) return [line]
  const actions: CooAction[] = isAttached
    ? [
        { key: `coo-pending-later-${id}`, label: `Plus${NB}tard`, act: { kind: 'pending-later', id: e.id } },
        { key: `coo-pending-drop-${id}`, label: 'Écarter', act: { kind: 'pending-drop', id: e.id } },
      ]
    : [
        { key: `coo-pending-launch-${id}`, label: `▶${NB}Lancer`, act: { kind: 'pending-launch', id: e.id }, isPrimary: true },
        { key: `coo-pending-attach-${id}`, label: 'Rattacher', act: { kind: 'pending-attach', id: e.id } },
        ...(e.status !== 'plus tard' ? [{ key: `coo-pending-later-${id}`, label: `Plus${NB}tard`, act: { kind: 'pending-later' as const, id: e.id } }] : []),
        { key: `coo-pending-drop-${id}`, label: 'Écarter', act: { kind: 'pending-drop', id: e.id } },
      ]
  return [
    line,
    { key: `coo-pending-${id}-text`, kind: 'line', parts: [{ text: neutralLine(e.text), dim: true }], isPart: true },
    { key: `coo-pending-${id}-from`, kind: 'line', parts: [{ text: neutralLine(e.source), dim: true }], isPart: true, actions },
  ]
}

/** Le titre d'une entrée « À reprendre » écrit par le COO pour son texte du moment, sinon le début de son texte coupé à 80 caractères. */
const entryHead = (e: RoadmapEntry, titles: RoadmapTitles | undefined): string => {
  const title = titleOf(titles, e)
  return title !== undefined ? neutralLine(title) : e.text.length > PENDING_HEAD ? `${neutralLine(e.text.slice(0, PENDING_HEAD))}…` : neutralLine(e.text)
}

/**
 * Les compléments rangés avec une entrée (`complementsOf` : « complète <son id> », tant qu'elle est de celles que la vue
 * montre), juste sous elle, en retrait : « ↳ <id> · <titre> » (sans titre, le début du texte), sans bouton, dépliable au clic
 * comme une entrée (son texte et sa provenance). Ils suivent leur entrée partout où elle paraît et ne comptent jamais à part.
 */
const complementRows = (r: CooRoadmap, of: RoadmapEntry, shown: CooShown): CooRow[] => {
  const entries = r.read !== null && r.read !== 'unread' && r.read.ok ? r.read.entries : []
  return complementsOf(of.id, entries).flatMap(e => {
    const id = neutralLine(e.id)
    const isOpen = shown.open === pendingOpenKey(e)
    const line: CooRow = {
      key: `coo-complement-${id}`,
      kind: 'line',
      // La suite de son entrée : sans ligne vide entre elles.
      isPart: true,
      parts: [{ text: `${NB}${NB}↳`, dim: true }, { text: `${id} · ${entryHead(e, r.titles)}` }, { text: neutralLine(shortDate(e.date)), dim: true }],
      actions: [{ key: `coo-complement-open-${id}`, label: isOpen ? '▾' : '▸', act: { kind: 'show', open: isOpen ? null : pendingOpenKey(e) }, isPlain: true }],
    }
    if (!isOpen) return [line]
    return [
      line,
      { key: `coo-complement-${id}-text`, kind: 'line', parts: [{ text: neutralLine(e.text), dim: true }], isPart: true },
      { key: `coo-complement-${id}-from`, kind: 'line', parts: [{ text: neutralLine(e.source), dim: true }], isPart: true },
    ]
  })
}

/**
 * La page « À reprendre » : les entrées « à décider », de la plus récente à la plus ancienne, puis celles rattachées à une
 * mission, rangées de même ; chacune suivie de ses compléments, jamais séparés d'elle par « ▸ tout voir » ; 20 décrites puis « ▸ tout voir (N) » (« ▾ réduire » revient à 20) ; puis le bloc « Plus tard · N », replié
 * derrière « ▸ voir les N ». Déplier une entrée, tout voir et voir les « plus tard » sont des gestes d'affichage
 * (`shown`) ; une entrée dépliée qui n'est plus dans la liste ne laisse rien d'ouvert. La liste principale est dans un
 * rectangle ambre, « Plus tard » dans un gris ; l'entrée dépliée, dans un rectangle intérieur de la même couleur.
 */
const roadmapPendingRows = (r: CooRoadmap, shown: CooShown): CooRow[] => {
  const now = roadmapOpen(r)
  if (!now) return []
  const main = [...now.pending.filter(e => e.status !== 'plus tard').sort(newestFirst), ...[...now.attached].sort(newestFirst)]
  const later = now.pending.filter(e => e.status === 'plus tard').sort(newestFirst)
  if (main.length + later.length === 0) return []
  // L'entrée dépliée (plus d'une ligne) dans un rectangle intérieur de la couleur de son bloc.
  const entry = (e: RoadmapEntry, color: string): CooRow[] => {
    const lines = pendingEntryRows(e, shown.open === pendingOpenKey(e), r.titles)
    return [...(lines.length > 1 ? framed(lines, { id: `pending-${neutralLine(e.id)}`, color }) : lines), ...complementRows(r, e, shown)]
  }
  const pendings: CooFrame = { id: 'pendings', color: C.amber }
  const rows: CooRow[] = [{ key: 'coo-pendings', kind: 'heading', parts: [{ text: `À reprendre · ${main.length}`, bold: true }] }]
  const listed = shown.isAllPending ? main : main.slice(0, PENDING_SHOWN)
  for (const e of listed) rows.push(...entry(e, pendings.color))
  if (main.length > PENDING_SHOWN)
    rows.push({
      key: 'coo-pendings-more',
      kind: 'line',
      parts: [],
      actions: [{ key: 'coo-pendings-all', label: shown.isAllPending ? `▾${NB}réduire` : `▸${NB}tout${NB}voir${NB}(${main.length - PENDING_SHOWN})`, act: { kind: 'show', isAllPending: !shown.isAllPending }, isPlain: true }],
    })
  const out = nested(rows, pendings)
  if (later.length > 0) {
    const block: CooRow[] = [{ key: 'coo-later', kind: 'heading', parts: [{ text: `Plus tard · ${later.length}`, bold: true }] }]
    block.push({
      key: 'coo-later-toggle',
      kind: 'line',
      parts: [],
      actions: [{ key: 'coo-later-open', label: shown.isLaterOpen ? `▾${NB}réduire` : `▸${NB}voir${NB}les${NB}${later.length}`, act: { kind: 'show', isLaterOpen: !shown.isLaterOpen }, isPlain: true }],
    })
    if (shown.isLaterOpen) for (const e of later) block.push(...entry(e, C.gray))
    out.push(...nested(block, { id: 'later', color: C.gray }))
  }
  return out
}

/**
 * Le bandeau du COO : « ◆ COO · N missions · N t’attend », puis l'effort que le mod impose à ses
 * requêtes (`COO_EFFORT`), quand il change l'effort relevé de la discussion sur sa propre piste du
 * registre (`effort` : absent sur un effort inconnu, medium, xhigh ou max).
 */
export const cooBandParts = (s: CooStatement, effort: string | undefined): CooPart[] => {
  const open = s.missions.filter(m => m.status !== 'done').length
  const pill = leadEffortPill(COO_EFFORT, effort)
  // Les retenues « à forcer » comptent, comme dans le point ; les grises, non.
  const waiting = s.waits.length + s.waiting.length + toForceCount(s)
  return [
    { text: `◆${NB}COO`, color: C.teal, bold: true },
    { text: '·', dim: true },
    { text: `${open}${NB}mission${open > 1 ? 's' : ''}`, bold: true },
    ...(waiting > 0 ? [{ text: '·', dim: true }, { text: `${waiting}${NB}t’attend${waiting > 1 ? 'ent' : ''}`, color: C.amber, bold: true }] : []),
    ...(pill === null ? [] : [{ text: '·', dim: true }, { text: pill.replace(/ /g, NB), color: C.blue }]),
  ]
}
