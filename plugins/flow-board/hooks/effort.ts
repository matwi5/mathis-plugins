// La règle d'effort des workers, en un seul endroit : le brief d'un worker de groupe la donne à
// Claude (texte), et le mod l'applique lui-même à un manager qui fait le travail d'un worker (un lot
// sans groupes, un départ `/implement` ou `/tdd`, un diagnostic de bug), requête par requête. Un
// changement de la règle vaut ainsi pour les deux. Le COO et un manager tournent en high hors de ce
// travail. xhigh n'est jamais choisi par le mod : il se propose, jamais en auto.
//
// Module pur.

import type { Run } from '../types'
import { currentPhase } from './basics.ts'
import { activeDetour } from './model.ts'

/** L'effort d'une requête que le mod peut imposer : jamais xhigh. */
export type WorkerEffort = 'medium' | 'high'

/** Ce qui fait passer un worker de groupe de medium à high (règle « Effort d'un worker de groupe » de config/rules/flow-board.md). */
export type GroupEffortInputs = { isSensitive: boolean; hasDesignChoices: boolean; isMultiModule: boolean }

/** La règle d'un worker de groupe : medium par défaut ; high pour un ticket sensible, des choix de conception ou plusieurs modules. */
export const groupEffortLevel = (x: GroupEffortInputs): WorkerEffort => (x.isSensitive || x.hasDesignChoices || x.isMultiModule ? 'high' : 'medium')

/** La règle d'un worker de diagnostic de bug : high ; xhigh seulement proposé, à la deuxième tentative. */
export const diagnosisEffortLevel = (): WorkerEffort => 'high'

