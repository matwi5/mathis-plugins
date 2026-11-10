// La vue « Coordination » du COO (planche validée : variante A, une ligne par chose, la même au
// terminal et sur l'ordinateur), décrite en lignes de morceaux de texte que `view.tsx` dessine :
// ce module ne dessine rien lui-même et n'importe pas la vue, qui l'importe.
//
// Sections, de haut en bas : le point (trois lignes), ce qui t'attend (les questions bloquantes des
// missions en auto), les missions, puis la feuille de route (alertes, jalon, étapes, idées, À reprendre),
// chaque section absente tant qu'elle est vide. La coordination entre les missions s'ajoutera ici.

import { shownGroupId } from './basics.ts'
import { C, SKILLS } from './catalog.ts'
import { COO_EFFORT, leadEffortPill } from './effort.ts'
import { neutralLine } from './closing.ts'
import { AUTO_RESUMED, WAITS_FR, cooPoint, roadmapNow, waveText, type CooCard, type CooMission, REPORT_CHANGED, REPORT_PAUSED, type CooDelivery, type CooReport, type CooRoadmap, type CooStatement, type CooWait } from './coo.ts'
import type { LaunchMode, LaunchStart } from './launch.ts'
import { roadmapTextPrint } from './roadmap.ts'
import { SECURITY_UNREAD_FR, securityToggleLabel, securityToggleTarget, type SecurityReview } from './security-setting.ts'

/** Un morceau de texte d'une ligne, avec son style. */
export type CooPart = { text: string; color?: string; bold?: boolean; dim?: boolean }
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
  | { kind: 'coord-fresh' }
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
  | { kind: 'retro-tick'; retro: string; item: string }
  | { kind: 'retro-tick-all'; retro: string }
  | { kind: 'retro-pick'; retro: string; print: string }
  | { kind: 'piste-tick'; piste: string }
  | { kind: 'pistes-cut'; print: string }
  | { kind: 'pistes-where'; where: 'repo' | 'poste' }
  | { kind: 'archive'; ids: string[]; print: string }
  | { kind: 'card-remove'; card: string }
  | { kind: 'security'; to: 'on' | 'off' }
  | { kind: 'cut-auto'; mission: string }
  | { kind: 'auto-ask'; mission: string }
  | { kind: 'auto-confirm'; mission: string }
  | { kind: 'night-ask' }
  | { kind: 'night-confirm' }
  | { kind: 'night-stop' }
/** Un bouton d'une ligne : sa clé, son libellé, son geste. */
export type CooAction = { key: string; label: string; act: CooDo }
/** Une ligne de la vue : un titre de section, ou une ligne de contenu, avec ses boutons. */
export type CooRow = { key: string; kind: 'heading' | 'line'; parts: CooPart[]; actions?: CooAction[] }

const NB = ' '

const hhmm = (at: number): string => new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

const missionParts = (m: CooMission): CooPart[] => {
  const def = SKILLS[m.phase]
  const mode: CooPart = m.mode === 'auto' ? { text: `⚡${NB}Auto${m.resumed ? ` · ${AUTO_RESUMED}` : ''}`, color: C.teal, bold: true } : { text: `✋${NB}Manuel${m.pause !== undefined ? ` · ${neutralLine(m.pause)}` : ''}`, dim: true }
  const status: CooPart[] = m.status === 'paused' ? [{ text: 'en pause, à reprendre', dim: true }] : m.status === 'done' ? [{ text: 'close', dim: true }] : []
  return [
    mode,
    { text: neutralLine(m.title), bold: true },
    { text: def ? `${def.glyph}${NB}${def.label}` : m.phase, color: def?.color },
    ...status,
    ...(m.total > 0 ? [{ text: `${m.done}/${m.total}`, bold: true }] : []),
    ...m.workers.map(w => ({ text: `↗${w.group}${NB}${w.done}/${w.total}${w.state === 'returned' || w.state === 'reported' ? `${NB}rendu` : ''}`, color: C.blue, bold: true })),
    ...(m.waiting > 0 ? [{ text: `· attend ${m.waiting} question${m.waiting > 1 ? 's' : ''}`, color: C.amber, bold: true }] : []),
    // En manuel, ouverte nulle part : elle ne peut pas s'allumer d'ici.
    ...(m.mode === 'manual' && m.status !== 'done' && !m.isOpen ? [{ text: 'Reprends-la pour l’allumer', dim: true }] : []),
  ]
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
        { key: `coo-auto-confirm-${m.id}`, label: 'Confirmer', act: { kind: 'auto-confirm', mission: m.id } },
        { key: `coo-auto-cancel-${m.id}`, label: 'Annuler', act: { kind: 'auto-ask', mission: m.id } },
      ],
    }
  return { actions: [{ key: `coo-auto-on-${m.id}`, label: `⚡${NB}Auto`, act: { kind: 'auto-ask', mission: m.id } }] }
}

/** La surveillance de nuit allumée, comme la montrent la vue Coordination et le bandeau du COO (libellé validé par la personne). */
export const nightParts = (night: { until: number }): CooPart[] => [{ text: `🌙${NB}Surveillance de nuit · jusqu’à ${hhmm(night.until)}`, color: C.violet, bold: true }]

