import { describe, expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'asana-board'
const NOW = Date.parse('2026-10-02T12:00:00Z')
const SECTION_MD = 'projet « Suivi » (GID `111`), section « Client · Essai (LLM + API) » (GID `222`).'
const ME = 'Alex Martin'

const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const BANDS = ['terminal', 'desktop'] as const

// Ce que le moteur joint à une commande tapée : d'où elle vient et la taille de l'affichage.
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const PANE = (bodyColumns = 80) =>
  ({
    component: 'Pane',
    requestId: 'asana',
    props: { title: 'Asana', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as any

const BAND = (bodyColumns = 120, hasSurvey = false) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as any

type Raw = Record<string, unknown>

const task = (gid: string, name: string, notes: string, extra: Raw = {}): Raw => ({
  gid,
  name,
  notes,
  completed: false,
  assignee: null,
  num_subtasks: 0,
  ...extra,
})

/** La section du test : une tâche à trancher, un dossier et sa sous-tâche en cours, une à moi en retard, une en attente, une « prêt ». */
const SAMPLE = (): Raw[] => [
  task('t1', '[code] Trancher le filtre', 'Statut : à trancher (John)\nContexte : x'),
  task('p1', '[code] Prochaines sessions', 'Tâche mère.', { num_subtasks: 2 }),
  task('t3', '[code] Relire la spec', 'Statut : à faire', { assignee: { name: ME }, due_on: '2026-09-28' }),
  task('t4', '[code] Attendre le client', 'Statut : en attente (client)'),
  task('t5', '[code] Livrer la démo', 'Statut : prêt'),
]

type WorldOptions = {
  md?: string
  /** Fichiers du projet par fin de chemin ; donné, un fichier absent de la liste n'existe pas. */
  files?: Record<string, string>
  /** Le connecteur est-il là ? Une fonction pour le faire apparaître en cours de route. */
  hasServer?: () => boolean
  sectionTasks?: () => Raw[]
  failGetTasks?: boolean
  /** get_me échoue : le titulaire du compte reste inconnu. */
  failGetMe?: boolean
  /** Le dessous du bandeau : le nœud vide du moteur, ou un autre bandeau. */
  below?: 'engine' | 'other'
  /** Asana lent à répondre aux écritures (millisecondes de l'horloge simulée). */
  writeDelay?: number
  /** Asana lent à rendre les tâches de la section (millisecondes de l'horloge simulée). */
  readDelay?: number
  /** update_tasks répond, mais refuse la modification (avec le JSON d'erreur d'Asana). */
  failWrite?: boolean
  /** Descriptions mises en forme dans Asana (html_notes avec du gras) : le panneau ne les réécrit pas. */
  formatted?: boolean
  /** Le prompt accepte-t-il d'être rempli ? */
  canFill?: boolean
  /** Le dossier de la session est-il illisible ? */
  failCwd?: boolean
  /**
   * get_tasks trop long : le moteur range le JSON dans un fichier et rend, au lieu du JSON,
   * l'encart <persisted-output> (« encart ») ou le message « Error: result … exceeds maximum
   * allowed tokens » (« message »).
   */
  persisted?: 'encart' | 'message'
}

/**
 * Largeur d'un arbre dessiné, en caractères : textes, libellés de boutons et marges ; une
 * Box en colonne prend sa plus large rangée. Sur le terminal, un caractère tient une cellule.
 * `skip` : un texte qui se tronque de lui-même (le nom de section), compté pour zéro.
 */
const widthOf = (node: any, skip = ''): number => {
  if (node === null || node === undefined || node === false) return 0
  if (typeof node === 'string' || typeof node === 'number') return String(node) === skip ? 0 : [...String(node)].length
  if (Array.isArray(node)) return node.reduce((n: number, c: any) => n + widthOf(c, skip), 0)
  const p = node.props ?? {}
  const margins = (p.marginLeft ?? 0) + (p.marginRight ?? 0) + 2 * (p.paddingX ?? 0)
  if (node.type === 'Button') return [...String(p.label ?? '')].length + margins
  const kids: any[] = node.children ?? []
  if (p.flexDirection === 'column') return Math.max(0, ...kids.map(c => widthOf(c, skip))) + margins
  return kids.reduce((n: number, c: any) => n + widthOf(c, skip), 0) + margins
}

// Le fichier où le moteur range une réponse d'outil trop longue (chemin Windows, espaces compris).
const PERSISTED_FILE = String.raw`C:\Users\M B\.claude\projects\p\tool-results\toolu_1.txt`

/** Le monde sous le plugin : moteur, Asana, CLAUDE.md, horloge. Tout ce qui passe est consigné. */
const world = (on: any, options: WorldOptions = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const log = {
    writes: [] as any[],
    reads: [] as string[],
    calls: [] as string[],
    toolLists: 0,
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    opened: [] as string[],
    completedSince: undefined as unknown,
    section: undefined as unknown,
    invalidations: 0,
  }
  const done = new Set<string>()
  // Les descriptions réécrites par le panneau, relues ensuite comme Asana les rendrait.
  const notesOf = new Map<string, string>()
  const hasServer = options.hasServer ?? (() => true)
  on('session.start', (_$: unknown, e: any) => ({ cwd: e.cwd }))
  // Ce que le moteur fait seul : enregistrer la commande, ouvrir le panneau, finir la commande.
  on('command.register', () => ({ value: {} }) as any)
  on('ui.open', (_$: unknown, e: any) => {
    log.opened.push(e.id)
    return { value: { isPlaced: true } } as any
  })
  on('ui.toast', (_$: unknown, e: any) => {
    log.toasts.push(e.text)
    return { value: undefined } as any
  })
  on('ui.status', (_$: unknown, e: any) => {
    log.statuses.push(e.text)
    return { value: undefined } as any
  })
  on('command.run', () => ({ text: '' }))
  on('ui.invalidate', () => {
    log.invalidations += 1
    return { value: undefined } as any
  })
  // Un outil Asana appelé par Claude : le moteur l'exécute, le plugin relit ensuite.
  on('tool.call', () => ({ result: { ok: true } }) as any)
  on('session.cwd', () => {
    if (options.failCwd) throw new Error('cwd indisponible')
    return { value: '/work' } as any
  })
  on('prompt.fill', () => ({ isFilled: options.canFill ?? true }))
  on('fs.read', (_$: unknown, e: any) => {
    // Sur Mac, le moteur ne rend pas un chemin Windows tel quel (il n'y est pas absolu) : on compare la fin.
    if (String(e.path).replace(/\\/g, '/').endsWith('/tool-results/toolu_1.txt')) return { value: JSON.stringify({ data: (options.sectionTasks ?? SAMPLE)() }) } as any
    if (!options.files) return { value: options.md ?? SECTION_MD } as any
    const hit = Object.entries(options.files).find(([end]) => String(e.path).split('\\').join('/').endsWith(end))
    if (!hit) throw new Error(`ENOENT ${e.path}`)
    return { value: hit[1] } as any
  })
  on('tool.list', () => {
    log.toolLists += 1
    return {
      value: hasServer()
        ? [
            { name: 'mcp__srv__get_tasks', description: '', mcp: true },
            { name: 'mcp__srv__update_tasks', description: '', mcp: true },
          ]
        : [],
    } as any
  })
  on('mcp.call', async (_$: unknown, e: any) => {
    log.calls.push(e.tool)
    const reply = (data: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false } }) as any
    const withDone = (t: Raw) => ({
      ...t,
      completed: done.has(String(t.gid)) || t.completed,
      notes: notesOf.get(String(t.gid)) ?? t.notes,
      ...(options.formatted ? { html_notes: `<body><strong>${t.notes}</strong></body>` } : {}),
    })
    const all = (options.sectionTasks ?? SAMPLE)()
    if (e.tool === 'get_me') {
      if (options.failGetMe) return { value: { content: [{ type: 'text', text: 'Internal Server Error' }], isError: true } } as any
      return reply({ data: { gid: 'u1', name: ME } })
    }
    if (e.tool === 'get_tasks') {
      log.completedSince = e.args.completed_since
      log.section = e.args.section
      if (options.readDelay) await clock.sleep(options.readDelay)
      if (options.failGetTasks) return { value: { content: [{ type: 'text', text: 'Internal Server Error' }], isError: true } } as any
      if (options.persisted === 'message') {
        const text = `Error: result (74 523 characters) exceeds maximum allowed tokens. Output has been saved to ${PERSISTED_FILE}.
Format: JSON with schema: {data: [{...}]}
- For targeted queries (find a value, filter by field): use jq on the file directly.`
        return { value: { content: [{ type: 'text', text }], isError: false } } as any
      }
      if (options.persisted === 'encart') {
        const text = `<persisted-output>
Output too large (55.1KB). Full output saved to: ${PERSISTED_FILE}

Preview (first 2KB):
{"data":[{"gid":"1"
...
</persisted-output>`
        return { value: { content: [{ type: 'text', text }], isError: false } } as any
      }
      return reply({ data: all.map(withDone) })
    }
    if (e.tool === 'get_task' && e.args.opt_fields === 'subtasks.name,subtasks.completed') {
      return reply({
        data: {
          subtasks: [
            { gid: 's1', name: '[code] Sous-tâche', completed: false },
            { gid: 's2', name: '[code] Sous-tâche finie', completed: true },
          ],
        },
      })
    }
    if (e.tool === 'get_task') log.reads.push(e.args.task_id)
    if (e.tool === 'get_task' && e.args.task_id === 's1') return reply({ data: task('s1', '[code] Sous-tâche', 'Statut : en cours') })
    if (e.tool === 'get_task') {
      const found = all.find(t => t.gid === e.args.task_id) ?? task(e.args.task_id, '?', '')
      return reply({ data: withDone(found) })
    }
    if (e.tool === 'update_tasks') {
      if (options.writeDelay) await clock.sleep(options.writeDelay)
      log.writes.push(e.args)
      if (options.failWrite) return reply({ data: [], failed: [{ errors: [{ message: 'assignee: Not a recognized ID', help: 'For more information on API status codes and how to handle them, read the docs on errors' }] }] })
      for (const change of e.args.tasks) {
        if (change.completed === true) done.add(change.task)
        if (change.completed === false) done.delete(change.task)
        if (typeof change.notes === 'string') notesOf.set(change.task, change.notes)
      }
      return reply({ data: [{ gid: e.args.tasks[0].task }], failed: [] })
    }
    if (e.tool === 'delete_task') return reply({ data: {} })
    return reply({})
  })
  if (options.below === 'other') on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['AUTRE BANDEAU'] }) as any)
  else on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  // La ligne d'un appel d'outil telle que le moteur la dessine.
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 0 }) as const)
  return { clock, log }
}

