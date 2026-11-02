// La feuille de route du projet, tenue par le Claude du COO : son format strict, sa lecture, et la
// surveillance de ses entrées par le mod, qui ne l'écrit jamais.
//
// Module pur. Invariant : « La feuille de route ne perd jamais une entrée sans ta décision ; une
// disparition est montrée et se répare. » Le mod garde chaque entrée vue avec sa dernière version et
// chacun de ses textes déjà vus (`RoadmapSeen`), jamais effacés ; une entrée absente d'une lecture bien
// formée est une disparition, comme un ancien texte qui n'est plus le texte d'aucune entrée.
//
// Format : un titre `# …` facultatif, puis quatre sections, chacune une fois au plus, dans n'importe
// quel ordre, et des lignes vides :
//
//   ## Jalons
//   - [J1] en cours · 2026-11-02 · Mathis · Le COO suit les missions — fin : chaque mission passe par lui
//   ## Prochaines étapes
//   - [E1] à faire · 2026-11-02 · COO · Lancer le groupe C
//   ## Idées
//   - [I1] à lancer · 2026-11-02 · Mathis · ses mots tels quels
//   ## À reprendre
//   - [R1] à décider · 2026-11-02 · mission « Mode auto », compte rendu · le texte tel qu'écrit
//
// Une entrée : `- [<id>] <statut> · <date AAAA-MM-JJ> · <source> · <texte>`. L'id est stable (une
// lettre majuscule et des chiffres, unique dans le fichier) ; le statut et la source ne contiennent pas
// « · » ; le texte va jusqu'au bout de la ligne.

/**
 * L'exemple du format, recopié tel quel dans les consignes du COO (`skills/coo/SKILL.md`) : un test le
 * lit, un autre vérifie la copie et que chaque statut permis y est nommé.
 */
export const ROADMAP_EXAMPLE = `# Feuille de route

## Jalons
- [J1] en cours · 2026-11-02 · Mathis · Le but du jalon — fin : son critère de fin
## Prochaines étapes
- [E1] à faire · 2026-11-02 · COO · L'étape
## Idées
- [I1] à lancer · 2026-11-02 · Mathis · ses mots tels quels
## À reprendre
- [R1] à décider · 2026-11-02 · mission « Titre », compte rendu · le texte tel qu'il a été écrit
`

/** Les quatre sections, dans l'ordre où la vue les montre. */
export const ROADMAP_SECTIONS = ['Jalons', 'Prochaines étapes', 'Idées', 'À reprendre'] as const
export type RoadmapSection = (typeof ROADMAP_SECTIONS)[number]

/** Les statuts permis par section ; ceux qui finissent par une espace prennent une suite (titre, raison). */
export const ROADMAP_STATUSES: Record<RoadmapSection, readonly string[]> = {
  Jalons: ['à venir', 'en cours', 'atteint'],
  'Prochaines étapes': ['à faire', 'en cours', 'faite', 'abandonnée : '],
  Idées: ['à lancer', 'plus tard', 'devenue mission ', 'écartée : '],
  'À reprendre': ['à décider', 'lancée', 'rattachée à ', 'plus tard', 'écartée : '],
}

export type RoadmapEntry = { id: string; section: RoadmapSection; status: string; date: string; source: string; text: string; line: string }

export type Roadmap = { ok: true; entries: RoadmapEntry[] } | { ok: false; lineNo: number; why: string }

/** La forme d'un id d'entrée : une lettre majuscule, puis un à quatre chiffres. Seule source de cette forme. */
const ID_FORM = '[A-Z][0-9]{1,4}'
const ID = new RegExp(`^${ID_FORM}$`)
/** Un id d'entrée en forme : il entre seul dans une demande au Claude du COO, jamais un texte relu. */
export const isRoadmapId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)

const ENTRY = new RegExp(`^- \\[(${ID_FORM})\\] ([^·]+?) · (\\d{4}-\\d{2}-\\d{2}) · ([^·]+?) · (.+)$`)
const SECTION = /^## (.+)$/

