import { expect, test } from 'claude-code/testing'

import { abandonDelivery, finishUntidied, isDeliveryOpen, isDelivered, isShipped, newDelivery, nextStep, parseDelivery, reportStep, retryStep, startStep, type Delivery } from '../hooks/delivery.ts'

// La livraison lancée chez le COO. Invariant : « Rien n'est poussé sans un clic "▶ Livrer" de l'utilisateur ;
// une étape de la livraison ne part que si la précédente a réussi ; une seule livraison à la fois. »

const M = [{ id: 'm1', title: 'Mission', validatedAt: 1 }]

test('les étapes d’une livraison : version, push, pull request sur GitHub seulement, celles du projet, puis le rangement', () => {
  expect(newDelivery('d1', M, true, 1).steps.map(s => s.key)).toEqual(['version', 'push', 'pr', 'project', 'rangement'])
  expect(newDelivery('d1', M, false, 1).steps.map(s => s.key)).toEqual(['version', 'push', 'project', 'rangement'])
})

/** Les étapes qui livrent faites, une à une. */
const shipped = (d: Delivery): Delivery => {
  for (const key of ['version', 'push', 'pr', 'project'] as const) if (d.steps.some(s => s.key === key)) d = reportStep(startStep(d, key, 2)!, key, true, '', 3)!
  return d
}

test('le rangement ne part qu’en dernier ; les étapes qui livrent faites, la livraison reste ouverte jusqu’à son issue', () => {
  const d = newDelivery('d1', M, false, 1)
  expect(startStep(d, 'rangement', 2)).toBeNull()
  expect(isShipped(d)).toBe(false)
  const s = shipped(d)
  expect(isShipped(s)).toBe(true)
  expect(isDelivered(s)).toBe(false)
  expect(isDeliveryOpen(s)).toBe(true)
  expect(nextStep(s)?.key).toBe('rangement')
  const r = startStep(s, 'rangement', 4)!
  const done = reportStep(r, 'rangement', true, 'rien à ranger', 5)!
  expect(isDelivered(done)).toBe(true)
  expect(isDeliveryOpen(done)).toBe(false)
})

test('« ✕ Finir sans ranger » : seulement les étapes qui livrent faites et le rangement pas fini ; il ne change qu’elle', () => {
  const d = newDelivery('d1', M, false, 1)
  expect(finishUntidied(d, 2)).toBeNull()
  const s = shipped(d)
  for (const at of [s, startStep(s, 'rangement', 4)!, reportStep(startStep(s, 'rangement', 4)!, 'rangement', false, 'boîtes', 5)!]) {
    const out = finishUntidied(at, 6)!
    expect(isDeliveryOpen(out)).toBe(false)
    expect(out.steps.filter(x => x.key !== 'rangement')).toEqual(s.steps.filter(x => x.key !== 'rangement'))
    expect(out.steps.find(x => x.key === 'rangement')).toEqual({ key: 'rangement', status: 'failed', at: 6, detail: 'fini sans ranger' })
  }
  // Fini, ou déjà rangé : rien.
  expect(finishUntidied(reportStep(startStep(s, 'rangement', 4)!, 'rangement', true, '', 5)!, 6)).toBeNull()
  // « ✕ Abandonner » ne vaut pas pour un rangement arrêté, « ↻ Réessayer » si.
  const failed = reportStep(startStep(s, 'rangement', 4)!, 'rangement', false, 'boîtes', 5)!
  expect(abandonDelivery(failed, 6)).toBeNull()
  expect(nextStep(retryStep(failed)!)?.key).toBe('rangement')
})

test('une livraison gardée d’avant le rangement se relit et finit à sa dernière étape du projet', () => {
  const old = { ...newDelivery('d1', M, false, 1), steps: [{ key: 'version', status: 'done' }, { key: 'push', status: 'done' }, { key: 'project', status: 'running', at: 2 }] }
  const d = parseDelivery(JSON.parse(JSON.stringify(old)))!
  expect(d).not.toBeNull()
  const out = reportStep(d, 'project', true, '', 3)!
  expect(isDelivered(out)).toBe(true)
  expect(isDeliveryOpen(out)).toBe(false)
  expect(finishUntidied(d, 4)).toBeNull()
})

test('une étape ne part que si toutes celles d’avant sont faites', () => {
  const d = newDelivery('d1', M, false, 1)
  expect(startStep(d, 'push', 2)).toBeNull()
  const v = startStep(d, 'version', 2)!
  // Lancée, son issue attendue : rien d'autre ne part, elle-même non plus une seconde fois.
  expect(nextStep(v)).toBeNull()
  expect(startStep(v, 'version', 3)).toBeNull()
  expect(startStep(v, 'push', 3)).toBeNull()
  const done = reportStep(v, 'version', true, '0.80.0', 4)!
  expect(nextStep(done)?.key).toBe('push')
  expect(startStep(done, 'push', 5)).not.toBeNull()
})