/**
 * Le bouton d'allumage de la surveillance de nuit, sur la ligne « Le point » : « 🌙 Surveillance de nuit », puis
 * « Confirmer » et « Annuler », dont le second clic l'allume (seulement chez le titulaire du siège).
 */
const nightActions = (s: CooStatement): CooAction[] =>
  s.nightAsk
    ? [
        { key: 'coo-night-confirm', label: 'Confirmer', act: { kind: 'night-confirm' } },
        { key: 'coo-night-cancel', label: 'Annuler', act: { kind: 'night-ask' } },
      ]
    : [{ key: 'coo-night-ask', label: `🌙${NB}Surveillance de nuit`, act: { kind: 'night-ask' } }]

/** Les lignes de l'onglet Coordination, calculées sur le relevé. */
export const coordinationRows = (s: CooStatement): CooRow[] => {
  const point = cooPoint(s)
  // Les lignes des missions livrées sous « Ce qui t'attend » (chacune sans carte de rétro prête, puis « Tout archiver » dès
  // deux, cartes comprises) : l'en-tête et « Rien pour l'instant » comptent ces mêmes lignes, jamais un autre compte.
  const delivered = deliveredRows(s)
  const deliveredCount = delivered.length
  return [
    { key: 'coo-point', kind: 'heading', parts: [{ text: 'Le point', bold: true }] },
    ...point.map((text, i) => ({ key: `coo-point-${i}`, kind: 'line' as const, parts: [{ text }] })),
    // La surveillance de nuit : allumée, son bandeau et « Arrêter » ; éteinte, le seul bouton qui l'allume.
    s.night
      ? { key: 'coo-night', kind: 'line' as const, parts: nightParts(s.night), actions: [{ key: 'coo-night-stop', label: 'Arrêter', act: { kind: 'night-stop' as const } }] }
      : { key: 'coo-night', kind: 'line' as const, parts: [], actions: nightActions(s) },
    { key: 'coo-waits', kind: 'heading', parts: [{ text: `Ce qui t’attend · ${s.waits.length + s.waiting.length + (s.reports ?? []).length + deliveredCount}`, bold: true, ...(s.waits.length + s.waiting.length + (s.reports ?? []).length + deliveredCount > 0 ? { color: C.amber } : {}) }] },
    ...(s.waits.length + s.waiting.length + s.relays.length + (s.reports ?? []).length + (s.delivery ? 1 : 0) + delivered.length === 0
      ? [{ key: 'coo-waits-none', kind: 'line' as const, parts: [{ text: 'Rien pour l’instant.', dim: true }] }]
      : [
          ...s.waits.map(w => ({
            key: `coo-wait-${waitKey(w)}`,
            kind: 'line' as const,
            parts: [
              { text: '?', color: C.amber, bold: true },
              { text: `${neutralLine(w.id)} « ${neutralLine(w.text)} »` },
              ...(w.gesture?.kind === 'flaw' ? [{ text: `(laisse ${w.gesture.dismissed ?? 0} faille${(w.gesture.dismissed ?? 0) > 1 ? 's' : ''}${w.target ? ` · ${neutralLine(w.target)}` : ''})`, color: C.amber }] : []),
              ...(w.isMod ? [{ text: 'réponds dans la mission', dim: true }] : []),
              { text: `· ${neutralLine(w.mission)}${w.at !== null ? ` · depuis ${hhmm(w.at)}` : ''}`, dim: true },
              ...(w.relay ? [{ text: `◷${NB}réponse en cours d’application`, color: C.amber, bold: true }] : []),
            ],
            ...(w.relay || w.isMod ? {} : { actions: waitActions(w) }),
          })),
          ...(s.reports ?? []).flatMap(reportRows),
          ...(s.delivery ? deliveryRows(s.delivery) : []),
          ...delivered,
          // Une réponse donnée ici qui ne s'applique pas encore : la mission fermée, ou la question changée depuis.
          ...s.relays.map((r, i) => ({
            key: `coo-relay-${i}`,
            kind: 'line' as const,
            parts: [
              { text: '⚠', color: C.amber, bold: true },
              {
                text:
                  r.state === 'paused'
                    ? `Ta réponse à ${neutralLine(r.question)} de « ${neutralLine(r.mission)} » attend : reprends-la pour que la réponse s’applique.`
                    : `La question ${neutralLine(r.question)} de « ${neutralLine(r.mission)} » a changé depuis ta réponse : relis-la, elle n’est pas répondue.`,
              },
            ],
          })),
          // Une mission en manuel (ou en auto mis en pause) dont le tour fini demande la personne.
          ...s.waiting.map((w, i) => ({
            key: `coo-waiting-${i}`,
            kind: 'line' as const,
            parts: [{ text: '◷', color: C.amber, bold: true }, { text: `La mission « ${neutralLine(w.mission)} » t’attend : ${WAITS_FR[w.kind]}, depuis ${hhmm(w.since)}` }],
          })),
        ]),
    ...retroPickRows(s),
    ...pistesWaitingRows(s),
    ...pistesWhereRows(s),
    { key: 'coo-missions', kind: 'heading', parts: [{ text: `Missions · ${s.missions.length}`, bold: true }] },
    ...(s.missions.length === 0
      ? [{ key: 'coo-missions-none', kind: 'line' as const, parts: [{ text: 'Aucune mission dans ce projet.', dim: true }] }]
      : s.missions.map(m => ({ key: `coo-mission-${m.id}`, kind: 'line' as const, parts: missionParts(m), ...missionActions(m, s.autoAsk) }))),
    ...cardRows(s.cards ?? [], s.quota, s.delivered),
    ...planRows(s),
    ...waveRows(s),
    ...(s.roadmap ? roadmapRows(s.roadmap) : []),
    ...holdRows(s),
    ...outsideRows(s),
    ...oppositionRows(s),
    ...coordinationFileRows(s),
  ]
}

