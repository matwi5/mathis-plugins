import { expect, test } from 'claude-code/testing'

import { isCardId, isFolderName, parseCard, soundCard, soundRecord, soundRunLaunch } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { picksPrint, retroCard, retroCardId, retroFolder, retroReason, retroTranscripts, wentWrong } from '../hooks/retro-coo.ts'
import type { Run } from '../types'

// La rétro lancée par le COO. Invariant : « Une piste de la rétro n'est découpée que si l'utilisateur l'a
// cochée ; une piste non cochée part dans À reprendre, jamais nulle part. »

const REPORT = (wrong: string) => `# Compte rendu : M\n\n## Fait\n- x\n\n## Ce qui s'est mal passé\n${wrong}\n\n## Bloqué par moi\nRien.\n`

const closed = (over: Partial<Run> = {}): Run => ({ ...newRun('implement', 1_000, 'Export CSV des tickets'), status: 'done', bornIn: 'aaaa1111-2222-3333-4444-555566667777', ...over }) as Run

test('la carte de rétro d’une mission : un id et un dossier en forme, toujours les mêmes pour elle', () => {
  const run = closed()
  const card = retroCard(run, null, 5_000)
  expect(isCardId(card.id)).toBe(true)
  expect(retroCardId(run.id)).toBe(card.id)
  expect(card).toMatchObject({ start: 'retro', of: run.id, title: 'Rétrospective · Export CSV des tickets', mode: 'auto', effort: 'high' })
  expect(card.folder).toMatch(/^retro-Export-CSV-des-tickets-[a-z0-9]+$/)
  expect(isFolderName(retroFolder({ ...run, title: 'Évolution « rapide » / ../x' } as Run))).toBe(true)
  expect(retroFolder({ ...run, title: '***' } as Run)).toMatch(/^retro-mission-[a-z0-9]+$/)
  // Deux missions au même titre, ou la rétro d'une rétro : jamais le même dossier.
  const twin = { ...run, id: `${run.id}x` } as Run
  expect(retroFolder(twin)).not.toBe(retroFolder(run))
  const retro = { ...run, id: 'mretro1', title: card.title, launch: { id: 'labcdefgh12', card: card.id, at: 0, folder: card.folder, start: 'retro', of: run.id, mode: 'auto' } } as Run
  expect(retroFolder(retro)).not.toBe(card.folder)
  // Relue de l'état de la discussion : la même carte, `of` compris.
  expect(soundCard(card)).toEqual(card)
})

test('la rétro est recommandée quand le rapport dit ce qui s’est mal passé ou que la mission a eu des workers', () => {
  expect(wentWrong(REPORT('Rien.'))).toBe(false)
  expect(wentWrong(REPORT('- Rien.'))).toBe(false)
  expect(wentWrong(REPORT('- Un test rouge : cause, corrigé.'))).toBe(true)
  expect(retroReason(closed(), REPORT('Rien.'))).toBeNull()
  expect(retroReason(closed(), REPORT('- Un retour en arrière.'))).toMatch(/mal passé/)
  const withWorker = closed({ groups: [{ id: 'A', name: 'a', tickets: [], linked: { session: 'bbbb1111-2222-3333-4444-555566667777' } }] } as unknown as Partial<Run>)
  expect(retroReason(withWorker, null)).toMatch(/workers/)
  expect(retroCard(closed(), null, 1).askMatt).toMatch(/^facultative/)
})

test('Claude ne propose jamais une carte de rétro : seul le mod la pose, avec l’id de la mission close', () => {
  const card = { title: 'Rétro', start: 'retro', of: 'mabc', askMatt: 'x', alts: [], mode: 'auto', effort: 'high', folder: 'retro-x' }
  expect(parseCard(card, 1, 'kabcdef12')).toEqual({ refused: expect.stringMatching(/"start" must be one of/) })
  expect('card' in parseCard(card, 1, 'kabcdef12', true)).toBe(true)
  // Une rétro sans mission close, ou une autre carte qui en porterait une : hors forme.
  expect(parseCard({ ...card, of: undefined }, 1, 'kabcdef12', true)).toEqual({ refused: expect.any(String) })
  expect(parseCard({ ...card, start: 'to-spec' }, 1, 'kabcdef12', true)).toEqual({ refused: expect.any(String) })
})

test('l’enregistrement de lancement et le rattachement d’une rétro gardent l’id de la mission close', () => {
  const rec = { v: 1, id: 'labcdefgh12', card: 'krabcdef12', root: '', title: 'R', start: 'retro', of: 'mclosed1', mode: 'auto', effort: 'high', folder: 'retro-x', at: 0, by: 'session-COO' }
  expect(soundRecord(rec)?.of).toBe('mclosed1')
  expect(soundRecord({ ...rec, of: '../x' })).toBeNull()
  expect(soundRecord({ ...rec, start: 'to-spec' })).toBeNull()
  const att = { id: 'labcdefgh12', card: 'krabcdef12', at: 0, folder: 'retro-x', start: 'retro', of: 'mclosed1', mode: 'auto' }
  expect(soundRunLaunch(att)?.of).toBe('mclosed1')
  expect(soundRunLaunch({ ...att, of: undefined })).toBeNull()
})

test('les transcripts de la mission close : seulement ceux listés sous le dossier des projets, les absents nommés', () => {
  const run = closed({ groups: [{ id: 'A', name: 'a', tickets: [], linked: { session: 'bbbb1111-2222-3333-4444-555566667777' } }] } as unknown as Partial<Run>)
  const listed = [{ path: '/h/.claude/projects/p/aaaa1111-2222-3333-4444-555566667777.jsonl', id: 'aaaa1111-2222-3333-4444-555566667777' }]
  expect(retroTranscripts(run, listed)).toEqual({ found: [listed[0]!.path], missing: ['bbbb1111-2222-3333-4444-555566667777'] })
  // Un id de discussion hors forme ne se cherche pas.
  expect(retroTranscripts(closed({ bornIn: '../../etc' }), listed)).toEqual({ found: [], missing: [] })
})

test('l’empreinte des pistes montrées change avec leur liste ou leurs libellés', () => {
  const a = [{ id: '1', label: 'Hooks : x' }, { id: '2', label: 'Docs : y' }]
  expect(picksPrint(a)).toBe(picksPrint([...a]))
  expect(picksPrint(a)).not.toBe(picksPrint([a[0]!]))
  expect(picksPrint(a)).not.toBe(picksPrint([a[0]!, { id: '2', label: 'Docs : z' }]))
})
