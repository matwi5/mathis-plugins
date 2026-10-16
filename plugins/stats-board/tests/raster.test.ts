import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT, columnsCells, heatCells, heatLegendCells, pack, rgb, tint } from '../hooks/raster.ts'

describe('raster', () => {
  test('pack : triplets u32 little-endian, rangée par rangée, en base64 avec bourrage', () => {
    // L'exemple de RasterProps : une case mandarine.
    expect(pack([[[0x2588, 0xff8800, DEFAULT]]])).toEqual({ columns: 1, rows: 1, cells: 'iCUAAACI/wAAAAAB' })
    expect(pack([[[0x2588, 0xff8800, DEFAULT], [0x20, DEFAULT, DEFAULT]]]).cells).toBe('iCUAAACI/wAAAAABIAAAAAAAAAEAAAAB')
  })

  test('couleurs : #RRGGBB, et les niveaux posés sur le fond foncé', () => {
    expect(rgb('#FF8800')).toBe(0xff8800)
    expect(tint('#FF8800', 1)).toBe(0xff8800)
    expect(tint('#FF8800', 0)).toBe(rgb('#17171C'))
  })

  test('colonnes : une frontière entre deux parts tombe au huitième, avant-plan en bas, fond en haut', () => {
    const drawn = columnsCells([2], 1, '#000000', 1, -1, [[{ value: 1, color: '#FF0000' }, { value: 1, color: '#00FF00' }]])
    // ▄ (U+2584) rouge sur fond vert.
    expect(drawn).toEqual({ columns: 1, rows: 1, cells: 'hCUAAAAA/wAA/wAA' })
  })

  test('colonnes : dimensions, une case vide entre deux colonnes quand `cell` vaut 2', () => {
    const drawn = columnsCells([1, 2, 3], 5, '#4A9EE8', 2)
    expect(drawn.columns).toBe(6)
    expect(drawn.rows).toBe(5)
    expect((drawn.cells.length / 4) * 3 - (drawn.cells.endsWith('==') ? 2 : drawn.cells.endsWith('=') ? 1 : 0)).toBe(6 * 5 * 12)
  })

  test('calendrier : 7 rangées, une colonne par semaine ; légende de cinq teintes', () => {
    const week = [{ date: '2026-10-05', level: 4, isToday: false }, null, null, null, null, null, null]
    const drawn = heatCells([week, week], '#D9A520', 1)
    expect(drawn).toMatchObject({ columns: 2, rows: 7 })
    expect(heatLegendCells('#D9A520')).toMatchObject({ columns: 5, rows: 1 })
  })
})
