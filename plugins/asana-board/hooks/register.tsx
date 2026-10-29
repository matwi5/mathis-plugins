// Panneau Asana (/asana, /asana-board:asana) et son bandeau au-dessus du prompt : les tâches
// non terminées de la section Asana du projet, rangées par la ligne « Statut : » (format
// du skill asana-board:suivi-asana), avec de quoi les créer, modifier, cocher, commenter ou supprimer.
// C'est le mod qui appelle Asana : en mode automatique, chaque outil appelé doit être
// autorisé dans permissions.allow (le classifieur ne juge que les demandes du modèle).
//
// Ce fichier tient tout ce qui passe par `$` : l'état, les hooks, les lectures et écritures
// Asana. Le dessin est dans view.tsx, les règles de rangement dans model.ts.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AsanaTask, Draft, PanelMeta } from '../types'
import { ASANA_FILES, FIELDS, WRITE_TOOLS, countsOf, describeWrite, findAsana, isoDate, persistedPath, setMe, shortName, statusLine, toTask, withStatut, withWholeStatut } from './model.ts'
import { drawBand, drawPane, drawWrite, kitOf, type Abilities, type Actions, type BandView, type View } from './view.tsx'

const PANE = 'asana'
const PANE_TITLE = 'Asana'
/** La commande déclarée par `commands/asana.md`, préfixée du nom du plugin. */
const STATIC_ASANA = 'asana-board:asana'
/** Arguments de /asana qui ne sont pas un dossier : les onglets du filtre. */
const TABS = ['tous', 'toi', 'claude']
/** Délais des nouveaux essais quand le connecteur Asana n'est pas encore là au démarrage. */
const RETRIES = [5_000, 15_000, 45_000]
// Le contrat des surfaces (Elements du moteur) : Svg sur les surfaces distantes, Input et
// Select partout sauf le mobile. La table de `$.ui.resolve` porte tous les noms (un absent
// y dessine un fragment vide) : c'est donc la surface qui dit ce qui se dessine vraiment.
const SVG_SURFACES = new Set(['desktop', 'vscode', 'mobile'])
const FIELD_SURFACES = new Set(['terminal', 'desktop', 'vscode'])
const abilitiesOf = (surface: string): Abilities => ({ isRich: SVG_SURFACES.has(surface), hasFields: FIELD_SURFACES.has(surface) })

const EMPTY_META: PanelMeta = {
  folder: null,
  section: null,
  sectionGid: null,
  projectGid: null,
  server: null,
  loading: null,
  error: null,
  warning: null,
  loadedAt: null,
}
const EMPTY_DRAFT: Draft = { name: '', statut: 'à faire', who: 'claude', where: 'section', contexte: '', fini: '', due: '' }

// Gardés par l'hôte pour la session : ils survivent au rechargement à chaud du module,
// pas à une nouvelle discussion.
const tasks = atom({ plugin: 'asana-board', key: 'tasks' } as const, [])
const meta = atom({ plugin: 'asana-board', key: 'meta' } as const, EMPTY_META)
const expanded = atom({ plugin: 'asana-board', key: 'expanded' } as const, [])
const showDone = atom({ plugin: 'asana-board', key: 'showDone' } as const, false)
// Groupes repliés ; « En attente d'autres » l'est d'abord : rien à y faire soi-même.
const collapsed = atom({ plugin: 'asana-board', key: 'collapsed' } as const, ['attente'])
const who = atom({ plugin: 'asana-board', key: 'who' } as const, 'tous')
const notice = atom({ plugin: 'asana-board', key: 'notice' } as const, null)
const editing = atom({ plugin: 'asana-board', key: 'editing' } as const, null as string | null)
const confirmDelete = atom({ plugin: 'asana-board', key: 'confirmDelete' } as const, null as string | null)
const creating = atom({ plugin: 'asana-board', key: 'creating' } as const, false)
const draft = atom({ plugin: 'asana-board', key: 'draft' } as const, EMPTY_DRAFT)
// Bandeau masqué par « x » ou /asana hide : le temps de la session, comme flow-board.
const isBandHidden = atom({ plugin: 'asana-board', key: 'isBandHidden' } as const, false)
// Tâches (gid, ou « new » pour le formulaire) dont une écriture est en cours : un second appui attend.
const busy = atom({ plugin: 'asana-board', key: 'busy' } as const, [] as string[])
// Groupes dépliés en entier (« ▸ tout voir »).
const showAll = atom({ plugin: 'asana-board', key: 'showAll' } as const, [] as string[])