/**
 * La bascule de la revue de sécurité du projet, dans la vue du COO : son état relu à l'instant (une lecture
 * ratée se montre « activée », avec une ligne ambre) ; un clic pose l'état inverse de celui qu'elle montre.
 */
export const securitySettingRows = (review: SecurityReview): CooRow[] => [
  { key: 'coo-security', kind: 'heading', parts: [{ text: 'Revue de sécurité de ce projet', bold: true }] },
  {
    key: 'coo-security-line',
    kind: 'line',
    parts: review === 'unread' ? [{ text: '⚠', color: C.amber, bold: true }, { text: SECURITY_UNREAD_FR, color: C.amber }] : [{ text: 'Gardée sur ce poste, pour tout le dépôt (worktrees des workers compris).', dim: true }],
    actions: [{ key: 'coo-security-toggle', label: securityToggleLabel(review), act: { kind: 'security', to: securityToggleTarget(review) } }],
  },
]

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
  return [{ key: `coo-answer-${id}`, label: `✎${NB}Répondre`, act: { kind: 'answer-fill', mission: w.missionId, question: w.id, print: w.print } }]
}

/**
 * Le rapport d'une mission à valider : « ▸ Lire » l'ouvre en entier ; ouvert, « ✓ Valider » (sur la version
 * affichée, seulement quand la mission est ouverte dans une discussion) et « ✎ À reprendre ».
 */
