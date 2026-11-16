// Le classement des skills vit dans leur fiche (`SkillFlags` de catalog.ts) : chaque fiche de `SKILLS` déclare
// chaque drapeau, `true` ou `false`, et les membres de chaque classement sont ceux qu'avaient les listes qu'ils
// remplacent : un skill neuf échoue ici tant qu'il n'est pas classé, et un drapeau changé par erreur change un
// membre attendu.

import { expect, test } from 'claude-code/testing'

import { CODE_SKILLS, SKILLS, SKILL_FLAGS, skillsWith, type SkillFlags } from '../hooks/catalog.ts'
import { AUTO_PHASES } from '../hooks/model.ts'

/** Les membres de chaque classement, relevés sur les listes d'avant les drapeaux (`12862e97`). */
const MEMBERS: Record<keyof SkillFlags, readonly string[]> = {
  isGrilling: ['grill-with-docs', 'grill-me', 'grilling'],
  isModelFraming: ['grilling', 'grill-with-docs', 'grill-me', 'to-questionnaire', 'to-spec', 'to-tickets', 'domain-modeling'],
  isNotesFraming: ['grilling', 'grill-with-docs', 'grill-me', 'to-questionnaire', 'to-spec', 'to-tickets', 'domain-modeling', 'triage'],
  isSplitPhase: ['to-spec', 'to-tickets'],
  isCodePhase: ['implement', 'tdd', 'diagnosing-bugs', 'prototype'],
  isLotPhase: ['implement', 'tdd'],
  isAutoPhase: ['to-spec', 'to-tickets', 'implement', 'compte-rendu'],
  hasReviewNotes: ['implement', 'final-review', 'code-review', 'branch-review'],
  publishesLot: ['to-tickets', 'to-spec', 'triage'],
}

const sorted = (ids: Iterable<string>): string[] => [...ids].sort()

test('chaque fiche de SKILLS déclare chaque drapeau de classement, true ou false', () => {
  const undeclared = Object.entries(SKILLS).flatMap(([key, def]) =>
    SKILL_FLAGS.filter(flag => typeof (def as Record<string, unknown>)[flag] !== 'boolean').map(flag => `${key}.${flag}`),
  )
  expect(Object.keys(SKILLS).length > 0).toBe(true)
  expect(undeclared).toEqual([])
})

test('les drapeaux de classement sont ceux de SkillFlags, chacun avec ses membres attendus', () => {
  expect(sorted(SKILL_FLAGS)).toEqual(sorted(Object.keys(MEMBERS)))
  for (const flag of SKILL_FLAGS) expect({ flag, members: sorted(skillsWith(flag)) }).toEqual({ flag, members: sorted(MEMBERS[flag]) })
})

test('le tri est un cadrage pour les consignes, pas pour le modèle', () => {
  expect(SKILLS['triage']!.isNotesFraming).toBe(true)
  expect(SKILLS['triage']!.isModelFraming).toBe(false)
})

test('CODE_SKILLS et AUTO_PHASES, toujours exportés, sont calculés depuis les drapeaux', () => {
  expect(sorted(CODE_SKILLS)).toEqual(sorted(MEMBERS.isCodePhase))
  expect(sorted(AUTO_PHASES)).toEqual(sorted(MEMBERS.isAutoPhase))
})

test('chaque fiche porte son propre id : un drapeau se lit sous la clé qui le déclare', () => {
  const mismatched = Object.entries(SKILLS).filter(([key, def]) => def.id !== key).map(([key]) => key)
  expect(mismatched).toEqual([])
})