test('une étape échouée arrête la suite ; « Réessayer » ne refait qu’elle, jamais une étape réussie', () => {
  let d = startStep(newDelivery('d1', M, false, 1), 'version', 2)!
  d = reportStep(d, 'version', true, 'ok', 3)!
  d = startStep(d, 'push', 4)!
  d = reportStep(d, 'push', false, 'rejeté par le distant', 5)!
  expect(nextStep(d)).toBeNull()
  expect(startStep(d, 'project', 6)).toBeNull()
  expect(isDeliveryOpen(d)).toBe(true)
  const again = retryStep(d)!
  expect(again.steps.map(s => s.status)).toEqual(['done', 'todo', 'todo', 'todo'])
  expect(nextStep(again)?.key).toBe('push')
})

test('une issue rendue pour une étape qui n’est pas lancée ne compte pas', () => {
  const d = newDelivery('d1', M, false, 1)
  expect(reportStep(d, 'version', true, 'ok', 2)).toBeNull()
  const v = startStep(d, 'version', 2)!
  expect(reportStep(v, 'push', true, 'ok', 3)).toBeNull()
})

test('une seule livraison à la fois : ouverte jusqu’à sa dernière étape faite, ou abandonnée après un échec', () => {
  let d = newDelivery('d1', M, false, 1)
  expect(isDeliveryOpen(d)).toBe(true)
  expect(abandonDelivery(d, 2)).toBeNull()
  for (const key of ['version', 'push', 'project', 'rangement'] as const) d = reportStep(startStep(d, key, 2)!, key, true, '', 3)!
  expect(isDelivered(d)).toBe(true)
  expect(isDeliveryOpen(d)).toBe(false)
  let f = startStep(newDelivery('d2', M, false, 1), 'version', 2)!
  f = reportStep(f, 'version', false, 'conflit', 3)!
  expect(isDeliveryOpen(abandonDelivery(f, 4)!)).toBe(false)
  expect(isDeliveryOpen(null)).toBe(false)
})

test('un état de livraison mal formé ne se lit pas : rien ne part', () => {
  const d = startStep(newDelivery('d1', M, true, 1), 'version', 2)!
  expect(parseDelivery(JSON.parse(JSON.stringify(d)))).toEqual(d)
  expect(parseDelivery({ ...d, steps: [...d.steps].reverse() })).toBeNull()
  expect(parseDelivery({ ...d, steps: [{ key: 'push', status: 'maybe' }] })).toBeNull()
  // Le rangement ailleurs qu'en dernier : l'ordre perdu.
  expect(parseDelivery({ ...d, steps: [d.steps[4], ...d.steps.slice(0, 4)] })).toBeNull()
  // Une étape partie après une étape pas faite (copie forgée ou coupée) : le rangement ne part jamais avant les étapes qui livrent.
  const forged = { ...d, steps: d.steps.map(s => (s.key === 'rangement' ? { key: 'rangement', status: 'running', at: 3 } : s)) }
  expect(parseDelivery(forged)).toBeNull()
  expect(parseDelivery({ ...d, steps: d.steps.map(s => (s.key === 'project' ? { key: 'project', status: 'done' } : s)) })).toBeNull()
  // Une étape inconnue (relue par une version plus ancienne, ou forgée) : mal formé.
  expect(parseDelivery({ ...d, steps: [...d.steps, { key: 'menage', status: 'todo' }] })).toBeNull()
  expect(parseDelivery({ ...d, id: '../x' })).toBeNull()
  expect(parseDelivery('x')).toBeNull()
})

test('le détail rendu d’une étape tient sur une ligne, sans caractère de contrôle', () => {
  const d = reportStep(startStep(newDelivery('d1', M, false, 1), 'version', 2)!, 'version', true, 'flow-board\n0.80.0\u001b[31m', 3)!
  expect(d.steps[0]!.detail).not.toMatch(/[\n\u001b]/)
})

test('un état sans la version, le push ou les étapes du projet ne se lit pas', () => {
  const d = newDelivery('d1', M, true, 1)
  expect(parseDelivery({ ...d, steps: d.steps.filter(s => s.key !== 'push') })).toBeNull()
  expect(parseDelivery({ ...d, steps: d.steps.filter(s => s.key !== 'pr') })).not.toBeNull()
})