const reportRows = (r: CooReport): CooRow[] => {
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
      parts: [{ text: '▤', color: C.amber, bold: true }, { text: `Rapport de « ${neutralLine(r.mission)} » à valider` }, ...state],
      actions: [{ key: `coo-report-read-${i}`, label: r.state === 'stale' ? `↻${NB}Relire` : r.isOpen ? `▾${NB}Replier` : `▸${NB}Lire`, act: { kind: 'report-read', mission: r.missionId, print: r.print } }],
    },
  ]
  if (!r.isOpen) return rows
  // Le rapport en entier, une ligne par ligne du texte : la personne valide ce qu'elle a lu.
  for (const [j, text] of r.text.split(/\r?\n/).entries()) rows.push({ key: `coo-report-${i}-line-${j}`, kind: 'line', parts: [{ text: text === '' ? NB : neutralLine(text) }] })
  // Jamais sur une version que la personne n'a pas ouverte (`stale` : changée depuis l'ouverture).
  const canValidate = r.isMissionOpen && r.state !== 'validating' && r.state !== 'stale'
  rows.push({
    key: `coo-report-${i}-acts`,
    kind: 'line',
    parts: [{ text: `fin du rapport de « ${neutralLine(r.mission)} »`, dim: true }],
    actions: [
      ...(canValidate ? [{ key: `coo-report-validate-${i}`, label: `✓${NB}Valider`, act: { kind: 'report-validate' as const, mission: r.missionId, print: r.print } }] : []),
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
    const rows: CooRow[] = [{ key: 'coo-delivery', kind: 'line', parts: [...head, { text: 'prête', dim: true }], actions: [{ key: 'coo-deliver', label: `▶${NB}Livrer`, act: { kind: 'deliver', key: d.key ?? '' } }] }]
    for (const [i, c] of d.commits.entries())
      rows.push({ key: `coo-delivery-commits-${i}`, kind: 'line', parts: [{ text: '·', dim: true }, { text: `${c.mission === null ? 'hors mission' : `« ${neutralLine(c.mission)} »`} : ${c.lines.length} commit${c.lines.length > 1 ? 's' : ''}`, dim: true }, { text: c.lines.slice(0, 3).map(l => neutralLine(l)).join(' · '), dim: true }] })
    if (d.more !== undefined && d.more > 0) rows.push({ key: 'coo-delivery-more', kind: 'line', parts: [{ text: '·', dim: true }, { text: `et ${d.more} commit${d.more > 1 ? 's' : ''} de plus`, dim: true }] })
    const waits = [
      ...(d.waitFor.length > 0 ? [`${quotedTitles(d.waitFor)} pas finie${d.waitFor.length > 1 ? 's' : ''}, avec des groupes déjà fusionnés`] : []),
      ...(d.waitCommits.length > 0 ? [`${quotedTitles(d.waitCommits)} pas finie${d.waitCommits.length > 1 ? 's' : ''}, des commits partent`] : []),
    ]
    if (waits.length > 0)
      rows.push({ key: 'coo-delivery-wait', kind: 'line', parts: [{ text: '⚠', color: C.amber, bold: true }, { text: `Mieux vaut attendre : ${waits.join(' ; ')}.`, color: C.amber }] })
    return rows
  }
  const GLYPH = { todo: '○', running: '◷', done: '✓', failed: '✗' } as const
  const action: CooAction[] =
    d.state === 'failed'
      ? [{ key: 'coo-deliver-retry', label: `↻${NB}Réessayer`, act: { kind: 'deliver-step', gesture: 'retry' } }, { key: 'coo-deliver-drop', label: `✕${NB}Abandonner`, act: { kind: 'deliver-drop' } }]
      : d.state === 'paused' && !d.isArmed
        ? [{ key: 'coo-deliver-resume', label: `▶${NB}Reprendre${d.step ? ` à ${d.step}` : ''}`, act: { kind: 'deliver-step', gesture: 'resume' } }]
        : d.state === 'running'
          ? [{ key: 'coo-deliver-check', label: `↻${NB}Demander${NB}l’issue`, act: { kind: 'deliver-step', gesture: 'check' } }]
          : []
  const state = d.state === 'failed' ? `arrêtée à ${d.step ?? '?'}` : d.state === 'running' ? `${d.step ?? ''} en cours` : d.isArmed ? `${d.step ?? ''} part ensuite` : `à reprendre à ${d.step ?? '?'}`
  return [
    { key: 'coo-delivery', kind: 'line', parts: [...head, { text: state, color: d.state === 'failed' ? C.amber : C.sky, bold: true }], ...(action.length > 0 ? { actions: action } : {}) },
    ...(d.steps ?? []).map((s, i) => ({ key: `coo-delivery-step-${i}`, kind: 'line' as const, parts: [{ text: GLYPH[s.status], ...(s.status === 'failed' ? { color: C.amber } : {}) }, { text: s.label }, ...(s.detail ? [{ text: neutralLine(s.detail), dim: true }] : [])] })),
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
      parts: [{ text: '⇉', color: C.cyan, bold: true }, { text: w.next.map(m => `« ${neutralLine(m.title)} » : ${m.groups.map(g => neutralLine(g).slice(0, 12)).join(', ')}`).join(' · ') }, ...(w.isLaunching ? [{ text: `◷${NB}lancement en cours`, color: C.amber, bold: true }] : [])],
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
    rows.push({ key: `coo-plan-wave-${i}`, kind: 'line', parts: [{ text: `Vague${NB}${i + 1}`, color: C.cyan, bold: true }, { text: waveText(w, t => `« ${neutralLine(t)} »`) }] })
  }
  // Une seule livraison, après la dernière vague, pour toutes les missions du plan.
  const delivery = p.computed.delivery
  if (delivery.length > 0)
    rows.push({ key: 'coo-plan-delivery', kind: 'line', parts: [{ text: '→', dim: true }, { text: `une livraison : ${delivery.map(d => `« ${neutralLine(d.title)} »`).join(', ')}`, dim: true }] })
  return rows
}

/** Les deux lancements d'une carte, le mode recommandé en tête ; jamais en auto une carte en xhigh. */
const launchButtons = (c: CooCard): CooAction[] => {
  const button = (mode: LaunchMode): CooAction => ({ key: `coo-card-${mode}-${c.id}`, label: `▶${NB}Lancer${NB}en${NB}${MODE_FR[mode]}`, act: { kind: 'launch', card: c.id, mode, at: c.at } })
  const modes: LaunchMode[] = c.effort === 'xhigh' ? ['manual'] : c.mode === 'auto' ? ['auto', 'manual'] : ['manual', 'auto']
  return modes.map(button)
}

/**
 * Les cartes de lancement : le départ (et sa ligne d'ask-matt), le mode et l'effort recommandés avec leur
 * raison, le dossier ; un clic lance (une carte ne lance qu'une fois : « lancement en cours », puis la
 * mission lancée) ; les autres départs se choisissent avant le clic. `quota` : celui de la discussion, sous une
 * carte prête en xhigh (une limite atteinte arrêterait la mission en plein travail).
 */
const cardRows = (cards: readonly CooCard[], quota?: string, delivered?: CooStatement['delivered']): CooRow[] => {
  if (cards.length === 0) return []
  const rows: CooRow[] = [{ key: 'coo-cards', kind: 'heading', parts: [{ text: `Lancements · ${cards.length}`, bold: true }] }]
  for (const c of cards) {
    const def = SKILLS[c.start]
    const state: CooPart[] =
      c.state.kind === 'launched'
        ? [{ text: `✓${NB}lancée : « ${neutralLine(c.state.run.title)} »`, color: C.green, bold: true }]
        : c.state.kind === 'launching'
          ? [{ text: `◷${NB}lancement en cours (${MODE_FR[c.state.mode]})`, color: C.amber, bold: true }]
          : []
    rows.push({
      key: `coo-card-${c.id}`,
      kind: 'line',
      parts: [
        { text: '▶', color: C.teal, bold: true },
        { text: neutralLine(c.title), bold: true },
        { text: def ? `${def.glyph}${NB}/${c.start}` : `/${c.start}`, ...(def?.color ? { color: def.color } : {}) },
        { text: `${MODE_FR[c.mode]} · ${c.effort} · travail/${neutralLine(c.folder)}/`, dim: true },
        ...state,
      ],
      ...(c.state.kind === 'ready'
        ? {
            actions: [
              ...launchButtons(c),
              ...c.alts.map(a => ({ key: `coo-card-alt-${c.id}-${a}`, label: `→${NB}/${a}`, act: { kind: 'card-start' as const, card: c.id, start: a } })),
              // La rétro d'une mission livrée et pas archivée : « ✓ Archiver » archive la mission, et sa carte part avec elle.
              ...(c.of && delivered?.list.some(d => d.id === c.of) ? [archiveAction(`coo-card-archive-${c.id}`, `✓${NB}Archiver`, [c.of], delivered.print)] : []),
              // Sa mission n'attend pas « ✓ Archiver » : « ✕ Retirer » retire la carte, sans rien écrire sur la mission.
              ...(c.isRemovable ? [{ key: `coo-card-remove-${c.id}`, label: `✕${NB}Retirer`, act: { kind: 'card-remove' as const, card: c.id } }] : []),
            ],
          }
        : {}),
    })
    // Pourquoi ce départ, ce mode, cet effort : la ligne d'ask-matt et les raisons, telles que Claude les a écrites.
    rows.push({ key: `coo-card-why-${c.id}`, kind: 'line', parts: [{ text: `${c.of ? 'rétro' : 'ask-matt'} : ${neutralLine(c.askMatt)}${c.modeWhy ? ` · mode : ${neutralLine(c.modeWhy)}` : ''}${c.effortWhy ? ` · effort : ${neutralLine(c.effortWhy)}` : ''}`, dim: true }] })
    if (quota && c.effort === 'xhigh' && c.state.kind === 'ready') rows.push({ key: `coo-card-quota-${c.id}`, kind: 'line', parts: [{ text: `quota de la discussion${NB}·${NB}${quota}`, dim: true }] })
  }
  return rows
}

/** Un bouton d'archivage : les ids montrés et l'empreinte de la liste affichée, que le clic compare au fichier relu. */
const archiveAction = (key: string, label: string, ids: string[], print: string): CooAction => ({ key, label, act: { kind: 'archive', ids, print } })

/**
 * Les missions livrées et pas archivées, sous « Ce qui t'attend » : une ligne « « M » livrée » avec « ✓ Archiver »
 * pour chacune sans carte de rétro prête (sa carte, dans « Lancements », porte le même bouton), puis, dès deux
 * missions livrées (avec ou sans carte), « ✓ Tout archiver (n) ».
 */
const deliveredRows = (s: CooStatement): CooRow[] => {
  const d = s.delivered
  if (!d) return []
  const rows: CooRow[] = d.list
    .filter(x => x.card === undefined)
    .map(x => ({
      key: `coo-delivered-${neutralLine(x.id)}`,
      kind: 'line' as const,
      parts: [{ text: '✓', color: C.green, bold: true }, { text: `« ${neutralLine(x.title)} » livrée` }, { text: 'rétro ou archivage', dim: true }],
      actions: [archiveAction(`coo-archive-${x.id}`, `✓${NB}Archiver`, [x.id], d.print)],
    }))
  if (d.list.length >= 2)
    rows.push({
      key: 'coo-delivered-all',
      kind: 'line',
      parts: [{ text: `${d.list.length} missions livrées attendent leur rétro ou leur archivage`, dim: true }],
      actions: [archiveAction('coo-archive-all', `✓${NB}Tout${NB}archiver${NB}(${d.list.length})`, d.list.map(x => x.id), d.print)],
    })
  return rows
}

/**
 * Les pistes d'une rétro lancée par le COO : une case par piste (une piste prise ailleurs n'en a pas), « Tout
 * cocher », et « ✂ Découper la sélection », qui dit combien partent dans « À reprendre » (une rétro qui relit la
 * liste d'attente n'a pas cette section : ses pistes sont dans « Pistes en attente »).
 */
const retroPickRows = (s: CooStatement): CooRow[] =>
  (s.retroPicks ?? []).flatMap((p): CooRow[] => {
    if (p.isSent)
      return [{ key: `coo-retro-${p.retro}`, kind: 'line' as const, parts: [{ text: '✂', color: C.teal, bold: true }, { text: `Sélection des pistes de « ${neutralLine(p.title)} » envoyée à la rétro : rien à cocher ici (une demande de découpage perdue se relance depuis le panneau de la rétro, « ✂ Découper »).` }] }]
    const ticked = p.items.filter(i => i.isTicked).length
    const left = p.items.length - ticked
    return [
      {
        key: `coo-retro-${p.retro}`,
        kind: 'line' as const,
        parts: [{ text: '◷', color: C.amber, bold: true }, { text: `Pistes de la rétro « ${neutralLine(p.title)} » · ${p.items.length}`, bold: true }],
        actions: [
          ...(ticked < p.items.length ? [{ key: `coo-retro-all-${p.retro}`, label: `☑${NB}Tout${NB}cocher`, act: { kind: 'retro-tick-all' as const, retro: p.retro } }] : []),
          { key: `coo-retro-pick-${p.retro}`, label: `✂${NB}Découper${NB}la${NB}sélection${NB}(${ticked}${NB}cochée${ticked > 1 ? 's' : ''},${NB}${left}${NB}vers${NB}À${NB}reprendre)`, act: { kind: 'retro-pick' as const, retro: p.retro, print: p.print } },
        ],
      },
      ...p.items.map(i => ({
        key: `coo-retro-${p.retro}-${i.id}`,
        kind: 'line' as const,
        parts: [{ text: `${i.id}.`, dim: true }, { text: neutralLine(i.label) }],
        actions: [{ key: `coo-retro-tick-${p.retro}-${i.id}`, label: i.isTicked ? '☑' : '☐', act: { kind: 'retro-tick' as const, retro: p.retro, item: i.id } }],
      })),
      ...p.taken.map(i => ({
        key: `coo-retro-${p.retro}-${i.id}-taken`,
        kind: 'line' as const,
        parts: [{ text: `${i.id}.`, dim: true }, { text: neutralLine(i.label), dim: true }, { text: `déjà prise par ${neutralLine(i.by)}`, color: C.amber }],
      })),
    ]
  })

/**
 * La section « Pistes en attente », commune à toutes les rétros qui relisent la liste : les pistes rangées par
 * fichier (une ligne de fichier avant chaque rang), chacune avec son état, sa rétro, ses fichiers, sa carte et son
 * dernier commentaire ; une case sur chaque « pas encore validée » ; « ✂ Découper la sélection » en bas.
 */
const pistesWaitingRows = (s: CooStatement): CooRow[] => {
  const w = s.pistesWaiting
  if (!w) return []
  const rows: CooRow[] = [{ key: 'coo-pistes', kind: 'heading', parts: [{ text: `Pistes en attente · ${w.rows.length + w.more}`, bold: true }] }]
  let file: string | null = null
  for (const r of w.rows) {
    if (r.file !== file) {
      file = r.file
      rows.push({ key: `coo-pistes-file-${r.id}`, kind: 'line', parts: [{ text: r.file === '' ? 'sans fichier' : neutralLine(r.file), dim: true, bold: true }] })
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
      parts: [
        { text: `${neutralLine(r.id)}`, dim: true },
        { text: neutralLine(r.text.length > 160 ? `${r.text.slice(0, 159)}…` : r.text) },
        { text: neutralLine(r.stateText), color: r.state === 'pending' ? C.amber : C.teal },
        { text: extra, dim: true },
      ],
      ...(r.isTickable ? { actions: [{ key: `coo-piste-tick-${r.id}`, label: r.isTicked ? '☑' : '☐', act: { kind: 'piste-tick' as const, piste: r.id } }] } : {}),
    })
  }
  if (w.more > 0) rows.push({ key: 'coo-pistes-more', kind: 'line', parts: [{ text: `${w.more} autre(s) piste(s) ouverte(s), pas montrée(s) ici.`, dim: true }] })
  if (w.closed > 0) rows.push({ key: 'coo-pistes-closed', kind: 'line', parts: [{ text: `${w.closed} piste(s) faite(s) ou écartée(s), pas montrée(s).`, dim: true }] })
  if (w.rows.some(r => r.isTickable))
    rows.push({
      key: 'coo-pistes-cut',
      kind: 'line',
      parts: [{ text: `${w.ticked} cochée${w.ticked > 1 ? 's' : ''}`, dim: true }],
      actions: [{ key: 'coo-pistes-cut-go', label: `✂${NB}Découper${NB}la${NB}sélection`, act: { kind: 'pistes-cut' as const, print: w.print } }],
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
  return [
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
  ]
}

/** Les décisions opposées entre missions (question posée à celle qui a décidé en second) et les sujets compatibles. */
const oppositionRows = (s: CooStatement): CooRow[] => [
  ...(s.decisions?.contradictions ?? []).map((c, i) => ({
    key: `coo-opposed-${i}`,
    kind: 'line' as const,
    parts: [
      { text: '⚠', color: C.amber, bold: true },
      { text: `Décisions opposées sur ${neutralLine(c.subject)} : « ${neutralLine(c.mission)} » et « ${neutralLine(c.other)} »` },
      { text: c.isOpen ? `question posée à « ${neutralLine(c.mission)} »` : `la question attend que « ${neutralLine(c.mission)} » soit reprise`, dim: true },
      ...(c.isOtherArchived ? [{ text: `« ${neutralLine(c.other)} » archivée depuis : la question reste posée`, color: C.amber }] : []),
    ],
  })),
  ...(s.decisions?.compatibles ?? []).map((c, i) => ({
    key: `coo-compatible-${i}`,
    kind: 'line' as const,
    parts: [{ text: '≈', dim: true }, { text: `« ${neutralLine(c.a)} » et « ${neutralLine(c.b)} » décident tous deux sur ${neutralLine(c.subject)}, compatibles`, dim: true }],
  })),
]

/** Qui attend qui entre les missions, avec « ⇥ Forcer » par paire ; puis les départs croisés à signaler. */
const holdRows = (s: CooStatement): CooRow[] =>
  s.holds.length === 0 && s.crossed.length === 0
    ? []
    : [
        { key: 'coo-holds', kind: 'heading', parts: [{ text: `Retenues entre missions · ${s.holds.length}`, bold: true, ...(s.crossed.length > 0 ? { color: C.amber } : {}) }] },
        ...s.holds.map((h, i) => ({
          key: `coo-hold-${i}`,
          kind: 'line' as const,
          parts: [
            { text: '⏸', color: C.amber, bold: true },
            { text: `${unitText(h.held)} de « ${neutralLine(h.mission)} » attend ${unitText(h.group)} de « ${neutralLine(h.title)} »` },
            { text: h.on === 'plan' ? '(plan du projet)' : `(${h.on === 'file' ? 'fichier commun' : 'ressource commune'} : ${neutralLine(h.shared)})`, dim: true },
          ],
          actions: [{ key: `coo-force-${i}`, label: `⇥${NB}Forcer`, act: { kind: 'force' as const, mission: h.missionId, held: h.held, run: h.run, group: h.group, ...(h.on === 'plan' ? { on: 'plan' as const } : {}) } }],
        })),
        ...s.crossed.map((c, i) => ({
          key: `coo-crossed-${i}`,
          kind: 'line' as const,
          parts: [
            { text: '⚠', color: C.amber, bold: true },
            { text: `Lancés ensemble : ${unitText(c.a.group)} de « ${neutralLine(c.a.title)} » et ${unitText(c.b.group)} de « ${neutralLine(c.b.title)} »` },
            { text: `(${neutralLine(c.shared)} en commun)`, dim: true },
          ],
        })),
      ]

/** Les commits hors mission sur les fichiers d'un groupe en cours : une ligne par groupe, sans bouton ni notification. */
const outsideRows = (s: CooStatement): CooRow[] =>
  (s.outside ?? []).map(o => ({
    key: `coo-outside-${o.missionId}-${o.group}`,
    kind: 'line' as const,
    parts: [
      { text: '⚠', color: C.amber, bold: true },
      { text: `main a reçu ${o.count} commit(s) hors mission sur des fichiers du groupe ${shownGroupId(o.group)} de « ${neutralLine(o.mission)} »` },
    ],
  }))

/** Le fichier de coordination illisible : rien ne s'y écrit ; la personne seule repart d'un fichier neuf, la copie gardée. */
const coordinationFileRows = (s: CooStatement): CooRow[] =>
  s.coordination?.state !== 'unread'
    ? []
    : [
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
    parts: [
      { text: '⚠', color: C.amber, bold: true },
      { text: `État de la feuille de route mis de côté : ${neutralLine(p)}` },
    ],
  }))

