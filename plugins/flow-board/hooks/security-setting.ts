// Le réglage « revue de sécurité » d'un projet, gardé sur le poste : sa lecture, pure, et ses textes.
// Invariant : la revue d'un projet où la personne l'a activée n'est jamais désactivée sans un clic d'elle.
// D'où : seul un fichier absent vaut « désactivée » (jamais réglé), l'absence constatée par la liste de son
// dossier après une lecture ratée ; ce fichier est le même pour toutes les discussions du poste, quel que soit
// l'emplacement du mod (le dossier personnel, `securityHome` dans `register.tsx`). Tout autre doute (lecture qui
// lève sur un fichier présent ou un dossier illisible, dossier personnel qui ne se lit pas, texte vide, JSON
// abîmé, valeur inconnue, racine absente ou d'un autre projet) vaut `unread`, que chaque lecteur traite comme
// « activée ». Les lectures et l'écriture vivent dans `register.tsx`.

/** L'état lu : `unread` vaut « activée » partout où une décision le lit. */
export type SecurityReview = 'on' | 'off' | 'unread'

/**
 * Ce que donne une lecture : l'état, et pour `unread` sa raison : `form`, le texte s'est lu mais il est hors
 * forme (`text`, à mettre de côté avant d'écrire) ; `read`, la lecture a levé (le moteur qui ne répond pas
 * sur le dépôt compris) ; `repo`, un projet hors git, sans clé. Sur `read` et `repo`, le bouton n'écrit rien.
 */
export type SecuritySettingRead = { review: 'on' | 'off' } | { review: 'unread'; why: 'form'; text: string } | { review: 'unread'; why: 'read' | 'repo' }

/** Ce qu'a rendu le stockage : rien (fichier absent), le texte d'un fichier, ou la valeur de `$.store`. */
export type SecurityStored = { kind: 'absent' } | { kind: 'text'; text: string } | { kind: 'value'; value: unknown }


/**
 * Lit le réglage d'après ce qu'a rendu le stockage. `isOwnRoot` dit si la racine écrite est celle du projet.
 * Une valeur de `$.store` absente vaut un fichier absent ; une date de clic (`at`) n'influe jamais sur l'état.
 */
export const parseSecuritySetting = (stored: SecurityStored, isOwnRoot: (root: string) => boolean): SecuritySettingRead => {
  if (stored.kind === 'absent') return { review: 'off' }
  let raw: unknown
  let text: string
  if (stored.kind === 'text') {
    text = stored.text
    if (text.trim() === '') return { review: 'unread', why: 'form', text }
    try {
      raw = JSON.parse(text)
    } catch {
      return { review: 'unread', why: 'form', text }
    }
  } else {
    // Seule une clé jamais posée vaut « jamais réglé » : le mod n'écrit jamais `null`, qui est donc hors forme.
    if (stored.value === undefined) return { review: 'off' }
    raw = stored.value
    // Le texte mis de côté au clic : une chaîne telle quelle, toute autre valeur en JSON.
    try {
      text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    } catch {
      text = String(raw)
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { review: 'unread', why: 'form', text }
  const x = raw as { root?: unknown; review?: unknown }
  if (typeof x.root !== 'string' || !isOwnRoot(x.root)) return { review: 'unread', why: 'form', text }
  return x.review === 'on' || x.review === 'off' ? { review: x.review } : { review: 'unread', why: 'form', text }
}

/** Ce que le bouton écrit : la valeur entière, chaque clic la pose (le dernier l'emporte). */
export const securitySettingRecord = (root: string, review: 'on' | 'off', at: number) => ({ v: 1, root, review, at })

/** Le libellé de la bascule : une lecture ratée se montre « activée ». */
export const securityToggleLabel = (review: SecurityReview): string => ['⛨', 'Sécurité', ':', review === 'off' ? 'désactivée' : 'activée'].join(NB)

/** L'espace insécable des libellés de bouton. */
const NB = String.fromCodePoint(0xa0)

/** L'état que vise un clic sur la bascule : l'inverse de ce qu'elle montre. */
export const securityToggleTarget = (review: SecurityReview): 'on' | 'off' => (review === 'off' ? 'on' : 'off')

/** La ligne ambre d'une lecture ratée. */
export const SECURITY_UNREAD_FR = 'Réglage de la revue de sécurité illisible : revue considérée comme activée'