const statusFits = (section: RoadmapSection, status: string): boolean =>
  ROADMAP_STATUSES[section].some(s => (s.endsWith(' ') ? status.startsWith(s) && status.length > s.length : status === s))

/** Lit le fichier : ses entrées, ou la première ligne hors format (rien de faux n'est montré). */
export const parseRoadmap = (text: string): Roadmap => {
  const entries: RoadmapEntry[] = []
  const seenSections = new Set<string>()
  const ids = new Set<string>()
  let section: RoadmapSection | null = null
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const [i, raw] of lines.entries()) {
    const lineNo = i + 1
    const line = raw.trimEnd()
    if (line === '') continue
    if (i === lines.findIndex(l => l.trim() !== '') && /^# \S/.test(line)) continue
    const head = SECTION.exec(line)
    if (head) {
      const name = head[1]!.trim()
      if (!(ROADMAP_SECTIONS as readonly string[]).includes(name)) return { ok: false, lineNo, why: `section inconnue « ${name} »` }
      if (seenSections.has(name)) return { ok: false, lineNo, why: `section « ${name} » en double` }
      seenSections.add(name)
      section = name as RoadmapSection
      continue
    }
    const m = ENTRY.exec(line)
    if (!m) return { ok: false, lineNo, why: 'ligne hors format' }
    if (section === null) return { ok: false, lineNo, why: 'entrée avant toute section' }
    const [, id, status, date, source, body] = m as unknown as [string, string, string, string, string, string]
    if (ids.has(id)) return { ok: false, lineNo, why: `id « ${id} » en double` }
    if (!statusFits(section, status.trim())) return { ok: false, lineNo, why: `statut « ${status.trim()} » inconnu dans « ${section} »` }
    ids.add(id)
    entries.push({ id, section, status: status.trim(), date, source: source.trim(), text: body.trim(), line })
  }
  return { ok: true, entries }
}

/**
 * Ce que le mod garde de chaque entrée vue : sa dernière version, sa section, et quand cette version a
 * été vue pour la première fois (`seenAt`, posé quand la ligne ou la section change : la plus récente
 * l'emporte à l'union) ; et ses textes précédents (`earlier`, absent tant qu'elle n'a eu qu'un texte),
 * chacun avec la dernière ligne qui le portait. Jamais effacé.
 */
export type RoadmapSeen = Record<string, { line: string; section: RoadmapSection; seenAt: number; earlier?: RoadmapText[] }>

/** Un texte d'une entrée, avec la dernière ligne qui le portait, sa section et quand cette ligne a été vue. */
export type RoadmapText = { text: string; line: string; section: RoadmapSection; seenAt: number }

/** Une entrée vue avant et absente de la lecture du moment : montrée en alerte, avec sa dernière version. */
export type RoadmapGone = { id: string; line: string; section: RoadmapSection; seenAt: number }

/** Un texte précédent d'une entrée qui n'est plus nulle part dans le fichier (sous aucun id) : montré en alerte, avec l'id qui le portait. */
export type RoadmapGoneText = RoadmapText & { id: string }

/** L'empreinte d'un texte d'entrée, qui le désigne dans un bouton de la vue (jamais le texte lui-même). */
export const roadmapTextPrint = (text: string): string => {
  let h = 5381
  for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0
  return `t${h.toString(36)}${text.length.toString(36)}`
}

/** Le texte d'une ligne d'entrée gardée (son dernier champ) ; la ligne entière si elle n'a pas la forme d'une entrée. */
const textOfLine = (line: string): string => ENTRY.exec(line)?.[5]?.trim() ?? line

