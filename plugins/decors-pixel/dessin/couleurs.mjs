// Calcule les couleurs de l'app sous chaque décor et les écrit dans
// hooks/palettes.js (et son .d.ts), que le mod lit tel quel.
//   node plugins/decors-pixel/dessin/couleurs.mjs <chemin de make-colors.js>
// make-colors.js tire une palette entière (une centaine de couleurs par mode,
// aux noms du système de design de l'app) de quelques teintes. Il est fourni par
// le skill plugin-authoring de Claude Code, qui affiche son dossier en se
// chargeant ; il change avec les versions et n'est pas dans ce dépôt. À relancer
// quand une teinte change ici, ou après une mise à jour de Claude Code.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const source = process.argv[2]
if (!source) throw new Error('usage : node couleurs.mjs <chemin de make-colors.js>')
const { makeColors } = await import(pathToFileURL(path.resolve(source)).href)

const DEFINITIONS = {
  // Paris : pierre de taille et zinc le jour, nuit bleue et or de la tour la nuit.
  PARIS: {
    label: 'Morkie à Paris',
    roles: { accent: '#3d6a99', danger: '#c0392f', success: '#2f7a52', warning: '#b9791a', pro: '#7a5aa6' },
    light: {
      gray: {
        anchors: {
          'surface-0': '#f0e8d9',
          'surface-1': '#f5efe3',
          'surface-2': '#fbf7ef',
          'text-primary': '#27242b',
          'text-secondary': '#4d4750',
          'text-muted': '#655d62',
        },
      },
    },
    dark: {
      roles: { accent: '#e9b949', warning: '#e88b2e', danger: '#e2575c', success: '#58b98a', pro: '#a78be0' },
      gray: {
        anchors: {
          'surface-0': '#141a2e',
          'surface-1': '#1a2138',
          'surface-2': '#212942',
          'surface-3': '#252d46',
          'text-primary': '#f4ecdc',
          'text-secondary': '#cfc8c0',
          'text-muted': '#a9a5ab',
        },
      },
    },
  },
  // Frissons 80 : les rôles aux couleurs des ampoules de la guirlande. L'accent est
  // un rouge néon tiré vers le carmin, l'erreur un rouge tiré vers le feu, pour qu'on
  // ne les confonde pas. En sombre, fonds nuit violet-noir et texte crème d'écran
  // cathodique ; en clair, papier lilas pâle et encre aubergine. Le décor, lui,
  // reste de nuit sous les deux.
  FRISSONS: {
    label: 'Frissons 80',
    roles: { accent: '#ff2d5f', danger: '#ff6b35', success: '#45e06a', warning: '#ffc23f', pro: '#4a9bff' },
    light: {
      roles: { accent: '#c2183f', danger: '#c2410c', success: '#1f8a3b', warning: '#a66a00', pro: '#2563c9' },
      gray: {
        anchors: {
          'surface-0': '#ebe5ee',
          'surface-1': '#f2edf4',
          'surface-2': '#f9f6fa',
          'text-primary': '#1d1626',
          'text-secondary': '#44394f',
          'text-muted': '#5e536b',
        },
      },
    },
    dark: {
      gray: {
        anchors: {
          'surface-0': '#0b0910',
          'surface-1': '#110e18',
          'surface-2': '#17131f',
          'surface-3': '#1e1927',
          'text-primary': '#f5ecdc',
          'text-secondary': '#dacdbb',
          'text-muted': '#ab9f91',
        },
      },
    },
  },
}

let js = '// Généré par dessin/couleurs.mjs : ne pas modifier à la main.\n'
let dts = "import type { ThemeColors } from 'claude-code'\n\n"
for (const [name, definition] of Object.entries(DEFINITIONS)) {
  const { theme, problems } = makeColors(definition)
  // Une ligne qui commence ainsi fait ignorer la palette entière par l'app, sans rien dire.
  const refused = problems.filter(line => line.startsWith("Desktop won't paint"))
  if (refused.length) throw new Error(`${name} : ${refused.join('\n')}`)
  js += `export const ${name} = ${JSON.stringify(theme)}\n`
  dts += `export const ${name}: ThemeColors\n`
  console.log(`${name} : ${Object.keys(theme.inputs).join(' + ')}, ${problems.length} remarque(s) de contraste sans refus`)
}
const hooks = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks')
fs.writeFileSync(path.join(hooks, 'palettes.js'), js)
fs.writeFileSync(path.join(hooks, 'palettes.d.ts'), dts)