// Écritures en cours depuis le panneau : elles ne doivent pas relancer une lecture
// complète comme celles de Claude.
let ownWrites = 0
// Secondes écoulées, pour le rythme des redessins.
let ticks = 0
// La lecture en cours, s'il y en a une : jamais deux lectures en même temps. Une variable
// de module, et non un atom : un rechargement à chaud annule les attentes de l'ancien code,
// elle repart donc à null avec lui au lieu de rester bloquée.
let inflight: { dir: string; isQuiet: boolean; done: Promise<boolean> } | null = null

/** Un effet d'interface raté (pas d'écran, surface sans panneau) ne doit jamais gêner le reste. */
const quietly = async (effect: () => unknown) => {
  try {
    await effect()
  } catch {
    // Rien à afficher ici : l'état, lui, est déjà écrit.
  }
}

const toast = ($: any, text: string) => quietly(() => $.ui.toast(text))

const named = (t: AsanaTask) => {
  const name = shortName(t.name)
  return `« ${name.length > 40 ? `${name.slice(0, 39)}…` : name} »`
}

// ─── Lecture ────────────────────────────────────────────────────────────────

const dirOf = async ($: any, folder: string | null): Promise<string> => String(folder ?? (await $.session.cwd())).replace(/[\\/]+$/, '')

/**
 * Lit la section et ses tâches ; vrai si la lecture a réussi. `isQuiet` : une lecture lancée
 * sans action de la personne (démarrage, relecture après un outil de Claude). Son échec ne
 * laisse aucune trace : ni erreur dans le panneau, ni toast, ni ligne d'état ; seule une
 * lecture demandée (/asana, ↻) montre son erreur.
 *
 * Une lecture déjà en cours est attendue plutôt que doublée. Une lecture demandée ne repart
 * ensuite que si celle-là n'a pas fait son travail : autre dossier, ou lecture de fond
 * échouée en silence (il faut alors montrer l'erreur).
 */
async function load($: any, folder: string | null, isQuiet = false): Promise<boolean> {
  const dir = await dirOf($, folder)
  while (inflight) {
    const running = inflight
    const isOk = await running.done
    if (isQuiet) return isOk
    if (running.dir === dir && (isOk || !running.isQuiet)) return isOk
  }
  const done = readSection($, dir, isQuiet).catch(() => false)
  inflight = { dir, isQuiet, done }
  try {
    return await done
  } finally {
    if (inflight?.done === done) inflight = null
  }
}

let isMeKnown = false

async function readSection($: any, dir: string, isQuiet: boolean): Promise<boolean> {
  const say = (loading: string | null, extra: Partial<PanelMeta> = {}) => update($, meta, m => ({ ...m, ...extra, folder: dir, loading }))
  let missed = 0
  // Asana répond parfois 500 sous la charge : une pause, un second essai, puis on
  // garde la tâche sans ses détails plutôt que de tout abandonner.
  const tryTwice = async (tool: string, args: Record<string, unknown>) => {
    try {
      return await asana($, server!, tool, args)
    } catch {
      await $.clock.sleep(1500)
      try {
        return await asana($, server!, tool, args)
      } catch {
        missed += 1
        return null
      }
    }
  }
  let server: string | null = null
  try {
    await say('Lecture du projet…',isQuiet ? {} : { error: null, warning: null })
    const target = findAsana(await readProjectFiles($, dir))
    if (!target) throw new Error(`Pas de section Asana dans ${dir} (${ASANA_FILES.join(', ')}).`)
    server = await asanaServer($)
    if (!server) throw new Error('Connecteur Asana introuvable dans cette session.')
    // Le titulaire du compte, une fois par session : un échec laisse ses tâches sans « Toi ».
    if (!isMeKnown) {
      const who = await asana($, server, 'get_me', {}).catch(() => null)
      if (who?.data?.name) {
        setMe(who.data.name)
        isMeKnown = true
      }
    }
    await say('Lecture de la section…', { ...target, server })

    // Les tâches terminées ne sont pas chargées : Asana rend les tâches non terminées
    // plus celles terminées depuis `completed_since`, ici maintenant.
    const top = await asana($, server, 'get_tasks', {
      section: target.sectionGid,
      completed_since: new Date(await $.clock.now()).toISOString(),
      opt_fields: FIELDS,
      limit: 100,
    })
    const all: AsanaTask[] = (top.data ?? []).map((t: any) => toTask(t, null))
    // Les sous-tâches ne sont pas dans la section : on les lit sous chaque parent, sur deux niveaux.
    let parents = all.filter(t => t.childCount > 0)
    for (let depth = 0; depth < 2 && parents.length > 0; depth++) {
      const children: { gid: string; name: string; parent: AsanaTask }[] = []
      let p = 0
      for (const parent of parents) {
        p += 1
        await say(`Lecture des sous-tâches… parent ${p} / ${parents.length}`)
        const d = await tryTwice('get_task', { task_id: parent.gid, include_comments: false, opt_fields: 'subtasks.name,subtasks.completed' })
        // Sous-tâches terminées écartées avant d'en lire le détail.
        for (const s of d?.data?.subtasks ?? []) if (!s.completed) children.push({ gid: s.gid, name: s.name, parent })
      }
      let n = 0
      const details = await pool(children, 4, async c => {
        const d = await tryTwice('get_task', {
          task_id: c.gid,
          include_comments: false,
          include_subtasks: false,
          opt_fields: FIELDS,
        })
        n += 1
        if (n % 5 === 0 || n === children.length) await say(`Lecture des sous-tâches… ${n} / ${children.length}`)
        return toTask(d?.data ?? { gid: c.gid, name: c.name, notes: '_Détails illisibles : Asana a répondu une erreur. ↻ pour réessayer._' }, c.parent)
      })
      all.push(...details)
      parents = details.filter(t => t.childCount > 0)
    }
    // Une tâche peut être à la fois dans la section et sous une tâche mère : une seule fois.
    const seen = new Set<string>()
    const unique = all.filter(t => !seen.has(t.gid) && seen.add(t.gid))
    await update($, tasks, () => unique)
    await say(null, {
      loadedAt: await $.clock.now(),
      error: null,
      warning: missed > 0 ? `${missed} lecture(s) Asana en échec : ces tâches s'affichent sans leurs détails. ↻ pour réessayer.` : null,
    })
    await syncStatus($)
    return true
  } catch (err: any) {
    // L'ancienne liste reste affichée : une erreur ne vide pas `tasks`.
    await say(null, isQuiet ? {} : { error: String(err?.message ?? err) })
    return false
  }
}