const isSection = (v: unknown): v is RoadmapSection => (ROADMAP_SECTIONS as readonly unknown[]).includes(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Les textes précédents relus, contrôlés : null dès qu'un seul n'a pas sa forme. */
const soundEarlier = (v: unknown): RoadmapText[] | null => {
  if (!Array.isArray(v)) return null
  const out: RoadmapText[] = []
  for (const t of v as unknown[]) {
    const x = t as { text?: unknown; line?: unknown; section?: unknown; seenAt?: unknown } | null
    if (x === null || typeof x !== 'object' || typeof x.text !== 'string' || typeof x.line !== 'string' || !isSection(x.section) || !isTime(x.seenAt)) return null
    out.push({ text: x.text, line: x.line, section: x.section, seenAt: x.seenAt })
  }
  return out
}

/**
 * Les entrées vues relues du stockage, contrôlées : null quand la valeur n'a pas cette forme (une autre
 * version, une écriture coupée), pour qu'elle ne soit ni lue ni réécrite sur un doute. Les deux formes se
 * lisent : avec ou sans textes précédents (une entrée sans eux n'a qu'un texte connu).
 */
export const soundSeen = (v: unknown): RoadmapSeen | null => {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) return null
  const out: RoadmapSeen = {}
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    const x = e as { line?: unknown; section?: unknown; seenAt?: unknown; earlier?: unknown } | null
    if (!isRoadmapId(id) || x === null || typeof x !== 'object' || typeof x.line !== 'string' || !isSection(x.section) || !isTime(x.seenAt)) return null
    const earlier = x.earlier === undefined ? [] : soundEarlier(x.earlier)
    if (earlier === null) return null
    out[id] = { line: x.line, section: x.section, seenAt: x.seenAt, ...(earlier.length > 0 ? { earlier } : {}) }
  }
  return out
}

/**
 * Les entrées vues relues, entrée par entrée : celles qui ont leur forme, et si toutes l'avaient
 * (`isWhole`) ; une entrée dont seuls des textes précédents sont hors forme garde sa dernière version et
 * ses autres textes ; une valeur qui n'est pas un objet n'en donne aucune.
 */
export const partialSeen = (v: unknown): { seen: RoadmapSeen; isWhole: boolean } => {
  if (v === undefined || v === null) return { seen: {}, isWhole: true }
  if (typeof v !== 'object' || Array.isArray(v)) return { seen: {}, isWhole: false }
  const seen: RoadmapSeen = {}
  let isWhole = true
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    const one = soundSeen({ [id]: e })
    if (one) Object.assign(seen, one)
    else {
      isWhole = false
      // Une entrée en forme dont seuls des textes précédents sont hors forme garde sa dernière version et ses autres textes.
      const x = e as { earlier?: unknown } | null
      const bare = x !== null && typeof x === 'object' && !Array.isArray(x) ? soundSeen({ [id]: { ...x, earlier: undefined } }) : null
      if (bare) {
        const earlier = Array.isArray(x!.earlier) ? x!.earlier.flatMap(t => soundEarlier([t]) ?? []) : []
        seen[id] = { ...bare[id]!, ...(earlier.length > 0 ? { earlier } : {}) }
      }
    }
  }
  return { seen, isWhole }
}

/** Chaque texte connu d'une entrée vue : ses textes précédents, puis celui de sa dernière version. */
const textsOf = (e: RoadmapSeen[string]): RoadmapText[] => [...(e.earlier ?? []), { text: textOfLine(e.line), line: e.line, section: e.section, seenAt: e.seenAt }]

/**
 * Une entrée vue dont la dernière version est `current`, avec pour textes précédents tous ceux de `texts`
 * sauf le sien : un même texte n'y paraît qu'une fois, avec la ligne vue le plus récemment, dans l'ordre où
 * ces lignes ont été vues ; absents quand il n'en reste aucun (l'ancienne forme).
 */
