// Écrit le module de scène que le mod importe (un .js et son .d.ts).
import fs from 'node:fs'

// La scène de Paris, en morceaux que le mod assemble à chaque dessin : l'ouverture,
// les couleurs du jour, celles de la nuit, le corps, la fin. Entre les deux derniers,
// il glisse la poursuite du rat quand vient son tour ; `loop` et `ambient` lui disent
// quelles animations caler sur l'heure du poste.
export function emitScene(dir, { open, css, cssNight, body, end, loop, rat, ambient }) {
  fs.mkdirSync(dir, { recursive: true })
  const values = {
    SVG_OPEN: open,
    CSS_DAY: css,
    CSS_NIGHT: cssNight,
    SVG_BODY: body,
    SVG_END: end,
    LOOP_SECONDS: loop.seconds,
    LOOP_CLASSES: loop.classes,
    RAT_AT: rat.at,
    RAT_CSS: rat.css,
    RAT_BODY: rat.body,
    AMBIENT: ambient,
  }
  const kind = v => (typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'readonly (readonly [string, number, number])[]')
  fs.writeFileSync(
    `${dir}/scene-paris.js`,
    '// Généré par dessin/build.mjs : ne pas modifier à la main.\n' +
      Object.entries(values).map(([name, v]) => `export const ${name} = ${JSON.stringify(v)}\n`).join(''),
  )
  fs.writeFileSync(
    `${dir}/scene-paris.d.ts`,
    Object.entries(values).map(([name, v]) => `export const ${name}: ${kind(v)}\n`).join(''),
  )
}