describe('asana-board', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`panneau Asana : rangé par statut, sans les tâches terminées, une coche écrit dans Asana (${surface})`, async ($, on) => {
      const { log } = world(on)
      await $.session.start({ surface, isInteractive: true, cwd: '/work' } as any)

      const answer = await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
      expect(String(answer.text)).toBe('Panneau Asana ouvert (Client · Essai (LLM + API)).')
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE() })
      // Les tâches terminées ne sont pas demandées à Asana : seulement celles terminées depuis maintenant.
      expect(log.completedSince).toBe('2026-10-02T12:00:00.000Z')
      expect(await pane.find({ type: 'Text', text: 'Client · Essai (LLM + API)' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Trancher le filtre' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Sous-tâche' })).toBeDefined()
      // La sous-tâche terminée n'est ni lue ni affichée.
      expect(log.reads).not.toContain('s2')
      expect(await pane.find({ type: 'Text', text: 'Sous-tâche finie' })).toBeUndefined()
      // La tâche mère sans statut est un dossier : seule sa sous-tâche s'affiche.
      expect(await pane.find({ type: 'Text', text: 'Prochaines sessions' })).toBeUndefined()
      // Groupes : titre glyphe + mot ; « En attente d'autres » replié d'office.
      expect(await pane.find({ type: 'Text', text: /⚖\sÀ trancher/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Attendre le client' })).toBeUndefined()
      // Tri dans un groupe : l'échéance d'abord. Dans « À faire », « Relire la spec » (28/09)
      // passe avant « Livrer la démo » (sans échéance), que l'ordre alphabétique mettrait devant.
      const order = (await pane.findAll({ type: 'Button' })).map(b => b.key)
      expect(order.indexOf('c-t3')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('c-t3')).toBeLessThan(order.indexOf('c-t5'))

      await pane.press({ key: 'c-t1' })
      // La ligne « Statut : » passe à « fait » dans la même écriture, parenthèse comprise.
      expect(log.writes).toEqual([{ tasks: [{ task: 't1', completed: true, notes: 'Statut : fait\nContexte : x' }] }])
      // Le retour passe par un toast : la tâche est partie dans « Terminées », replié.
      expect(log.toasts).toContain('« Trancher le filtre » : cochée ✓')
      expect(await pane.find({ type: 'Text', text: /✓\sTerminées/ })).toBeDefined()
    })
  }

  test('le panneau se dessine sur les quatre surfaces sans arbre refusé, plié, déplié et en création', async ($, on) => {
    world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    for (const surface of ALL) {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE() })
      expect(await pane.drawn()).toMatchObject({ type: 'Box' })
      expect(await pane.find({ type: 'Text', text: /ASANA/ })).toBeDefined()
      // Le terminal reçoit des glyphes et des blocs, les surfaces distantes des SVG.
      if (surface === 'terminal') expect(await pane.find({ type: 'Svg' })).toBeUndefined()
      else expect(await pane.find({ type: 'Svg' })).toBeDefined()
      await pane.unmount()
    }
    // Une tâche « prêt » dépliée : le Select de statut reçoit une valeur définie.
    const first = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    await first.press({ key: 'x-t5' })
    await first.press({ key: 'x-t1' })
    await first.press({ key: 'new' })
    await first.unmount()
    for (const surface of ALL) {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE(surface === 'mobile' ? 40 : 100) })
      expect(await pane.drawn()).toMatchObject({ type: 'Box' })
      expect(await pane.find({ key: 'w-t1' })).toBeDefined()
      if (surface === 'mobile') {
        // Pas de champ ni de liste de choix : le panneau le dit au lieu de les cacher en silence.
        expect(await pane.find({ type: 'Text', text: /pas de saisie/ })).toBeDefined()
        expect(await pane.find({ type: 'Input' })).toBeUndefined()
        expect(await pane.find({ key: 's-t5' })).toBeUndefined()
        expect(await pane.find({ key: 'f-name' })).toBeUndefined()
      } else {
        const select = await pane.find({ key: 's-t5' })
        expect(select?.props.value).toBe('=prêt')
        expect(select?.props.label).toBe('Statut')
        expect(await pane.find({ key: 'f-name' })).toBeDefined()
      }
      await pane.unmount()
    }
  })

  test('le bandeau s’empile sous celui d’un autre plugin, sans l’effacer', async ($, on) => {
    world(on, { below: 'other' })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    for (const surface of BANDS) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND() })
      expect(await band.find({ type: 'Text', text: /AUTRE BANDEAU/ })).toBeDefined()
      // Pas de trait horizontal : la barre de couleur et le nom séparent les bandeaux.
      expect(await band.find({ type: 'Text', text: /^─+$/ })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: '▍' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /^\sAsana\s*$/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /1\sà trancher/ })).toBeDefined()
      // Sans commande dans le libellé : l'étiquette « Asana » nomme déjà le plugin.
      expect((await band.find({ key: 'asana-band-open' }))?.props.label).toBe('▸ Ouvrir')
      const hide = await band.find({ key: 'asana-band-hide' })
      // Pas de fermeture native : plusieurs bandeaux empilés la placeraient au même endroit.
      expect(hide?.props.role).toBeUndefined()
      expect(hide?.props.hotkey).toBeUndefined()
      await band.unmount()
    }
  })

  test('le bandeau rend la main pendant un sondage, avant toute lecture et une fois masqué', async ($, on) => {
    world(on, { below: 'other' })
    // Avant toute lecture : rien à montrer.
    for (const surface of BANDS) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND() })
      expect(await band.drawn()).toMatchObject({ type: 'Text', children: ['AUTRE BANDEAU'] })
      await band.unmount()
    }
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    for (const surface of BANDS) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND(120, true) })
      expect(await band.drawn()).toMatchObject({ type: 'Text', children: ['AUTRE BANDEAU'] })
      await band.unmount()
    }
    await $.command.run({ command: 'asana', args: 'hide', ...TYPED })
    for (const surface of BANDS) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND() })
      expect(await band.drawn()).toMatchObject({ type: 'Text', children: ['AUTRE BANDEAU'] })
      await band.unmount()
    }
  })

  test('« x » masque le bandeau, la ligne d’état prend le relais, /asana show le rend', async ($, on) => {
    const { log } = world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    for (const surface of BANDS) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND() })
      expect(await band.find({ type: 'Text', text: /à trancher/ })).toBeDefined()
      await band.press({ key: 'asana-band-hide' })
      expect(await band.find({ type: 'Text', text: /à trancher/ })).toBeUndefined()
      expect(log.toasts).toContain('Bandeau Asana masqué : /asana show pour le réafficher')
      expect(log.statuses.at(-1)).toMatch(/^◆ Client · Essai \(LLM \+ API\) · 1 à trancher/)
      await band.unmount()
      const shown = await $.command.run({ command: 'asana', args: 'show', ...TYPED })
      expect(String(shown.text)).toMatch(/^Panneau Asana ouvert/)
      expect(log.statuses.at(-1)).toBeUndefined()
      const again = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND() })
      expect(await again.find({ type: 'Text', text: /à trancher/ })).toBeDefined()
      await again.unmount()
    }
  })

  test('/asana-board:asana répond sans le modèle et ouvre le panneau ; /asana sort du menu', async ($, on) => {
    const { log } = world(on)
    on('command.describe', (_$: unknown, e: any) => ({ description: e.description, isHidden: e.isHidden }))
    // Pas de session.start : la commande statique est là dès le premier message.
    const out = await $.command.run({ command: 'asana-board:asana', args: '', ...TYPED })
    expect(String(out.text)).toBe('Panneau Asana ouvert (Client · Essai (LLM + API)).')
    expect(log.opened).toContain('asana')
    const tab = await $.command.run({ command: 'asana-board:asana', args: 'toi', ...TYPED })
    expect(String(tab.text)).toMatch(/^Panneau Asana ouvert/)
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    expect(await pane.find({ key: 'tab-toi', text: /▸ Pour toi/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Relire la spec' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Trancher le filtre' })).toBeUndefined()
    await pane.unmount()
    // Les comptes du bandeau ne suivent pas le filtre du panneau : la tâche de Claude y reste comptée.
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.find({ type: 'Text', text: /1\sà trancher/ })).toBeDefined()
    await band.unmount()

    const short = await $.command.describe({ command: 'asana', description: 'x', isHidden: false } as any)
    expect(short.isHidden).toBe(true)
    const full = await $.command.describe({ command: 'asana-board:asana', description: 'x', isHidden: false } as any)
    expect(full.isHidden).toBe(false)
  })

  test('le bandeau à 30 et à 160 colonnes', async ($, on) => {
    world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    for (const surface of BANDS) {
      const narrow = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND(30) })
      expect(await narrow.drawn()).toMatchObject({ type: 'Box' })
      expect(await narrow.find({ type: 'Text', text: /⚖1/ })).toBeDefined()
      expect(await narrow.find({ type: 'Text', text: /Client/ })).toBeUndefined()
      expect(await narrow.find({ type: 'Text', text: /Prochaine|En\sretard/ })).toBeUndefined()
      await narrow.unmount()
      const wide = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND(160) })
      expect(await wide.find({ type: 'Text', text: 'Client · Essai (LLM + API)' })).toBeDefined()
      expect(await wide.find({ type: 'Text', text: /pour\stoi\s:\s1/ })).toBeDefined()
      expect(await wide.find({ type: 'Text', text: /⚠\s1\sen\sretard/ })).toBeDefined()
      // La seule échéance est déjà passée : elle n'est que comptée en ligne 1, sans ligne 2 qui la détaille.
      expect(await wide.find({ type: 'Text', text: /En\sretard/ })).toBeUndefined()
      expect(await wide.find({ type: 'Text', text: /Prochaine/ })).toBeUndefined()
      expect(await wide.find({ type: 'Text', text: 'Relire la spec' })).toBeUndefined()
      // Seul bandeau (rien en dessous) : l'étiquette quand même, et pas de trait.
      expect(await wide.find({ type: 'Text', text: /^\sAsana\s*$/ })).toBeDefined()
      expect(await wide.find({ type: 'Text', text: /^─+$/ })).toBeUndefined()
      await wide.unmount()
    }
  })

  test('le titulaire du compte : lu par get_me, ses tâches sont « pour Toi » ; inconnu, aucune ne l’est', async ($, on) => {
    const { log } = world(on, { failGetMe: true })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    expect(log.calls).toContain('get_me')
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE() })
    await pane.press({ key: 'x-t3' })
    expect(await pane.find({ type: 'Text', text: /pour\sAlex/ })).toBeDefined()
    expect((await pane.find({ key: 'a-t3' }))?.props.label).toBe("M'assigner")
    await pane.unmount()
  })

  test('le titulaire du compte, lu par get_me : sa tâche est « pour Toi » et se confie à Claude', async ($, on) => {
    world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE() })
    await pane.press({ key: 'x-t3' })
    expect(await pane.find({ type: 'Text', text: /pour\sToi/ })).toBeDefined()
    expect((await pane.find({ key: 'a-t3' }))?.props.label).toBe('Confier à Claude')
    await pane.unmount()
  })

  test('états vides : aucune tâche, aucune tâche pour toi', async ($, on) => {
    world(on, { sectionTasks: () => [] })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE() })
    expect(await pane.find({ type: 'Text', text: /Aucune tâche ouverte dans cette section/ })).toBeDefined()
    await pane.press({ key: 'tab-toi' })
    expect(await pane.find({ type: 'Text', text: 'Aucune tâche pour toi.' })).toBeDefined()
    await pane.unmount()
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.find({ type: 'Text', text: /aucune\stâche\souverte/ })).toBeDefined()
    await band.unmount()
  })

  test('état d’erreur : pas de section, une carte avec reprise, pas de bandeau', async ($, on) => {
    world(on, { md: '# Projet sans Asana' })
    const out = await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    expect(String(out.text)).toMatch(/^Panneau Asana : Pas de section Asana/)
    for (const surface of ALL) {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE() })
      expect(await pane.find({ type: 'Text', text: /Lecture impossible/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Attendu dans le CLAUDE\.md ou docs\/agents\/issue-tracker\.md/ })).toBeDefined()
      expect(await pane.find({ key: 'retry' })).toBeDefined()
      await pane.unmount()
    }
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.drawn()).toMatchObject({ type: 'engine' })
    await band.unmount()
  })

  test('au démarrage, la section du CLAUDE.md est lue en arrière-plan et remplit le bandeau', async ($, on) => {
    const { clock, log } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    // Rien n'est lu pendant session.start lui-même.
    expect(log.calls).toHaveLength(0)
    await clock.settle()
    expect(log.calls).toContain('get_tasks')
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND() })
    expect(await band.find({ type: 'Text', text: /1\sà trancher/ })).toBeDefined()
    await band.unmount()
    expect(log.toasts).toHaveLength(0)
  })

  test('au démarrage, un connecteur absent est réessayé à 5 s, 15 s et 45 s, puis abandonné sans bruit', async ($, on) => {
    const { clock, log } = world(on, { hasServer: () => false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    expect(log.toolLists).toBe(1)
    await clock.advance(5_000)
    expect(log.toolLists).toBe(2)
    await clock.advance(15_000)
    expect(log.toolLists).toBe(3)
    await clock.advance(45_000)
    expect(log.toolLists).toBe(4)
    await clock.advance(120_000)
    expect(log.toolLists).toBe(4)
    expect(log.calls).toHaveLength(0)
    expect(log.toasts).toHaveLength(0)
    expect(log.statuses.filter(s => s !== undefined)).toHaveLength(0)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.drawn()).toMatchObject({ type: 'engine' })
    await band.unmount()
  })

  test('au démarrage, un connecteur qui arrive tard est pris au nouvel essai', async ($, on) => {
    let isUp = false
    const { clock, log } = world(on, { hasServer: () => isUp })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    isUp = true
    await clock.advance(5_000)
    expect(log.calls).toContain('get_tasks')
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.find({ type: 'Text', text: /à trancher/ })).toBeDefined()
    await band.unmount()
  })

  for (const format of ['encart', 'message'] as const) {
    test(`section trop longue (${format}) : le panneau relit la réponse rangée dans un fichier par le moteur`, async ($, on) => {
      world(on, { persisted: format })
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
      await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
      const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
      expect(await pane.find({ type: 'Text', text: /Lecture impossible/ })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: 'Trancher le filtre' })).toBeDefined()
      await pane.unmount()
    })
  }

  test('au démarrage, sans section Asana : aucun appel, pas de bandeau', async ($, on) => {
    const { clock, log } = world(on, { md: '# Rien' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.advance(120_000)
    expect(log.toolLists).toBe(0)
    expect(log.calls).toHaveLength(0)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.drawn()).toMatchObject({ type: 'engine' })
    await band.unmount()
  })

  test('une lecture de fond qui échoue reste muette ; /asana montre ensuite l’erreur', async ($, on) => {
    const { clock, log } = world(on, { failGetTasks: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    expect(log.calls).toContain('get_tasks')
    expect(log.toasts).toHaveLength(0)
    expect(log.statuses.filter(s => s !== undefined)).toHaveLength(0)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.drawn()).toMatchObject({ type: 'engine' })
    await band.unmount()
    const quiet = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    expect(await quiet.find({ type: 'Text', text: /Lecture impossible/ })).toBeUndefined()
    // Rien n'a été lu : l'accueil, et non un en-tête qui affirme « 0 tâche ouverte ».
    expect(await quiet.find({ type: 'Text', text: /Tâches Asana du projet/ })).toBeDefined()
    expect(await quiet.find({ type: 'Text', text: /0\stâche/ })).toBeUndefined()
    expect(await quiet.find({ key: 'tab-tous' })).toBeUndefined()
    await quiet.unmount()

    const out = await $.command.run({ command: 'asana', args: '', ...TYPED })
    expect(String(out.text)).toMatch(/^Panneau Asana : Asana \(get_tasks\)/)
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    expect(await pane.find({ type: 'Text', text: /Lecture impossible/ })).toBeDefined()
    await pane.unmount()
  })

  test('au terminal, le lien Asana d’une tâche devient un bouton qui copie son adresse ; ailleurs, il reste un lien', async ($, on) => {
    const URL = 'https://app.asana.com/0/0/t1'
    const { log } = world(on, { sectionTasks: () => SAMPLE().map(t => (t.gid === 't1' ? { ...t, permalink_url: URL } : t)) })
    const copies: { text: string; surface?: string }[] = []
    let isCopied = true
    on('ui.copy', (_$: unknown, e: { text: string; surface?: string }) => {
      copies.push(e)
      return { value: { isCopied } } as any
    })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    await pane.press({ key: 'x-t1' })
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    expect((await pane.find({ key: 'copy-t1' }))?.props).toMatchObject({ label: '⧉ Asana' })
    await pane.press({ key: 'copy-t1' })
    expect(copies).toEqual([expect.objectContaining({ text: URL })])
    expect(log.toasts.at(-1)).toBe('Lien Asana copié')
    // Sans copie possible, le toast donne l'adresse à recopier.
    isCopied = false
    await pane.press({ key: 'copy-t1' })
    expect(log.toasts.at(-1)).toBe(`Copie impossible : ${URL}`)
    await pane.unmount()

    const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE() })
    expect((await desktop.find({ type: 'Link' }))?.props).toMatchObject({ href: URL, label: 'Asana ↗' })
    expect(await desktop.find({ key: 'copy-t1' })).toBeUndefined()
    await desktop.unmount()
  })

  test('une écriture en cours bloque le second appui ; la suppression n’est pas l’action principale', async ($, on) => {
    // Asana lent à répondre aux écritures.
    const { clock, log } = world(on, { writeDelay: 2_000 })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    const pressing = pane.press({ key: 'c-t1' })
    await clock.settle()
    // Pendant l'écriture, la case laisse place à un spinner : rien à presser une seconde fois.
    expect(await pane.find({ key: 'c-t1' })).toBeUndefined()
    // Les autres contrôles de la tâche restent là : un second appui y est refusé, et le dit.
    await pane.press({ key: 'x-t1' })
    await pane.press({ key: 'a-t1' })
    expect(log.toasts).toContain('« Trancher le filtre » : écriture déjà en cours, attends sa fin')
    await clock.advance(2_000)
    await pressing
    expect(log.writes).toHaveLength(1)
    expect(await pane.find({ key: 'c-t3' })).toBeDefined()

    await pane.press({ key: 'x-t3' })
    await pane.press({ key: 'del-t3' })
    const yes = await pane.find({ key: 'dy-t3' })
    expect(yes?.props.variant).toBeUndefined()
    const primaries = await pane.findAll({ type: 'Button' })
    expect(primaries.filter(b => b.props.variant === 'primary').map(b => b.key)).toEqual(['w-t3'])
    await pane.press({ key: 'dy-t3' })
    expect(log.calls).toContain('delete_task')
    expect(log.toasts).toContain('Tâche supprimée : « Relire la spec »')
    expect(await pane.find({ type: 'Text', text: 'Relire la spec' })).toBeUndefined()
    await pane.unmount()
  })

  test('redessin sobre : toutes les 30 s au repos, jamais chaque seconde', async ($, on) => {
    const { clock, log } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    expect(log.calls).toContain('get_tasks')
    await clock.advance(29_000)
    expect(log.invalidations).toBe(0)
    await clock.advance(1_000)
    expect(log.invalidations).toBe(1)
    await clock.advance(30_000)
    expect(log.invalidations).toBe(2)
  })

  test('quand Claude écrit dans Asana, le panneau se relit en silence', async ($, on) => {
    const { clock, log } = world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const before = log.calls.filter(c => c === 'get_tasks').length
    await $.tool.call({ tool: 'mcp__srv__update_tasks', tasks: [] } as any)
    await clock.settle()
    expect(log.calls.filter(c => c === 'get_tasks').length).toBe(before + 1)
    expect(log.toasts).toHaveLength(0)
  })

  test('/asana-board:asana pendant la lecture de fond l’attend au lieu d’en lancer une seconde', async ($, on) => {
    const { clock, log } = world(on, { readDelay: 1_000 })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    expect(log.calls.filter(c => c === 'get_tasks')).toHaveLength(1)
    const asking = $.command.run({ command: 'asana-board:asana', args: '', ...TYPED })
    await clock.settle()
    await clock.advance(1_000)
    const out = await asking
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    expect(String(out.text)).toBe('Panneau Asana ouvert (Client · Essai (LLM + API)).')
    expect(log.calls.filter(c => c === 'get_tasks')).toHaveLength(1)
    // Une seule lecture : une fois finie, plus rien ne tourne.
    expect(await pane.find({ type: 'Text', text: /À jour/ })).toBeDefined()
    expect(await pane.find({ key: 'refresh', text: /Relire/ })).toBeDefined()
    await pane.unmount()
  })

  test('une lecture de fond en échec n’empêche pas /asana de relire et de montrer l’erreur', async ($, on) => {
    const { clock, log } = world(on, { readDelay: 1_000, failGetTasks: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    const asking = $.command.run({ command: 'asana', args: '', ...TYPED })
    await clock.settle()
    await clock.advance(1_000)
    await clock.settle()
    await clock.advance(1_000)
    const out = await asking
    // La lecture de fond, muette, puis la lecture demandée, qui montre son erreur.
    expect(log.calls.filter(c => c === 'get_tasks')).toHaveLength(2)
    expect(String(out.text)).toMatch(/^Panneau Asana : Asana \(get_tasks\)/)
  })

  test('un /asana fait avant l’arrivée du connecteur n’arrête pas les nouveaux essais', async ($, on) => {
    let isUp = false
    const { clock, log } = world(on, { hasServer: () => isUp })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    const out = await $.command.run({ command: 'asana', args: '', ...TYPED })
    expect(String(out.text)).toMatch(/Connecteur Asana introuvable/)
    isUp = true
    await clock.advance(5_000)
    expect(log.calls).toContain('get_tasks')
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.find({ type: 'Text', text: /à trancher/ })).toBeDefined()
    await band.unmount()
    // La lecture de fond réussie efface l'erreur de la lecture demandée.
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    expect(await pane.find({ type: 'Text', text: /Lecture impossible/ })).toBeUndefined()
    await pane.unmount()
  })

  test('/asana-board:asana qui échoue répond elle-même, sans laisser le modèle dire « mod non chargé »', async ($, on) => {
    world(on, { failCwd: true })
    const out = await $.command.run({ command: 'asana-board:asana', args: '', ...TYPED })
    // Le kit rapporte « no implementation for session.cwd » : c'est le .catch qui répond.
    expect(String(out.text)).toMatch(/^Panneau Asana : .*session.cwd/)
  })

  test('/asana-board:asana lancée sans `args` par un autre plugin', async ($, on) => {
    const { log } = world(on)
    const out = await $.command.run({ command: 'asana-board:asana' } as any)
    expect(String(out.text)).toBe('Panneau Asana ouvert (Client · Essai (LLM + API)).')
    expect(log.opened).toContain('asana')
  })

  test('la ligne 1 du bandeau tient dans sa largeur à chaque palier', async ($, on) => {
    world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const section = 'Client · Essai (LLM + API)'
    for (const cols of [24, 30, 40, 56, 64, 72, 80, 90, 100, 120, 160]) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND(cols) })
      const root: any = await band.drawn()
      const first = root.children[0]
      // Le nom de section se tronque seul ; ce qui reste lui en laisse au moins 10.
      const rest = widthOf(first, section)
      const room = cols >= 90 ? 10 : 0
      expect(`${cols} : ${rest + room <= cols}`).toBe(`${cols} : true`)
      await band.unmount()
    }
    // À 80 colonnes : les comptes en glyphes, sans le nom de section.
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND(80) })
    expect(await band.find({ type: 'Text', text: /⚖1/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /à trancher/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /Client/ })).toBeUndefined()
    await band.unmount()
  })

  test('sous 24 colonnes, le bandeau ne se dit pas plus large que sa place', async ($, on) => {
    world(on, { below: 'other' })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    for (const surface of BANDS) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND(20) })
      expect((await band.find({ key: 'asana-band' }))?.props.width).toBe(20)
      await band.unmount()
    }
  })

  test('les tâches sans statut comptent dans le bandeau et la ligne d’état', async ($, on) => {
    const { log } = world(on, { sectionTasks: () => [task('n1', '[code] Sans ligne de statut', 'Contexte : rien')] })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND() })
    expect(await band.find({ type: 'Text', text: /1\ssans statut/ })).toBeDefined()
    await band.press({ key: 'asana-band-hide' })
    await band.unmount()
    expect(log.statuses.at(-1)).toBe('◆ Client · Essai (LLM + API) · 1 sans statut')
  })

  test('décocher remet le statut à « à faire » ; abandonner l’écrit « abandonnée »', async ($, on) => {
    const { log } = world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    await pane.press({ key: 'c-t1' })
    await pane.press({ key: 'fold-done' })
    // La tâche relue après la coche montre son nouveau statut.
    await pane.press({ key: 'x-t1' })
    expect(await pane.find({ type: 'Text', text: /^Statut.:.fait$/ })).toBeDefined()
    await pane.press({ key: 'c-t1' })
    expect(log.writes.at(-1)).toEqual({ tasks: [{ task: 't1', completed: false, notes: 'Statut : à faire\nContexte : x' }] })
    expect(log.toasts).toContain('« Trancher le filtre » : décochée')

    await pane.press({ key: 'x-t3' })
    await pane.press({ key: 'ab-t3' })
    expect(log.writes.at(-1)?.tasks[0]).toMatchObject({ task: 't3', completed: true, notes: expect.stringMatching(/^Statut : abandonnée(\n|$)/) })
    await pane.unmount()
  })

  test('description mise en forme dans Asana : la coche part quand même, sans toucher au statut', async ($, on) => {
    const { log } = world(on, { formatted: true })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    await pane.press({ key: 'c-t1' })
    expect(log.writes).toEqual([{ tasks: [{ task: 't1', completed: true }] }])
    expect(log.toasts).toContain('« Trancher le filtre » : cochée ✓ (statut inchangé : description mise en forme dans Asana)')
    await pane.unmount()
  })

  test('une écriture refusée : toast court, détail complet sous la tâche dépliée', async ($, on) => {
    const { log } = world(on, { failWrite: true })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    await pane.press({ key: 'c-t1' })
    expect(log.toasts).toContain('« Trancher le filtre » : Asana a refusé (détail sous la tâche)')
    expect(await pane.find({ type: 'Text', text: /Not a recognized ID/ })).toBeDefined()
    await pane.unmount()
  })

  test('prompt indisponible : le toast donne la demande à taper', async ($, on) => {
    const { log } = world(on, { canFill: false })
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    await pane.press({ key: 'x-t1' })
    await pane.press({ key: 'w-t1' })
    expect(log.toasts).toContain('Prompt indisponible. Tape : Travaille sur la tâche Asana « Trancher le filtre » (gid t1). Lis-la d’abord dans Asana.'.replace('’', "'"))
    await pane.unmount()
  })

  test('une lecture vieille de plus de 10 min n’est plus dite « À jour »', async ($, on) => {
    const { clock } = world(on)
    await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    const fresh = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    expect(await fresh.find({ type: 'Text', text: 'À jour' })).toBeDefined()
    await fresh.unmount()
    await clock.advance(11 * 60_000)
    const old = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE() })
    expect(await old.find({ type: 'Text', text: 'À jour' })).toBeUndefined()
    expect(await old.find({ type: 'Text', text: /Lue/ })).toBeDefined()
    expect(await old.find({ type: 'Text', text: /lue\sil\sy\sa\s11\smin/ })).toBeDefined()
    await old.unmount()
  })

  test('GID dans docs/agents/issue-tracker.md, en tableau : la section est trouvée', async ($, on) => {
    const { log } = world(on, {
      files: {
        'CLAUDE.md': 'Les tickets vivent dans Asana (Suivi, section « PolePredict »). Voir `docs/agents/issue-tracker.md`.',
        'docs/agents/issue-tracker.md': [
          '| Élément | Valeur |',
          '|---|---|',
          '| Projet | « Suivi », GID `1200000000000001` |',
          '| Section | « PolePredict », GID `1200000000000003` |',
          '| Tâche mère du travail de Claude | « [code] PolePredict : prochaines sessions Claude Code », GID `1200000000000004` |',
        ].join('\n'),
      },
    })
    const out = await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    expect(String(out.text)).toBe('Panneau Asana ouvert (PolePredict).')
    expect(log.section).toBe('1200000000000003')
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE() })
    expect(await pane.find({ type: 'Text', text: /Lecture impossible/ })).toBeUndefined()
    await pane.unmount()
  })

  test('GID dans le CLAUDE.md seul (sans docs/agents/issue-tracker.md) : la forme d’origine marche toujours', async ($, on) => {
    const { log } = world(on, { files: { 'CLAUDE.md': SECTION_MD } })
    const out = await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
    expect(String(out.text)).toBe('Panneau Asana ouvert (Client · Essai (LLM + API)).')
    expect(log.section).toBe('222')
  })
  /** La ligne d'un appel d'outil de Claude dans la conversation. */
  const TOOL_USE = (tool: string, input: unknown, extra: Raw = {}) =>
    ({
      component: 'ToolUse',
      requestId: 'toolu_1',
      props: { tool_use_id: 'toolu_1', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra },
    }) as any

  /** Le texte de la ligne dessinée, sans espaces insécables. */
  const rowText = async (row: any): Promise<string> =>
    (await row.findAll({ type: 'Text' })).map((t: any) => (t.children ?? []).join('')).join(' ').replace(/ /g, ' ')

  for (const surface of BANDS) {
    test(`écritures de Claude : une ligne avec le nom des tâches, pour chaque outil (${surface})`, async ($, on) => {
      world(on)
      await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
      const cases: [string, unknown, string][] = [
        ['mcp__srv__update_tasks', { tasks: [{ task: 't1', completed: true, notes: 'Statut : fait' }] }, 'coche « Trancher le filtre »'],
        ['mcp__srv__update_tasks', { tasks: [{ task: 't1', completed: false }] }, 'décoche « Trancher le filtre »'],
        ['mcp__srv__update_tasks', { tasks: [{ task: 't3', notes: 'Statut : en cours\nContexte : x' }] }, 'statut « en cours » sur « Relire la spec »'],
        ['mcp__srv__update_tasks', { tasks: [{ task: 't3', name: '[code] Relire la spec v2' }] }, 'renomme « Relire la spec » en « Relire la spec v2 »'],
        ['mcp__srv__update_tasks', { tasks: [{ task: 't3', assignee: 'me' }] }, 'assigne « Relire la spec » à toi'],
        ['mcp__srv__update_tasks', { tasks: [{ task: 't3', due_on: '2026-10-20' }] }, 'échéance 2026-10-20 sur « Relire la spec »'],
        ['mcp__srv__update_tasks', { tasks: [{ task: 't1', completed: true }, { task: 't3', completed: true }, { task: 't4', completed: true }, { task: 't5', completed: true }] }, 'coche « Trancher le filtre », « Relire la spec » +2'],
        ['mcp__srv__update_tasks', { tasks: [{ task: 't1', completed: true }, { task: 't3', name: 'X' }] }, 'modifie « Trancher le filtre », « Relire la spec »'],
        ['mcp__srv__add_comment', { task_id: 't4', text: 'Relancé.' }, 'commentaire sur « Attendre le client »'],
        ['mcp__srv__create_tasks', { tasks: [{ name: '[code] Corriger le bandeau', project_id: '111' }] }, 'crée « Corriger le bandeau »'],
        ['mcp__srv__delete_task', { task: 't5' }, 'supprime « Livrer la démo »'],
      ]
      for (const [tool, input, expected] of cases) {
        const row = await $.ui.mount({ plugin: PLUGIN, surface, ...TOOL_USE(tool, input) })
        expect(await row.drawn()).toMatchObject({ type: 'Box' })
        expect(await rowText(row)).toBe(`Asana · ${expected}`)
        await row.unmount()
      }
    })

    test(`écritures de Claude : un GID inconnu s'affiche tel quel, sans relecture (${surface})`, async ($, on) => {
      const { log } = world(on)
      await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
      const calls = log.calls.length
      const row = await $.ui.mount({ plugin: PLUGIN, surface, ...TOOL_USE('mcp__srv__update_tasks', { tasks: [{ task: '1200000000000999', completed: true }] }) })
      expect(await rowText(row)).toBe('Asana · coche tâche 1200000000000999')
      expect(log.calls.length).toBe(calls)
      await row.unmount()
      // Avant toute lecture du panneau, aucun nom n'est connu : le GID reste lisible.
      const comment = await $.ui.mount({ plugin: PLUGIN, surface, ...TOOL_USE('mcp__other__add_comment', { task_id: '42', text: 'x' }) })
      expect(await rowText(comment)).toBe('Asana · commentaire sur tâche 42')
      await comment.unmount()
    })

    test(`écritures de Claude : entrée non reconnue, erreur, interruption ou autre outil → ligne du moteur (${surface})`, async ($, on) => {
      world(on)
      await $.command.run({ command: 'asana', args: '/projet', ...TYPED })
      const engine = [
        TOOL_USE('mcp__srv__update_tasks', { tasks: [] }),
        TOOL_USE('mcp__srv__update_tasks', { tasks: [{ name: 'sans gid' }] }),
        TOOL_USE('mcp__srv__update_tasks', 'texte'),
        TOOL_USE('mcp__srv__create_tasks', { tasks: [{ project_id: '111' }] }),
        TOOL_USE('mcp__srv__add_comment', { text: 'sans tâche' }),
        TOOL_USE('mcp__srv__delete_task', {}),
        TOOL_USE('mcp__srv__update_tasks', { tasks: [{ task: 't1', completed: true }] }, { isErrored: true }),
        TOOL_USE('mcp__srv__update_tasks', { tasks: [{ task: 't1', completed: true }] }, { isInterrupted: true }),
        TOOL_USE('mcp__srv__get_tasks', { section: '222' }),
        TOOL_USE('Bash', { command: 'ls' }),
      ]
      for (const site of engine) {
        const row = await $.ui.mount({ plugin: PLUGIN, surface, ...site })
        expect(await row.drawn()).toMatchObject({ type: 'engine' })
        await row.unmount()
      }
      // Pendant l'appel : la même ligne, atténuée.
      const running = await $.ui.mount({ plugin: PLUGIN, surface, ...TOOL_USE('mcp__srv__delete_task', { task: 't5' }, { isRunning: true }) })
      expect(await rowText(running)).toBe('Asana · supprime « Livrer la démo »…')
      await running.unmount()
    })
  }
})