const withTexts = (current: RoadmapSeen[string], texts: readonly RoadmapText[]): RoadmapSeen[string] => {
  const own = textOfLine(current.line)
  const byText = new Map<string, RoadmapText>()
  for (const t of texts) if (t.text !== own && (!byText.has(t.text) || t.seenAt > byText.get(t.text)!.seenAt)) byText.set(t.text, t)
  const earlier = [...byText.values()].sort((x, y) => x.seenAt - y.seenAt)
  return { line: current.line, section: current.section, seenAt: current.seenAt, ...(earlier.length > 0 ? { earlier } : {}) }
}

/**
 * L'union de deux copies des entrées vues : rien n'est retiré ; pour un même id, la version vue le plus
 * récemment, et l'union des textes que l'une ou l'autre a vus.
 */
export const unionSeen = (a: RoadmapSeen, b: RoadmapSeen): RoadmapSeen => {
  const out: RoadmapSeen = { ...a }
  for (const [id, e] of Object.entries(b)) {
    const was = out[id]
    if (!was) out[id] = e
    else {
      const current = e.seenAt > was.seenAt ? e : was
      out[id] = was.earlier === undefined && e.earlier === undefined && textOfLine(was.line) === textOfLine(e.line) ? current : withTexts(current, [...textsOf(was), ...textsOf(e)])
    }
  }
  return out
}

/**
 * La lecture du moment confrontée aux entrées déjà vues : une entrée présente dont la ligne ou la section a
 * changé met à jour sa dernière version (une entrée inchangée ne réécrit rien) et, si son texte a changé,
 * garde l'ancien parmi ses textes précédents ; une entrée absente reste gardée telle qu'elle était et
 * paraît dans `gone`. Un texte précédent qui n'est plus le texte d'aucune entrée du fichier paraît dans
 * `goneTexts`, une fois par texte, avec sa version vue le plus récemment (un texte encore présent sous un
 * autre id n'en fait pas partie, ni celui dont une entrée absente de `gone` porte une version au moins
 * aussi récente). Rien n'est jamais retiré de `seen`. Une lecture hors format ne change rien (`seen` rendu
 * tel quel).
 */
export const watchRoadmap = (seen: RoadmapSeen, read: Roadmap, now: number): { seen: RoadmapSeen; gone: RoadmapGone[]; goneTexts: RoadmapGoneText[] } => {
  if (!read.ok) return { seen, gone: [], goneTexts: [] }
  const next: RoadmapSeen = { ...seen }
  const present = new Set<string>()
  for (const e of read.entries) {
    present.add(e.id)
    const was = seen[e.id]
    if (!was) next[e.id] = { line: e.line, section: e.section, seenAt: now }
    else if (was.line !== e.line || was.section !== e.section) next[e.id] = withTexts({ line: e.line, section: e.section, seenAt: now }, textsOf(was))
  }
  const gone = Object.entries(seen)
    .filter(([id]) => !present.has(id))
    .map(([id, v]) => ({ id, line: v.line, section: v.section, seenAt: v.seenAt }))
  // Un texte n'alerte qu'une fois, par sa version vue le plus récemment, sous quelque id qu'elle soit ; pas
  // quand il est dans le fichier, ni quand l'alerte d'une entrée disparue en porte une version au moins aussi récente.
  const inFile = new Set(read.entries.map(e => e.text))
  const goneAt = new Map<string, number>()
  for (const g of gone) {
    const t = textOfLine(g.line)
    goneAt.set(t, Math.max(goneAt.get(t) ?? -Infinity, g.seenAt))
  }
  const latest = new Map<string, RoadmapGoneText>()
  for (const [id, v] of Object.entries(next))
    for (const t of v.earlier ?? []) {
      const was = latest.get(t.text)
      if (!inFile.has(t.text) && (!was || t.seenAt > was.seenAt)) latest.set(t.text, { id, ...t })
    }
  const goneTexts = [...latest.values()].filter(t => (goneAt.get(t.text) ?? -Infinity) < t.seenAt).sort((x, y) => x.seenAt - y.seenAt)
  return { seen: next, gone, goneTexts }
}