/**
 * Au démarrage, en arrière-plan : si le CLAUDE.md du dossier nomme une section Asana, une
 * lecture silencieuse remplit le bandeau. Connecteur pas encore là : nouvel essai après
 * 5 s, 15 s puis 45 s, puis abandon sans un mot. Pas de section : rien, aucun appel.
 */
async function warmUp($: any, cwd: string, attempt: number) {
  try {
    const dir = cwd.replace(/[\\/]+$/, '')
    const m = await read($, meta)
    // Une lecture tourne, ou a déjà réussi : rien à faire. Une lecture demandée sur un autre
    // dossier fait foi. Une lecture demandée ratée sur ce dossier (connecteur pas encore là,
    // par exemple) n'arrête pas les essais : le connecteur arrivé, le panneau se remplit.
    if (inflight || m.loadedAt !== null || (m.folder !== null && m.folder !== dir)) return
    if (!findAsana(await readProjectFiles($, dir))) return
    const server = await asanaServer($).catch(() => null)
    if (!server) {
      const delay = RETRIES[attempt]
      if (delay !== undefined) $.clock.after(delay, () => void warmUp($, cwd, attempt + 1))
      return
    }
    await load($, dir, true)
  } catch {
    // Démarrage en arrière-plan : un échec ne se montre pas.
  }
}

// Les fichiers où un projet nomme sa section Asana ; un fichier absent compte pour vide.
async function readProjectFiles($: any, dir: string): Promise<string[]> {
  return Promise.all(ASANA_FILES.map(f => $.fs.read(`${dir}/${f}`).then(String).catch(() => '')))
}

// Le connecteur Asana porte un nom propre à chaque compte : on le retrouve par ses outils.
async function asanaServer($: any): Promise<string | null> {
  const list: { name: string; mcp: boolean }[] = await $.tool.list()
  const names = new Set(list.map(t => t.name))
  const hit = list.find(t => t.mcp && t.name.endsWith('__get_tasks') && names.has(t.name.replace(/__get_tasks$/, '__update_tasks')))
  return hit ? hit.name.slice('mcp__'.length, -'__get_tasks'.length) : null
}

