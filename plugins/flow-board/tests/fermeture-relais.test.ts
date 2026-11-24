import { expect, test } from 'claude-code/testing'

import { closingProcedure, closingScript, relayReportNote } from '../hooks/closing.ts'
import { newRun } from '../hooks/model.ts'
import type { Run } from '../types'

// La fermeture d'un groupe par le script de vérification : le sessionId se lit sur la ligne « session : » que le
// script imprime (le manager le cherchait dans claude agents --json en devinant ses clés), et le compte rendu du
// worker reste au relais, que claude rm n'efface pas (le manager le recopiait dans travail/).
// Invariant : le chemin que la consigne donne pour le compte rendu ne nomme jamais que le dossier
// ~/.claude/flow-board/relais/ et, au plus, le préfixe <runSlug(run.id)>. de ses fichiers .report.md : l'id de la
// mission n'y entre que par son slug ([a-z0-9-] seulement), jamais tel qu'il est relu ; un slug vide donne le dossier seul.

const SCRIPT = '/opt/poste/.claude/plugins/cache/m/flow-board/1.0.0/scripts/fermeture.mjs'
const group = { kind: 'group', id: 'A', name: 'Code' } as const
const runOf = (id: unknown): Run => ({ ...newRun('implement', 1_000, 'Boutique'), id }) as Run

const withScript = <T,>(path: string | null, fn: () => T): T => {
  const before = closingScript.path
  closingScript.path = path
  try {
    return fn()
  } finally {
    closingScript.path = before
  }
}

/** Le chemin que la consigne donne pour le compte rendu entier : de « ~/.claude » jusqu'à l'espace qui le suit. */
const reportPathIn = (text: string): string | undefined => text.match(/~\/\.claude\/flow-board\/relais\/\S*/)?.[0]

const SESSION_LINE = 'se reprend par claude --resume <sessionId>, lu sur une ligne « session : » du script qui le donne (« sessionId <id> », avant ou après l’arrêt) ; aucune ne le donne (« sessionId ? », pas de sessionId) : dis-le tel quel, sans le chercher par claude agents --json'
/** Le plafond du texte court d'une session du CLI, le même que `SHORT_MAX` de fermeture-courte.test.ts. */
const SHORT_MAX = 2_800
const OLD_RESUME = 'le champ sessionId de claude agents --json, à relever avant l’arrêt'

test('avec le script : le sessionId se lit sur la ligne « session : », et le compte rendu reste au relais, au préfixe de la mission', () => {
  const text = withScript(SCRIPT, () => closingProcedure({ run: runOf('mwfm6jha-bwgx'), target: group, isRepo: true, session: 'abc12345', hasReport: true }))
  expect(text).toContain(`4) dis-moi ce qui a été fermé et ce qui reste`)
  expect(text).toContain(SESSION_LINE)
  expect(text).not.toContain(OLD_RESUME)
  expect(text).toContain('son compte rendu reste au relais (claude rm ne l’efface pas) : ne le recopie nulle part')
  expect(text).toContain('il est dans le champ « report » de l’entrée de sa session')
  expect(reportPathIn(text)).toBe('~/.claude/flow-board/relais/mwfm6jha-bwgx.*.report.md')
  expect(text).toContain('(* : l’id de session que le worker lit chez lui) s’il a pu s’écrire')
  // L'id de session noté ici n'entre pas dans ce chemin : le fichier est nommé par l'id que le worker lit chez lui.
  expect(text).not.toContain('abc12345.report')
  // Le texte court le reste.
  expect(text.length).toBeLessThan(SHORT_MAX)
})

test('un id de mission hostile n’entre dans le chemin que par son slug ; sans lettre ni chiffre, le dossier seul', () => {
  for (const [id, slug] of [
    ["Mi'ssion", 'mi-ssion'],
    ['../../etc', 'etc'],
    ['a/b/c', 'a-b-c'],
    ['une mission', 'une-mission'],
    ["x'; rm -rf ~; '", 'x-rm-rf'],
    ['A.B..C', 'a-b-c'],
  ] as const) {
    const text = withScript(SCRIPT, () => closingProcedure({ run: runOf(id), target: group, isRepo: true, session: 'abc12345', hasReport: true }))
    const path = reportPathIn(text)!
    expect(path).toBe(`~/.claude/flow-board/relais/${slug}.*.report.md`)
    // Le préfixe tient dans [a-z0-9-] : ni apostrophe, ni « .. », ni « / », ni espace.
    expect(path.slice('~/.claude/flow-board/relais/'.length, -'.*.report.md'.length)).toMatch(/^[a-z0-9-]+$/)
    expect(text).not.toContain('rm -rf')
  }
  for (const id of ["'../ /", '...', '', 42, null, undefined]) {
    const note = relayReportNote(id)
    // Sans slug, le fichier entier n'est jamais écrit : la note le dit, au lieu d'envoyer vers les fichiers d'autres missions.
    expect(note).toContain('(aucun fichier de ~/.claude/flow-board/relais/ ne le garde entier pour cette mission)')
    expect(note).not.toContain('*.report.md')
    expect(reportPathIn(note)).toBe('~/.claude/flow-board/relais/')
  }
})

