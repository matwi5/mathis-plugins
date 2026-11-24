// Les cases d'autonomie du mode auto d'un projet, gardées sur le poste : leur liste et la lecture, pure, de leur fichier.
// Invariant (fixé par la personne) : une mission ne tranche jamais seule une sorte de question dont la personne n'a pas
// coché la case par un clic ; une case absente, illisible ou mal lue vaut décochée, et la question lui est posée.
// D'où : une seule forme vaut, et tout écart (texte vide, JSON abîmé, racine d'un autre projet, version inconnue, valeur
// qui n'est ni vrai ni faux) rend les cinq cases décochées ; une case inconnue du code est ignorée ; la date du clic
// n'influe jamais sur l'état. La lecture et la seule écriture du fichier vivent dans `autonomy-store.ts`.

/** Les cinq cases, dans l'ordre de la page « Réglages » : un id stable (la clé du fichier) et le libellé montré. */
export const AUTONOMY_CASES = [
  { id: 'experience', label: 'Choix d\'expérience' },
  { id: 'invariant', label: 'Invariant d\'un ticket' },
  { id: 'contradiction', label: 'Décision déjà prise contredite' },
  { id: 'spend', label: 'Dépense ou action externe' },
  { id: 'reread', label: 'Relecture après la fusion' },
] as const

export type AutonomyCaseId = (typeof AUTONOMY_CASES)[number]['id']

/** L'état de chaque case : vrai seulement pour une case cochée lue dans un fichier en forme. */
export type AutonomyCases = Record<AutonomyCaseId, boolean>

/** La seule version que le code lit et écrit. */
const AUTONOMY_VERSION = 1

/**
 * Ce que donne une lecture : `never`, aucun fichier (jamais réglé) ; `read`, un fichier en forme (`extra` : les cases
 * inconnues du code, gardées telles quelles à la réécriture) ; `unread`, tout autre cas, cinq cases décochées, avec sa
 * raison : `form`, un texte hors forme (`text`, à mettre de côté avant d'écrire) ; `read`, une lecture qui lève (dossier
 * personnel illisible, moteur muet compris) ; `repo`, un projet hors git.
 */
export type AutonomyRead =
  | { state: 'never' | 'read'; cases: AutonomyCases; extra: Record<string, unknown> }
  | { state: 'unread'; cases: AutonomyCases; why: 'form'; text: string }
  | { state: 'unread'; cases: AutonomyCases; why: 'read' | 'repo' }

/** Ce qu'a rendu le disque : rien (fichier absent) ou le texte du fichier. */
export type AutonomyStored = { kind: 'absent' } | { kind: 'text'; text: string }

/** Les cinq cases décochées, un objet neuf à chaque appel. */
const noAutonomy = (): AutonomyCases => ({ experience: false, invariant: false, contradiction: false, spend: false, reread: false })

const isCaseId = (key: string): key is AutonomyCaseId => AUTONOMY_CASES.some(c => c.id === key)

/** Une lecture illisible : cinq cases décochées. */
export const unreadAutonomy = (why: 'read' | 'repo'): AutonomyRead => ({ state: 'unread', cases: noAutonomy(), why })

/**
 * Lit les cases d'après ce qu'a rendu le disque. `isOwnRoot` dit si la racine écrite est celle du projet. Un fichier
 * absent : jamais réglé ; tout écart à la forme : illisible ; une case connue absente du fichier : décochée.
 */
export const parseAutonomySetting = (stored: AutonomyStored, isOwnRoot: (root: string) => boolean): AutonomyRead => {
  if (stored.kind === 'absent') return { state: 'never', cases: noAutonomy(), extra: {} }
  const text = stored.text
  const unread: AutonomyRead = { state: 'unread', cases: noAutonomy(), why: 'form', text }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return unread
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return unread
  const x = raw as { v?: unknown; root?: unknown; cases?: unknown }
  if (x.v !== AUTONOMY_VERSION) return unread
  if (typeof x.root !== 'string' || !isOwnRoot(x.root)) return unread
  if (typeof x.cases !== 'object' || x.cases === null || Array.isArray(x.cases)) return unread
  const cases = noAutonomy()
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(x.cases as Record<string, unknown>)) {
    // Une clé « __proto__ » ne se garde pas : posée, elle changerait le prototype de l'objet gardé.
    if (key === '__proto__') continue
    if (!isCaseId(key)) {
      extra[key] = value
      continue
    }
    if (typeof value !== 'boolean') return unread
    cases[key] = value
  }
  return { state: 'read', cases, extra }
}

/** Ce que l'écriture pose : la valeur entière, les cases inconnues du code d'abord, les cinq connues ensuite. */
export const autonomyRecord = (root: string, cases: AutonomyCases, extra: Record<string, unknown>, at: number) => ({
  v: AUTONOMY_VERSION,
  root,
  cases: { ...extra, ...cases },
  at,
})

/** Le message d'un clic non enregistré, à l'état relu de la case (« reste cochée » ou « reste décochée »). */
export const autonomyKeptText = (id: AutonomyCaseId, isChecked: boolean): string =>
  `Réglage non enregistré : la case « ${AUTONOMY_CASES.find(c => c.id === id)!.label} » reste ${isChecked ? 'cochée' : 'décochée'}.`