/** Les sections de la feuille de route : alertes d'abord (copies mises de côté, entrées disparues, fichier hors format, où la garder), puis jalon, étapes, idées et À reprendre. */
const roadmapRows = (r: CooRoadmap): CooRow[] => {
  // Illisible (le fichier, ou ce que le mod en garde) : rien n'en est montré ni proposé, sauf ses copies mises de côté.
  if (r.read === 'unread') return [{ key: 'coo-roadmap', kind: 'heading', parts: [{ text: `⚠${NB}Feuille de route illisible : rien n’en est montré`, color: C.amber, bold: true }] }, ...roadmapAsideRows(r)]
  const rows: CooRow[] = [...roadmapAsideRows(r)]
  if (r.gone.length > 0) {
    const title = r.read === null ? `⚠${NB}Feuille de route absente · ${r.gone.length} entrées connues` : `⚠${NB}Entrées disparues de la feuille de route · ${r.gone.length}`
    rows.push({ key: 'coo-gone', kind: 'heading', parts: [{ text: title, color: C.red, bold: true }] })
    for (const g of r.gone) rows.push({ key: `coo-gone-${neutralLine(g.id)}`, kind: 'line', parts: [{ text: neutralLine(g.line), dim: true }], actions: [{ key: `coo-restore-${neutralLine(g.id)}`, label: `↺${NB}Remettre`, act: { kind: 'restore', id: g.id } }] })
  }
  // Un ancien texte d'une entrée, changé sous le même id, qui n'est plus nulle part : une disparition aussi ; on le remet sous un id neuf, jamais on ne le laisse partir.
  const texts = r.goneTexts ?? []
  if (texts.length > 0) {
    rows.push({ key: 'coo-gone-texts', kind: 'heading', parts: [{ text: `⚠${NB}Textes changés sous le même id · ${texts.length}`, color: C.red, bold: true }] })
    for (const t of texts) {
      const key = `${neutralLine(t.id)}-${roadmapTextPrint(t.text)}`
      rows.push({ key: `coo-gone-text-${key}`, kind: 'line', parts: [{ text: neutralLine(t.line), dim: true }, { text: `ancien texte de ${neutralLine(t.id)} · ${neutralLine(t.section)}`, dim: true }], actions: [{ key: `coo-restore-text-${key}`, label: `↺${NB}Remettre`, act: { kind: 'restore-text', id: t.id, print: roadmapTextPrint(t.text) } }] })
    }
  }
  if (r.where === 'unasked') {
    rows.push({ key: 'coo-where', kind: 'heading', parts: [{ text: 'Feuille de route : la commiter dans ce projet ?', color: C.amber, bold: true }] })
    rows.push({
      key: 'coo-where-ask',
      kind: 'line',
      parts: [{ text: 'Dans un dépôt public, tes idées seraient publiées. En attendant ton choix, elle reste sur ce poste.', dim: true }],
      actions: [
        { key: 'coo-where-repo', label: `Commiter${NB}dans${NB}travail/`, act: { kind: 'where', where: 'repo' } },
        { key: 'coo-where-poste', label: `Garder${NB}sur${NB}le${NB}poste`, act: { kind: 'where', where: 'poste' } },
      ],
    })
  }
  // Pas encore de fichier, ni d'entrée connue : la section reste absente (le COO propose de la commencer).
  if (r.read === null) return rows
  if (!r.read.ok) {
    return [
      ...rows,
      { key: 'coo-roadmap', kind: 'heading', parts: [{ text: `⚠${NB}Feuille de route hors format`, color: C.red, bold: true }] },
      { key: 'coo-roadmap-bad', kind: 'line', parts: [{ text: `ligne ${r.read.lineNo} : ${neutralLine(r.read.why)} ; rien n’en est montré.`, dim: true }], actions: [{ key: 'coo-repair', label: `↺${NB}Réparer`, act: { kind: 'repair' } }] },
    ]
  }
  const now = roadmapNow(r)
  // Une section vide ne se dessine pas.
  if (now.milestones.length + now.steps.length > 0) rows.push({ key: 'coo-roadmap', kind: 'heading', parts: [{ text: 'Feuille de route', bold: true }] })
  for (const m of now.milestones) rows.push({ key: `coo-milestone-${neutralLine(m.id)}`, kind: 'line', parts: entryParts('◆', C.teal, m.id, m.text, 'jalon en cours') })
  for (const e of now.steps) rows.push({ key: `coo-step-${neutralLine(e.id)}`, kind: 'line', parts: entryParts('→', C.blue, e.id, e.text, e.status) })
  if (now.ideas.length + now.pending.length > 0) rows.push({ key: 'coo-ideas', kind: 'heading', parts: [{ text: `Idées · À reprendre · ${now.ideas.length + now.pending.length}`, bold: true }] })
  for (const e of now.ideas) {
    const actions: CooAction[] = [
      ...(e.status === 'à lancer' ? [{ key: `coo-idea-launch-${neutralLine(e.id)}`, label: `▶${NB}Lancer`, act: { kind: 'idea-launch' as const, id: e.id } }] : []),
      ...(e.status === 'à lancer' ? [{ key: `coo-later-${neutralLine(e.id)}`, label: `Plus${NB}tard`, act: { kind: 'later' as const, id: e.id } }] : []),
      { key: `coo-drop-${neutralLine(e.id)}`, label: 'Écarter', act: { kind: 'drop', id: e.id } },
    ]
    rows.push({ key: `coo-idea-${neutralLine(e.id)}`, kind: 'line', parts: entryParts('✦', C.violet, e.id, e.text, e.status), actions })
  }
  // Une chose à reprendre ne sort de la liste que par la décision de la personne : ses quatre boutons.
  for (const e of now.pending) {
    const id = neutralLine(e.id)
    rows.push({
      key: `coo-pending-${id}`,
      kind: 'line',
      parts: entryParts('↺', C.amber, e.id, e.text, e.status),
      actions: [
        { key: `coo-pending-launch-${id}`, label: 'Lancer', act: { kind: 'pending-launch', id: e.id } },
        { key: `coo-pending-attach-${id}`, label: 'Rattacher', act: { kind: 'pending-attach', id: e.id } },
        ...(e.status !== 'plus tard' ? [{ key: `coo-pending-later-${id}`, label: `Plus${NB}tard`, act: { kind: 'pending-later' as const, id: e.id } }] : []),
        { key: `coo-pending-drop-${id}`, label: 'Écarter', act: { kind: 'pending-drop', id: e.id } },
      ],
    })
  }
  return rows
}

/**
 * Le bandeau du COO : « ◆ COO · N missions · N t’attend », puis l'effort que le mod impose à ses
 * requêtes (`COO_EFFORT`), quand il change l'effort relevé de la discussion sur sa propre piste du
 * registre (`effort` : absent sur un effort inconnu, medium, xhigh ou max).
 */
export const cooBandParts = (s: CooStatement, effort: string | undefined): CooPart[] => {
  const open = s.missions.filter(m => m.status !== 'done').length
  const pill = leadEffortPill(COO_EFFORT, effort)
  return [
    { text: `◆${NB}COO`, color: C.teal, bold: true },
    { text: '·', dim: true },
    { text: `${open}${NB}mission${open > 1 ? 's' : ''}`, bold: true },
    ...(s.waits.length + s.waiting.length > 0
      ? [{ text: '·', dim: true }, { text: `${s.waits.length + s.waiting.length}${NB}t’attend${s.waits.length + s.waiting.length > 1 ? 'ent' : ''}`, color: C.amber, bold: true }]
      : []),
    ...(pill === null ? [] : [{ text: '·', dim: true }, { text: pill.replace(/ /g, NB), color: C.blue }]),
  ]
}