/** Le module d'un fichier, pour « plusieurs modules à la fois » : ses deux premiers dossiers (`plugins/flow-board`), ou son dossier. */
const moduleOf = (path: string): string => {
  const parts = path.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(p => p !== '')
  return parts.length <= 1 ? '.' : parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

/** Les phases où un manager fait le travail d'un worker de groupe, quand sa mission n'a pas de groupes. */
const LOT_PHASES = new Set(['implement', 'tdd'])

/**
 * L'effort que prend un manager qui fait lui-même le travail d'un worker, par la règle de ce worker,
 * d'après ce sur quoi il travaille (le détour actif d'abord) : celle d'un worker de groupe pour un lot
 * (mission sans groupes en `/implement` ou `/tdd`, tant qu'un ticket reste ouvert), celle d'un worker de
 * diagnostic pour `/diagnosing-bugs` (un plancher : high au moins, un effort plus haut de la discussion,
 * comme la deuxième tentative d'un worker de diagnostic en xhigh, reste). Rien hors de ce travail. Un
 * ticket qui ne dit pas s'il est sensible compte comme sensible.
 */
export const managerWorkEffort = (run: Run): { level: WorkerEffort; rule: 'group' | 'diagnosis' } | null => {
  if (run.status !== 'active') return null
  const phase = currentPhase(run)
  if (phase.status !== 'active') return null
  const skill = activeDetour(phase)?.skill ?? phase.skill
  if (skill === 'diagnosing-bugs') return { level: diagnosisEffortLevel(), rule: 'diagnosis' }
  if (!LOT_PHASES.has(skill) || (run.groups ?? []).length > 0) return null
  const open = run.tickets.filter(t => t.status !== 'done')
  // Le lot fini (revue du lot, compte rendu encore dans la phase) : plus le travail d'un worker.
  if (run.tickets.length > 0 && open.length === 0) return null
  const modules = new Set(open.flatMap(t => (t.files ?? []).map(moduleOf)))
  return {
    level: groupEffortLevel({ isSensitive: open.some(t => t.sensitive !== false), hasDesignChoices: false, isMultiModule: modules.size > 1 }),
    rule: 'group',
  }
}

// ─── Les textes de la règle, donnés à Claude dans le brief d'un worker de groupe ──────────────

/** L'effort qu'un bouton du tableau de bord impose à la session d'un groupe ; sans lui, Claude le choisit. */
export type ImposedEffort = 'xhigh'

/**
 * Ce qu'ajoute un effort xhigh retenu : la session est autonome, et l'app la plafonne à l'effort
 * de cette discussion (start_session ne lui en donne jamais un plus haut, constaté en 0.53.0) ;
 * une fois la session lancée, rappeler que l'effort de cette discussion peut redescendre.
 */
export const XHIGH_LAUNCH = (many: boolean, current: string | undefined): string =>
  `${many ? 'Une session lancée en xhigh' : 'Lancée en xhigh, la session'} est un worker autonome : son prompt le dit (point 3 ci-dessous). ` +
  `Dans l'app Desktop, start_session ne donne jamais à une session un effort plus haut que celui de cette discussion${current ? ` (son effort relevé à l'écriture de cette demande : ${current} ; je l'ai peut-être monté depuis, avant Entrée)` : ''} : si le tien est sous xhigh, arrête-toi avant de lancer et demande-moi de passer cette discussion en xhigh, puis seulement lance ; claude --bg --effort xhigh, dans le CLI, n'a pas ce plafond. ` +
  `Une fois ${many ? 'une session xhigh lancée' : 'la session lancée'}, rappelle-moi en une ligne que je peux redescendre l'effort de cette discussion : sinon tu ferais le reste de la mission en xhigh.`

/** Une tâche de jugement (glossaire) : ses deux sortes, leurs signes et les exemples du cadrage. */
export const JUDGEMENT_FR =
  "une tâche de jugement, dont la difficulté est de comprendre l'existant ou de définir le chemin, pas de produire le changement, de l'une de ces deux sortes : " +
  "un jugement sur un existant (le ticket change une pièce dont d'autres dépendent : interface publique, format partagé, modèle de données, pipeline ; ou l'existant a des conventions non écrites, peu de tests ou de documentation ; ou le ticket dit ce qui ne doit pas bouger, ou porte des exigences évidentes que la demande ne nomme pas : fermer une ressource, ne pas casser un appelant) ; " +
  "un objectif ouvert (le but sans le chemin, et un résultat qui ne se vérifie pas tout de suite : des critères de fini qualitatifs, « qualité élevée », « au niveau de X » ; un livrable lu par d'autres où le fond et la forme comptent, qui peut être long ; une grosse fonctionnalité peu guidée ; une boucle d'essais). " +
  "Exemples : grosse migration, refonte d'architecture ou du design, tests sur un code ancien, durcissement d'une zone, document long, optimisation, portage, API mal documentée, correctif de concurrence sans toucher une interface publique"

/**
 * L'effort d'une session de groupe : medium par défaut, ses tickets étant cadrés et ses revues
 * confiées à des spécialistes à l'effort explicite ; high pour un groupe délicat ; xhigh proposé
 * pour une tâche de jugement, jamais choisi par Claude seul. Imposé par le bouton, sans question.
 */
export const GROUP_EFFORT = (many: boolean, imposed: ImposedEffort | undefined, current: string | undefined): string =>
  imposed
    ? `Effort de ${many ? 'chaque session (<effort>)' : 'la session (<effort>)'} : ${imposed}, choisi par moi au tableau de bord ; ne me pose aucune question sur l'effort. ${XHIGH_LAUNCH(many, current)}`
    : `Effort de ${many ? 'chaque session (<effort>, choisi groupe par groupe)' : 'la session (<effort>)'} : medium par défaut ; high si ${many ? 'son' : 'le'} groupe a un ticket qui touche une zone sensible, s'il reste des choix de conception à faire ou s'il touche plusieurs modules à la fois. Dis-moi en une ligne l'effort choisi${many ? ' pour chaque groupe' : ''} et pourquoi. ` +
      `xhigh, seulement si je l'accepte : quand un ticket ${many ? 'de son' : 'du'} groupe est ${JUDGEMENT_FR}. ` +
      "Jamais pour une tâche d'exécution (une consigne explicite, un résultat vérifiable tout de suite : écrire une requête, lancer une commande, transformer un fichier), même si le groupe est long. " +
      "Un ticket sensible n'est pas exclu : s'il demande du jugement sur un existant, il relève de xhigh ; sensible mais local, il reste en high. high reste pour le travail cadré mais délicat ; xhigh, quand comprendre l'existant ou définir le chemin est le travail lui-même. " +
      `Tu ne choisis jamais xhigh toi-même : avant de lancer, pose-moi une question à boutons « xhigh (Recommandé) / high »${many ? ' par groupe concerné, quatre au plus par encadré (au-delà de quatre groupes concernés, plusieurs encadrés), chacune' : ''} avec une ligne qui nomme le ticket et la sorte de jugement ; cette question est permise, le bouton cliqué n'ayant pas fixé l'effort. ` +
      `Si je réponds xhigh : ${XHIGH_LAUNCH(many, current)}`

/**
 * L'effort d'une session de groupe lancée par le mode auto : la même règle sans xhigh ni sa question,
 * l'absence de proposition déclarée.
 */
export const AUTO_GROUP_EFFORT = (many: boolean): string =>
  `Effort de ${many ? 'chaque session (<effort>, choisi groupe par groupe)' : 'la session (<effort>)'} : medium par défaut ; high si ${many ? 'son' : 'le'} groupe a un ticket qui touche une zone sensible, s'il reste des choix de conception à faire ou s'il touche plusieurs modules à la fois. Dis-moi en une ligne l'effort choisi${many ? ' pour chaque groupe' : ''} et pourquoi. ` +
  "La mission est en mode auto : jamais xhigh ; ne me pose pas la question « xhigh (Recommandé) / high » ; quand un ticket relèverait de xhigh (une tâche de jugement), lance en high et déclare dans decided que xhigh n’a pas été proposé. "