async function asana($: any, server: string, tool: string, args: Record<string, unknown>) {
  // En mode automatique, l'appel passe par le classifieur, qui ne juge que les
  // demandes du modèle : il faut une règle permissions.allow pour l'outil.
  const r = await $.mcp.call(server, tool, args)
  let text = (r.content ?? []).map((c: any) => c.text ?? '').join('')
  // Réponse trop longue : le moteur l'a rangée dans un fichier, on la relit là. Son message
  // commence par « Error: » : il passe avant le test d'erreur, au cas où il serait marqué comme tel.
  const saved = persistedPath(text)
  if (saved) text = String(await $.fs.read(saved))
  else if (r.isError) throw new Error(`Asana (${tool}) : ${text.slice(0, 200)}`)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Asana (${tool}) : réponse illisible (${text.trim().slice(0, 80)}…)`)
  }
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await work(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane))
  return out
}

// ─── Bandeau masqué : la ligne d'état prend le relais ──────────────────────

/** La ligne d'état sous le prompt ne sert que quand le bandeau est masqué. */
async function syncStatus($: any) {
  const hidden = await read($, isBandHidden)
  const m = await read($, meta)
  if (!hidden || m.loadedAt === null) {
    await quietly(() => $.ui.status(undefined))
    return
  }
  const counts = countsOf(await read($, tasks), await $.clock.now())
  await quietly(() => $.ui.status(statusLine(m.section, counts)))
}

// ─── Écritures ──────────────────────────────────────────────────────────────

/** Réserve une tâche pour une écriture ; faux si une écriture y est déjà en cours (double appui). */
async function claim($: any, gid: string): Promise<boolean> {
  let isMine = false
  await update($, busy, ids => {
    isMine = !ids.includes(gid)
    return isMine ? [...ids, gid] : ids
  })
  return isMine
}

const release = ($: any, gid: string) => update($, busy, ids => ids.filter(id => id !== gid))

// Une écriture du panneau : l'appel, la relecture de la tâche, puis un toast. Une erreur
// reste aussi sous la tâche (le toast passe, le message reste lisible).
async function act($: any, t: AsanaTask, done: string | (() => string), write: (server: string) => Promise<unknown>) {
  const { server } = await read($, meta)
  if (!server) return
  if (!(await claim($, t.gid))) return toast($, `${named(t)} : écriture déjà en cours, attends sa fin`)
  ownWrites += 1
  try {
    await write(server)
    const d = await asana($, server, 'get_task', {
      task_id: t.gid,
      include_comments: false,
      include_subtasks: false,
      opt_fields: FIELDS,
    })
    const fresh = { ...toTask(d.data, null), parent: t.parent, parentName: t.parentName }
    await update($, tasks, list => list.map(x => (x.gid === t.gid ? fresh : x)))
    await update($, notice, n => (n?.gid === t.gid ? null : n))
    // Le retour sous la tâche se perdrait quand elle change de groupe : un toast.
    await toast($, `${named(t)} : ${typeof done === 'function' ? done() : done}`)
  } catch (err: any) {
    await failed($, t, err)
  } finally {
    ownWrites -= 1
    await release($, t.gid)
    await syncStatus($)
  }
}

/** Le début lisible d'un message d'erreur : sans le JSON renvoyé par Asana, 80 caractères au plus. */
const brief = (text: string): string => {
  const head = text.split(/\s[{[]/)[0]!.replace(/\s*:\s*$/, '').trim()
  return head.length > 80 ? `${head.slice(0, 79)}…` : head
}

/**
 * Une écriture refusée : le détail complet reste sous la tâche, dépliée pour qu'il se voie ;
 * le toast, fait pour une phrase courte, n'en garde que le début.
 */
async function failed($: any, t: AsanaTask, err: any) {
  const text = String(err?.message ?? err)
  const head = brief(text)
  await update($, notice, () => ({ gid: t.gid, text, isError: true }))
  await update($, expanded, ids => (ids.includes(t.gid) ? ids : [...ids, t.gid]))
  await toast($, `${named(t)} : ${head}${head === text ? '' : ' (détail sous la tâche)'}`)
}

// update_tasks répond même quand la modification échoue : on lit « failed ».
async function writeTask($: any, server: string, change: Record<string, unknown>) {
  const r = await asana($, server, 'update_tasks', { tasks: [change] })
  if (r?.failed?.length) throw new Error(`Asana a refusé : ${JSON.stringify(r.failed[0]?.errors ?? r.failed[0]).slice(0, 200)}`)
  return r
}

// La description relue juste avant d'écrire : elle a pu changer depuis la lecture du panneau.
// Le panneau écrit du texte brut : une description mise en forme dans Asana (gras,
// listes…) perdrait sa forme, donc on refuse plutôt que de l'aplatir.
async function freshNotes($: any, server: string, gid: string): Promise<string> {
  const d = await asana($, server, 'get_task', { task_id: gid, include_comments: false, include_subtasks: false, opt_fields: 'notes,html_notes' })
  if (/<(strong|em|u|s|code|ul|ol|li|h1|h2|blockquote|pre|table|a|img)\b/.test(d.data?.html_notes ?? '')) {
    throw new Error('Description mise en forme dans Asana : modifie-la dans Asana pour ne pas perdre la mise en forme.')
  }
  return d.data?.notes ?? ''
}

/**
 * La coche et la ligne « Statut : » dans la même écriture. Une description mise en forme dans
 * Asana ne se réécrit pas (voir `freshNotes`) : la tâche est cochée quand même, sans son statut.
 */
async function closingChange($: any, server: string, t: AsanaTask, completed: boolean, value: string) {
  try {
    return { change: { task: t.gid, completed, notes: withWholeStatut(await freshNotes($, server, t.gid), value) }, note: '' }
  } catch (err: any) {
    if (!/mise en forme/.test(String(err?.message))) throw err
    return { change: { task: t.gid, completed }, note: ' (statut inchangé : description mise en forme dans Asana)' }
  }
}

function writeDone($: any, t: AsanaTask, completed: boolean) {
  let note = ''
  return act($, t, () => `${completed ? 'cochée ✓' : 'décochée'}${note}`, async server => {
    const closing = await closingChange($, server, t, completed, completed ? 'fait' : 'à faire')
    note = closing.note
    await writeTask($, server, closing.change)
  })
}

function writeStatut($: any, t: AsanaTask, value: string) {
  // Une valeur « =… » décrit le statut actuel (prêt, sans statut) : rien à écrire.
  if (value.startsWith('=')) return
  return act($, t, `statut : ${value}`, async server => {
    await writeTask($, server, { task: t.gid, notes: withStatut(await freshNotes($, server, t.gid), value) })
  })
}

function writeAssignee($: any, t: AsanaTask, assignee: string | null) {
  return act($, t, assignee ? 'assignée à toi' : 'confiée à Claude (non assignée)', server => writeTask($, server, { task: t.gid, assignee }))
}

function writeComment($: any, t: AsanaTask, text: string) {
  if (!text.trim()) return
  return act($, t, 'commentaire ajouté', server => asana($, server, 'add_comment', { task_id: t.gid, text: text.trim() }))
}

function writeName($: any, t: AsanaTask, name: string) {
  if (!name.trim() || name.trim() === t.name) return
  return act($, t, 'titre enregistré', server => writeTask($, server, { task: t.gid, name: name.trim() }))
}

function writeDue($: any, t: AsanaTask, text: string) {
  return act($, t, 'échéance enregistrée', server => writeTask($, server, { task: t.gid, due_on: isoDate(text) }))
}

// Remplace une ligne de la description (null la retire), retrouvée telle qu'affichée.
function writeLine($: any, t: AsanaTask, before: string, after: string | null) {
  if (after === before) return
  return act($, t, after === null ? 'ligne retirée' : 'ligne enregistrée', async server => {
    const lines = (await freshNotes($, server, t.gid)).split('\n')
    const i = lines.indexOf(before)
    if (i < 0) throw new Error('La description a changé dans Asana : ↻ puis recommence.')
    if (after === null) lines.splice(i, 1)
    else lines[i] = after
    await writeTask($, server, { task: t.gid, notes: lines.join('\n') })
  })
}

function appendLine($: any, t: AsanaTask, text: string) {
  if (!text.trim()) return
  return act($, t, 'ligne ajoutée', async server => {
    const notes = (await freshNotes($, server, t.gid)).replace(/\s+$/, '')
    await writeTask($, server, { task: t.gid, notes: notes ? `${notes}\n${text.trim()}` : text.trim() })
  })
}

// Abandonner garde une trace : la tâche est cochée avec un commentaire.
function writeAbandon($: any, t: AsanaTask) {
  let note = ''
  return act($, t, () => `abandonnée (cochée, avec un commentaire)${note}`, async server => {
    const closing = await closingChange($, server, t, true, 'abandonnée')
    note = closing.note
    await asana($, server, 'add_comment', { task_id: t.gid, text: 'Abandonnée depuis le panneau Asana de Claude Code.' })
    await writeTask($, server, closing.change)
  })
}

async function deleteTask($: any, t: AsanaTask) {
  const { server } = await read($, meta)
  if (!server) return
  if (!(await claim($, t.gid))) return toast($, `${named(t)} : écriture déjà en cours, attends sa fin`)
  ownWrites += 1
  try {
    await asana($, server, 'delete_task', { task: t.gid })
    await update($, tasks, list => list.filter(x => x.gid !== t.gid && x.parent !== t.gid))
    await update($, confirmDelete, () => null)
    await toast($, `Tâche supprimée : ${named(t)}`)
  } catch (err: any) {
    await failed($, t, err)
  } finally {
    ownWrites -= 1
    await release($, t.gid)
    await syncStatus($)
  }
}

// Crée la tâche du formulaire, au format du skill asana-board:suivi-asana.
async function createTask($: any) {
  const d = await read($, draft)
  const m = await read($, meta)
  const fail = (text: string) => update($, notice, () => ({ gid: 'new', text, isError: true }))
  if (!m.server) return
  if (!d.name.trim()) return fail('Le titre est obligatoire.')
  let due: string | null
  try {
    due = isoDate(d.due)
  } catch (err: any) {
    return fail(String(err.message))
  }
  const notes = [
    `Statut : ${d.statut}`,
    d.contexte.trim() && `Contexte : ${d.contexte.trim()}`,
    d.fini.trim() && `Fini quand : ${d.fini.trim()}`,
    'Origine : panneau Asana (Claude Code)',
  ]
    .filter(Boolean)
    .join('\n')
  const name = /^\[/.test(d.name.trim()) ? d.name.trim() : `[code] ${d.name.trim()}`
  const task: Record<string, unknown> = { name, notes }
  if (d.who === 'toi') task.assignee = 'me'
  if (due) task.due_on = due
  if (d.where === 'section') {
    if (!m.projectGid || !m.sectionGid) return fail('Projet ou section introuvable dans le CLAUDE.md.')
    task.project_id = m.projectGid
    task.section_id = m.sectionGid
  } else {
    task.parent = d.where
  }
  if (!(await claim($, 'new'))) return toast($, 'Création déjà en cours, attends sa fin')
  ownWrites += 1
  try {
    // Pas de champ personnalisé : le plan gratuit les refuse (references/conventions.md du
    // skill asana-board:suivi-asana). create_tasks rend les tâches créées dans `data` et les refus dans `failed`.
    const created = (res: any): any[] => res?.data ?? res?.succeeded ?? []
    const r = await asana($, m.server, 'create_tasks', { tasks: [task] })
    if (!created(r).length) throw new Error(`Asana a refusé : ${JSON.stringify(r?.failed?.[0] ?? r).slice(0, 200)}`)
    const gid = created(r)[0]?.gid ?? created(r)[0]?.task?.gid
    if (gid) {
      const fresh = await asana($, m.server, 'get_task', { task_id: gid, include_comments: false, include_subtasks: false, opt_fields: FIELDS })
      const parent = d.where === 'section' ? null : ((await read($, tasks)).find(x => x.gid === d.where) ?? null)
      await update($, tasks, list => [...list, toTask(fresh.data, parent)])
      await update($, expanded, ids => [...ids, gid])
    }
    await update($, draft, () => EMPTY_DRAFT)
    await update($, creating, () => false)
    await update($, notice, n => (n?.gid === 'new' ? null : n))
    await toast($, `Tâche créée ✓ : « ${name.replace(/^\[(code|chat)\]\s*/, '')} »`)
  } catch (err: any) {
    const text = String(err?.message ?? err)
    await fail(text)
    // Le détail reste sous le formulaire, qui reste ouvert ; le toast n'en garde que le début.
    const head = brief(text)
    await toast($, `Création refusée : ${head}${head === text ? '' : ' (détail sous le formulaire)'}`)
  } finally {
    ownWrites -= 1
    await release($, 'new')
    await syncStatus($)
  }
}

/** Remplit le prompt sans l'envoyer : rien ne part sans la personne. */
async function fillPrompt($: any, t: AsanaTask) {
  const text = `Travaille sur la tâche Asana « ${shortName(t.name)} » (gid ${t.gid}). Lis-la d'abord dans Asana.`
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' }))?.isFilled === true
  })
  // Repli actionnable : la demande elle-même, à taper.
  await toast($, isFilled ? 'La demande est dans le prompt : Entrée pour lancer' : `Prompt indisponible. Tape : ${text}`)
}

