// Les stations d'une mission (une par phase, ou une par étape pour une mission à une seule phase), calculées
// de son seul parcours (`Run`) : la frise de la vue Mission et celle du couloir de la vue Coordination les lisent, par le
// relevé du COO (`coo.ts`) pour la seconde. Module pur, qui ne dessine rien.

import type { Run } from '../types'
import { C, SKILLS } from './catalog.ts'
import { isPhaseOptional } from './model.ts'
import { countTickets, currentPhase } from './basics.ts'
import { type NodeState, type RoadNode } from './svg.ts'

/** Une durée courte, en espaces insécables (« 12 s », « 4 min », « 2 h 05 », « 3 j »). */
export const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}\u00a0s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}\u00a0min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}\u00a0h\u00a0${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}\u00a0j`
}

const phaseSub = (run: Run, index: number): string => {
  const p = run.phases[index]!
  if (p.status === 'done') return p.startedAt !== undefined && p.finishedAt !== undefined ? `✓ ${dur(p.finishedAt - p.startedAt)}` : '✓'
  if (p.status === 'skipped') return 'sautée'
  if (p.status === 'active') {
    const def = SKILLS[p.skill]
    const t = countTickets(run.tickets)
    if (def?.hasTickets && t.total > 0) return `${t.done}/${t.total} tickets`
    const at = p.steps.findIndex(s => s.status === 'active')
    return at >= 0 ? `étape ${at + 1}/${p.steps.length}` : 'en cours'
  }
  return isPhaseOptional(run, p) ? 'facultative' : ''
}

/**
 * Les stations : les phases, ou les étapes quand la mission n'a qu'une phase. Un skill absent du catalogue (une mission
 * écrite par une autre version du mod) donne une station grise à son id, jamais une erreur : le relevé du COO les calcule
 * pour toutes les missions.
 */
export const roadNodes = (run: Run): RoadNode[] => {
  if (run.phases.length === 1) {
    const only = run.phases[0]!
    const def = SKILLS[only.skill]
    return only.steps.map(s => {
      const sd = def?.steps.find(x => x.id === s.id)
      return {
        label: sd?.label ?? s.id,
        short: sd?.shortLabel,
        color: def?.color ?? C.gray,
        state: s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : s.status === 'skipped' ? 'skipped' : 'pending',
      }
    })
  }
  const nextAt =
    currentPhase(run).status === 'done' ? run.phases.findIndex((p, i) => i > run.cursor && p.status === 'pending') : -1
  return run.phases.map((p, i) => {
    const def = SKILLS[p.skill]
    const state: NodeState =
      p.status === 'done' ? 'done' : p.status === 'active' ? 'active' : p.status === 'skipped' ? 'skipped' : i === nextAt ? 'next' : 'pending'
    return {
      label: def?.label ?? p.skill,
      short: def?.shortLabel,
      sub: phaseSub(run, i),
      color: def?.color ?? C.gray,
      state,
      isOptional: isPhaseOptional(run, p),
      detours: p.detours.map(d => ({
        label: SKILLS[d.skill]?.label ?? d.skill,
        color: SKILLS[d.skill]?.color ?? C.gray,
        isActive: d.status === 'active',
      })),
    }
  })
}