test('un id de session hostile n’entre pas dans la consigne par ce chemin : refusé, la consigne ne dit rien du relais ; accepté, le chemin ne le nomme pas', () => {
  withScript(SCRIPT, () => {
    for (const session of ["x'; rm -rf ~", '../a', 'a/b', 'a b', "s'1"]) {
      const text = closingProcedure({ run: runOf('m1'), target: group, isRepo: true, session, hasReport: true })
      // Refusée en amont (forme sûre d'un id) : rien n'est fermé, et ni la note du relais ni la session n'y entrent.
      expect(text).toContain('Ne ferme pas')
      expect(text).not.toContain('son compte rendu reste au relais')
      expect(text).not.toContain(session)
    }
    // Un id en forme n'entre pas non plus dans le chemin du compte rendu : seul le joker y est.
    const text = closingProcedure({ run: runOf('m1'), target: group, isRepo: true, session: 'Abc12345-Ef', hasReport: true })
    expect(reportPathIn(text)).toBe('~/.claude/flow-board/relais/m1.*.report.md')
    expect(text).not.toContain('Abc12345-Ef.report')
    expect(text).not.toContain('abc12345-ef')
  })
})

test('sans compte rendu au relais, rien n’en est dit ; une session de l’app garde son texte de reprise', () => {
  withScript(SCRIPT, () => {
    const noReport = closingProcedure({ run: runOf('m1'), target: group, isRepo: true, session: 'abc12345', hasReport: false })
    expect(noReport).not.toContain('son compte rendu reste au relais')
    expect(noReport).toContain(SESSION_LINE)
    const app = closingProcedure({ run: runOf('m1'), target: group, isRepo: true, session: 'local_abc', hasReport: true })
    expect(app).toContain('sa conversation est gardée dans l’app')
    expect(app).not.toContain(OLD_RESUME)
    expect(reportPathIn(app)).toBe('~/.claude/flow-board/relais/m1.*.report.md')
  })
})

test('sans le script, la procédure entière et sans git : leur texte de reprise d’avant, sans le relais', () => {
  const whole = withScript(null, () => closingProcedure({ run: runOf('m1'), target: group, isRepo: true, session: 'abc12345', hasReport: true }))
  expect(whole).toContain(OLD_RESUME)
  expect(whole).not.toContain(SESSION_LINE)
  expect(whole).not.toContain('son compte rendu reste au relais')
  const noGit = withScript(SCRIPT, () => closingProcedure({ run: runOf('m1'), target: group, isRepo: false, session: 'abc12345', hasReport: true }))
  expect(noGit).toContain(OLD_RESUME)
  expect(noGit).not.toContain('son compte rendu reste au relais')
})

test('le dossier du relais que le mod calcule est celui que la note nomme ; un dossier qui ne se montre pas tel quel n’est pas nommé, jamais remplacé par ~/.claude', () => {
  const dir = '/srv/claude/flow-board/relais'
  const text = withScript(SCRIPT, () => closingProcedure({ run: runOf('m1'), target: group, isRepo: true, session: 'abc12345', hasReport: true, relayDir: dir }))
  expect(text).toContain(`entier dans ${dir}/m1.*.report.md`)
  expect(text).not.toContain('~/.claude/flow-board/relais')
  expect(relayReportNote('m1', true, 'A', dir)).toContain(`il est entier dans ${dir}/m1.manager-a-*.report.md`)
  // Un dossier de Claude qui porte un saut de ligne : ni lui, ni la forme courte.
  for (const odd of ['/srv/cla\nude/flow-board/relais']) {
    for (const note of [relayReportNote('m1', false, undefined, odd), relayReportNote('m1', true, 'A', odd), relayReportNote('', false, undefined, odd)]) {
      expect(note).not.toContain(odd)
      expect(note).not.toContain('~/.claude')
      expect(note).toContain('chemin qui ne se montre pas tel quel')
    }
  }
})