// ─── Vue et actions ─────────────────────────────────────────────────────────

const readView = async ($: any): Promise<View> => ({
  tasks: await read($, tasks),
  meta: await read($, meta),
  who: await read($, who),
  expanded: await read($, expanded),
  collapsed: await read($, collapsed),
  showDone: await read($, showDone),
  showAll: await read($, showAll),
  notice: await read($, notice),
  editing: await read($, editing),
  confirmDelete: await read($, confirmDelete),
  creating: await read($, creating),
  draft: await read($, draft),
  busy: await read($, busy),
  now: await $.clock.now(),
})

// Le bandeau ne lit que ce qu'il dessine : la chaîne des bandeaux est partagée par les mods.
const readBand = async ($: any, columns: number): Promise<BandView> => ({
  columns,
  tasks: await read($, tasks),
  meta: await read($, meta),
  isBandHidden: await read($, isBandHidden),
  now: await $.clock.now(),
})

const flip = (ids: string[], id: string) => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

const openPane = ($: any) => quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))

const actionsFor = ($: any): Actions => ({
  setWho: (value: string) => update($, who, () => value),
  flipTask: (gid: string) => update($, expanded, ids => flip(ids, gid)),
  flipGroup: (key: string) => update($, collapsed, ids => flip(ids, key)),
  flipDone: () => update($, showDone, v => !v),
  flipAll: (key: string) => update($, showAll, ids => flip(ids, key)),
  toggleCreating: () => update($, creating, v => !v),
  setDraft: (patch: Partial<Draft>) => update($, draft, x => ({ ...x, ...patch })),
  // Annuler vide le brouillon : la prochaine ouverture repart d'un formulaire neuf.
  cancelCreate: async () => {
    await update($, draft, () => EMPTY_DRAFT)
    await update($, creating, () => false)
    await update($, notice, n => (n?.gid === 'new' ? null : n))
  },
  create: () => createTask($),
  // Pendant une lecture, ↻ l'attend au lieu d'en lancer une seconde (voir `load`).
  refresh: async () => {
    await load($, (await read($, meta)).folder)
  },
  setDone: (t, completed) => writeDone($, t, completed),
  setStatut: (t, value) => writeStatut($, t, value),
  assign: (t, assignee) => writeAssignee($, t, assignee),
  work: t => fillPrompt($, t),
  comment: (t, text) => writeComment($, t, text),
  startEdit: (gid: string) => update($, editing, () => gid),
  endEdit: () => update($, editing, () => null),
  rename: (t, name) => writeName($, t, name),
  setDue: (t, text) => writeDue($, t, text),
  editLine: (t, before, after) => writeLine($, t, before, after),
  addLine: (t, text) => appendLine($, t, text),
  abandon: t => writeAbandon($, t),
  askDelete: (gid: string) => update($, confirmDelete, () => gid),
  cancelDelete: () => update($, confirmDelete, () => null),
  remove: t => deleteTask($, t),
  hideBand: async () => {
    await update($, isBandHidden, () => true)
    await syncStatus($)
    await toast($, 'Bandeau Asana masqué : /asana show pour le réafficher')
  },
  openPane: () => openPane($),
  copyLink: (url, surface) => copyLink($, url, surface),
})

