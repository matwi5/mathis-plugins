import { expect, test } from 'claude-code/testing'

import { maskSecrets } from '../hooks/timeline.ts'

// r14 de la rétro de l'onglet Agents : un secret long ou entre guillemets non fermés, laissé en
// clair (F1), avait échappé à cinq revues de code. Le masque se teste ici sur des cas générés
// (graine fixe, rejouable) : valeurs très longues, guillemets non fermés, plusieurs lignes, sous
// chaque forme reconnue. Propriété : le premier mot d'un secret ne sort jamais en clair, et une
// valeur entre guillemets fermés sur la ligne (400 signes au plus) ne laisse sortir aucun de ses mots.

/** Un générateur pseudo-aléatoire à graine (mulberry32) : les mêmes cas à chaque passage. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Des signes d'un secret : ni blanc, ni guillemet, ni `&` ou `;` (qui finissent une valeur `NOM=…` en shell).
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./+=:@!#%^*()[]{}<>?,~|'

/** Un mot de secret : il commence par « Zq » et un chiffre, pour ne jamais se trouver ailleurs par hasard. */
const word = (next: () => number, length: number): string => {
  let out = `Zq${Math.floor(next() * 10)}`
  while (out.length < length) out += CHARS[Math.floor(next() * CHARS.length)]
  return out
}

type Form = { name: string; build: (value: string) => string }
const FORMS: Form[] = [
  { name: 'option --password', build: v => `deploy --password ${v} --env prod` },
  { name: 'option --api-key=', build: v => `outil --api-key=${v}` },
  { name: 'affectation SECRET=', build: v => `export DB_PASSWORD=${v}` },
  { name: 'champ JSON', build: v => `{"client_secret": ${v}}` },
  { name: 'forme token:', build: v => `token: ${v}` },
  { name: 'en-tête Authorization', build: v => `curl -H "Authorization: Bearer ${v}" https://exemple.test` },
]

type Quote = 'none' | 'closed' | 'open'

test('le masque, sur 600 cas générés : premier mot jamais en clair ; valeur entre guillemets fermés masquée en entier', () => {
  const next = rng(20261027)
  const leaks: string[] = []
  for (let i = 0; i < 600; i++) {
    const form = FORMS[i % FORMS.length]!
    const quote: Quote = (['none', 'closed', 'open'] as const)[Math.floor(next() * 3)]!
    const q = next() < 0.5 ? '"' : "'"
    // Un mot très long une fois sur trois (jusqu'à 3 000 signes), sinon de 8 à 60.
    const first = word(next, next() < 0.33 ? 400 + Math.floor(next() * 2_600) : 8 + Math.floor(next() * 52))
    const more = quote === 'none' ? [] : Array.from({ length: Math.floor(next() * 4) }, () => word(next, 8 + Math.floor(next() * 20)))
    // Plusieurs lignes une fois sur quatre : la suite de la valeur passe à la ligne.
    const body = [first, ...more].join(next() < 0.25 ? '\n' : ' ')
    // L'en-tête Authorization est déjà entre guillemets doubles : la valeur n'en ajoute pas.
    const value = form.name === 'en-tête Authorization' || quote === 'none' ? body.split(/\s/)[0]! : quote === 'closed' ? `${q}${body}${q}` : `${q}${body}`
    const text = form.build(value)
    const out = maskSecrets(text)
    if (out.includes(first.slice(0, 12))) leaks.push(`${form.name}, ${quote} : premier mot en clair (${first.length} signes)`)
    const isWhole = quote === 'closed' && form.name !== 'en-tête Authorization' && !body.includes('\n') && value.length <= 402
    if (isWhole) for (const w of more) if (out.includes(w)) leaks.push(`${form.name}, ${quote} : mot « ${w.slice(0, 12)}… » en clair`)
  }
  expect(leaks).toEqual([])
})

test('dans le doute, le masque masque : une valeur coupée par une fin de ligne ou par la fin du texte', () => {
  const next = rng(7)
  for (let i = 0; i < 50; i++) {
    const secret = word(next, 20 + Math.floor(next() * 500))
    for (const text of [`--token "${secret}`, `PASSWORD='${secret}\nsuite`, `api_key: "${secret}`, `-----BEGIN PRIVATE KEY-----\n${secret}`]) {
      expect(maskSecrets(text).includes(secret.slice(0, 12))).toBe(false)
    }
  }
})
