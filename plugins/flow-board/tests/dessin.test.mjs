// Contrôles mécaniques du dessin (r4 de la rétro de l'onglet Agents) : les pièges du desktop que
// l'en-tête de view.tsx décrit, relevés jusqu'ici à la main par les relecteurs. Les espaces
// ordinaires d'un texte y sont fondus, `gap` y est ignoré, et une prop passée à `undefined`
// rend l'arbre invalide.
//
// Un test Node (node --test, lancé par scripts/check.sh) : `claude plugin test` n'ouvre aucun
// fichier, et ces règles se lisent dans le source.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const FILES = ['hooks/view.tsx', 'hooks/cells.ts', 'hooks/svg.ts']
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/** Le source sans ses commentaires, les chaînes gardées (un `//` dans une URL reste du texte). */
const withoutComments = src => {
  let out = ''
  let i = 0
  let quote = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      out += c
      if (c === '\\') {
        out += src[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
      i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const cut = src.slice(i, end < 0 ? src.length : end + 2)
      out += cut.replace(/[^\n]/g, ' ')
      i = end < 0 ? src.length : end + 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** Un gabarit dont chaque `${…}` (accolades imbriquées comprises) devient un seul signe : seul son texte compte. */
const textOf = literal => {
  let out = ''
  for (let i = 0; i < literal.length; i++) {
    if (literal[i] === '$' && literal[i + 1] === '{') {
      let depth = 0
      let j = i + 1
      for (; j < literal.length; j++) {
        if (literal[j] === '{') depth += 1
        else if (literal[j] === '}' && --depth === 0) break
      }
      out += 'x'
      i = j
      continue
    }
    out += literal[i]
  }
  return out
}

/** Les littéraux de chaîne d'une ligne (simples, doubles, gabarits sur une ligne), avec leur numéro de ligne. */
const literals = src => {
  const found = []
  src.split('\n').forEach((text, n) => {
    for (const m of text.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g)) found.push({ line: n + 1, text: m[0] })
  })
  return found
}

for (const file of FILES) {
  const src = withoutComments(read(file))

  test(`${file} : pas deux espaces ordinaires de suite dans un texte ou un gabarit affiché`, () => {
    const bad = literals(src).filter(l => / {2}/.test(textOf(l.text)))
    assert.deepEqual(bad.map(l => `${file}:${l.line} ${l.text}`), [])
  })

  test(`${file} : pas de gap, que le desktop ignore`, () => {
    const bad = src.split('\n').flatMap((text, n) => (/\bgap=\{|[{,]\s*gap\s*:/.test(text) ? [`${file}:${n + 1} ${text.trim()}`] : []))
    assert.deepEqual(bad, [])
  })

  test(`${file} : aucune prop passée à undefined`, () => {
    const bad = src.split('\n').flatMap((text, n) => (/\w=\{\s*undefined\s*\}|\w=\{[^{}]*[?:]\s*undefined\s*\}/.test(text) ? [`${file}:${n + 1} ${text.trim()}`] : []))
    assert.deepEqual(bad, [])
  })
}

// Les teintes des attentes de la frise (gris, ambre, bleu, or) restent distinctes : l'or de l'advisor et
// l'ambre de « attend ta réponse » se confondaient sur la planche (rétro du parcours « Frise, groupes
// et titres »). Distance ΔE76 (CIE Lab, sRGB D65) : au moins 10 entre les teintes pleines, et au moins
// 15 entre les motifs tels qu'ils se voient (hachures ou pointillés fondus sur le fond foncé du terminal
// et sur un fond blanc). Un or ramené vers l'ambre (#DCAA28, ΔE 2) échoue.
const TINT_MIN = 10
const PATTERN_MIN = 15

const lab = hex => {
  const lin = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047)
  const y = f(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2])
  const z = f((0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]))
const blend = (hex, alpha, bg) =>
  `#${[1, 3, 5].map(i => Math.round(alpha * parseInt(hex.slice(i, i + 2), 16) + (1 - alpha) * parseInt(bg.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('')}`

/** Les teintes des attentes dans svg.ts, et la couverture de leur motif (fond translucide plus trait ou point plein). */
const waitLooks = () => {
  const svg = read('hooks/svg.ts')
  const tints = Object.fromEntries([...svg.match(/const WAIT_TINT[^=]*= \{([^}]*)\}/)[1].matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map(m => [m[1], m[2]]))
  const dots = svg.match(/<rect width="4" height="4" fill="\$\{WAIT_TINT\[k\]\}" fill-opacity="([\d.]+)"\/><circle cx="2" cy="2" r="([\d.]+)"/)
  const hatch = svg.match(/fill-opacity="([\d.]+)"\/><line x1="0" y1="0" x2="0" y2="4" stroke="\$\{WAIT_TINT\[k\]\}" stroke-width="([\d.]+)"/)
  assert.ok(dots && hatch, 'motifs des attentes introuvables dans svg.ts')
  const dotShare = (Math.PI * Number(dots[2]) ** 2) / 16
  const lineShare = Number(hatch[2]) / 4
  const cover = {
    dots: dotShare + (1 - dotShare) * Number(dots[1]),
    hatch: lineShare + (1 - lineShare) * Number(hatch[1]),
  }
  return { tints, cover }
}

test('teintes des attentes : distinctes deux à deux, pleines et en motifs (pointillés de l’advisor compris)', () => {
  const { tints, cover } = waitLooks()
  assert.deepEqual(Object.keys(tints).sort(), ['waitAdvisor', 'waitAgent', 'waitBg', 'waitPerson'])
  // Le terminal (cells.ts) prend les mêmes teintes, par la palette.
  const palette = Object.fromEntries([...read('hooks/catalog.ts').matchAll(/^\s+(\w+): '(#[0-9A-Fa-f]{6})'/gm)].map(m => [m[1], m[2]]))
  const cells = Object.fromEntries([...read('hooks/cells.ts').match(/WAIT_COLOR[^=]*= \{([^}]*)\}/)[1].matchAll(/(\w+): C\.(\w+)/g)].map(m => [m[1], palette[m[2]]]))
  assert.deepEqual(cells, tints)
  const kinds = Object.keys(tints)
  const close = []
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      const [a, b] = [kinds[i], kinds[j]]
      const plain = deltaE(tints[a], tints[b])
      if (plain < TINT_MIN) close.push(`${a}/${b} pleines : ${plain.toFixed(1)}`)
      for (const bg of ['#17171C', '#FFFFFF']) {
        const look = k => blend(tints[k], k === 'waitAdvisor' ? cover.dots : cover.hatch, bg)
        const seen = deltaE(look(a), look(b))
        if (seen < PATTERN_MIN) close.push(`${a}/${b} en motif sur ${bg} : ${seen.toFixed(1)}`)
      }
    }
  }
  assert.deepEqual(close, [])
  // Le test voit un or ramené vers l'ambre.
  assert.ok(deltaE('#DCAA28', tints.waitPerson) < TINT_MIN)
})