/** Copie l'adresse d'une tâche dans le presse-papiers de la surface pressée et le dit ; sans copie, le toast donne l'adresse à recopier. */
const copyLink = async ($: any, url: string, surface?: string) => {
  let done: { isCopied?: boolean } | null = null
  try {
    done = await $.ui.copy({ text: url, ...(surface ? { surface } : {}) })
  } catch {
    // Le toast donne alors l'adresse à recopier.
  }
  await toast($, done?.isCopied ? 'Lien Asana copié' : `Copie impossible : ${url}`)
}

/** Redessine pour faire avancer les âges et le spinner : 5 s pendant une activité, 30 s au repos. */
const tick = async ($: any) => {
  ticks += 1
  const m = await read($, meta)
  if (m.loadedAt === null && !m.loading) return
  const isBusy = m.loading !== null || (await read($, busy)).length > 0
  if (ticks % (isBusy ? 5 : 30) === 0) $.ui.invalidate('ui.render')
}

// `/asana` n'existe qu'après le démarrage du mod ; `/asana-board:asana`, déclarée par
// `commands/asana.md`, est connue dès le premier message. Les deux reçoivent la même
// réponse, sans passer par le modèle. Rien ici ne suppose que session.start a tourné.
const answer = async ($: any, e: { args?: string }) => {
  // Un autre plugin peut lancer la commande sans `args` ; tapée, elle reçoit "".
  const raw = (e.args ?? '').trim()
  const arg = raw.toLowerCase()
  if (arg === 'hide') {
    await update($, isBandHidden, () => true)
    await syncStatus($)
    return { text: 'Bandeau Asana masqué (/asana show pour le réafficher).' }
  }
  if (arg === 'show') await update($, isBandHidden, () => false)
  if (TABS.includes(arg)) await update($, who, () => arg)
  const isReserved = arg === 'show' || TABS.includes(arg)
  const folder = (!isReserved && raw) || (await read($, meta)).folder || (await $.session.cwd())
  await openPane($)
  await syncStatus($)
  // Lecture demandée : son erreur s'affiche. La réponse attend la fin de la lecture (une
  // lecture de fond déjà en cours est attendue, pas doublée).
  await load($, folder)
  const m = await read($, meta)
  return { text: m.error ? `Panneau Asana : ${m.error}` : `Panneau Asana ouvert (${m.section}).` }
}

/**
 * Une lecture si longue que le hook dépasse son budget (les pauses entre deux essais y
 * comptent) : sans ce repli, le moteur passerait la main dessous, et pour
 * `/asana-board:asana` le modèle lirait le corps de `commands/asana.md`, « le mod n'est pas
 * chargé », ce qui est faux. Le contrat ne dit pas si la lecture survit au hook abandonné :
 * le texte ne le promet pas, et ↻ la relance (elle n'est pas gardée par `meta.loading`).
 */
const answerLate = async (_$: any, _e: unknown, next: any) => ({
  text:
    next.error?.kind === 'timeout'
      ? 'Lecture Asana trop longue pour attendre ici : le panneau se remplit s’il la termine, sinon ↻ Relire.'
      : `Panneau Asana : ${next.error?.message ?? 'erreur inattendue'}`,
})

// `/asana` reste utilisable tapée en entier, mais sort du menu : `/asana-board:asana`, déjà
// là avant le premier message, y suffit et le doublon disparaît.
const hideDuplicate = async ($: any, e: any, next: any) => ({ ...(await next(e)), isHidden: true })

// ─── Hooks ──────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Après un rechargement à chaud, une écriture ou une lecture coupée en route laisse son
    // atom figé (son `finally` ne tournera plus) : on le libère. Les variables de module,
    // elles, repartent à zéro avec le nouveau code ; tant qu'elles disent que rien ne tourne
    // ici, ce qui reste dans les atoms vient de l'ancien.
    if (ownWrites === 0) await update($, busy, () => [])
    if (!inflight) await update($, meta, m => (m.loading ? { ...m, loading: null } : m))
    // Un enregistrement refusé ne doit pas empêcher la suite (minuterie, lecture de fond).
    await quietly(() =>
      $.command.register({
        name: 'asana',
        description: 'Panneau des tâches Asana du projet : /asana [tous | toi | claude | hide | show | dossier]',
        argumentHint: '[tous|toi|claude|hide|show|dossier du projet]',
      }),
    )
    $.clock.every(1000, () => void tick($))
    // Jamais attendu ici : sur le desktop, la lecture tourne pendant le premier tour.
    $.clock.after(0, () => void warmUp($, e.cwd, 0))
    return next(e)
  })

  on('command.run', { command: 'asana' }, answer).catch(answerLate)
  on('command.describe', { command: 'asana' }, hideDuplicate)
  on('command.run', { command: STATIC_ASANA }, answer).catch(answerLate)

  // Quand Claude modifie Asana pendant la discussion, le panneau se relit (en silence).
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (ownWrites === 0 && WRITE_TOOLS.test(e.tool)) {
      const m = await read($, meta)
      if (m.folder && m.server && !inflight) $.clock.after(0, () => load($, m.folder, true))
    }
    return result
  })

  // Un appel d'écriture de Claude dans Asana : une ligne courte avec le nom des tâches, lu
  // dans celles déjà chargées (aucune relecture), à la place des GID et du JSON. Le résultat
  // (ToolResult) reste celui du moteur. Le nom de l'outil est testé avant toute lecture
  // d'état : chaque ligne d'outil de la session passe par ici, seules celles d'Asana s'abonnent.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (!WRITE_TOOLS.test(p.tool) || p.isErrored || p.isInterrupted) return next(e)
    const names = new Map((await read($, tasks)).map(t => [t.gid, t.name] as const))
    const text = describeWrite(p.tool, p.input, names)
    if (text === null) return next(e)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.viewport?.columns ?? 80, abilitiesOf(e.surface))
    return drawWrite(kit, text, p.isRunning) as any
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await readView($)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, abilitiesOf(e.surface))
    return drawPane(kit, view, actionsFor($)) as any
  })

  // Le bandeau se compose avec ceux des autres mods (flow-board, git-board…) : le leur
  // reste au-dessus, celui d'Asana dessous. Jamais le nôtre seul quand un autre est là.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const view = await readBand($, e.props.bodyColumns)
    if (view.meta.loadedAt === null || view.isBandHidden) return next(e)
    const below = await next(e)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, abilitiesOf(e.surface))
    const own = drawBand(kit, view, actionsFor($)) as any
    if (!own) return below
    if (below.type === 'engine') return own
    const { Box } = kit
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {below}
        {own}
      </Box>
    )
  })
}
