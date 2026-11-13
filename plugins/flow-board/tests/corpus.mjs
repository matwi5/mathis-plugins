// Le corpus hostile commun des gardes de forme, avec les familles de la classe « ligne sûre » (CODING_STANDARDS.md, « Un garde de forme passe le
// corpus hostile commun ») : corpus-hostile.test.ts y passe les gardes du mod, instantane.test.mjs
// celui du script d'instantané. Les caractères s'écrivent par leur point de code : un caractère
// invisible ou un séparateur de ligne écrit tel quel dans la source ne se relit pas, et U+2028 y
// couperait la ligne.

/** Une chaîne de ces points de code. */
export const ch = (...codes) => String.fromCodePoint(...codes)

/** Le corpus : chaque entrée, glissée au milieu d'une valeur par ailleurs valide, doit la rendre refusée. */
export const CORPUS = {
  // Sosies du « · » qui ouvre une section d'une réponse de l'outil.
  'point médian U+00B7': ch(0xb7),
  'point grec U+0387': ch(0x387),
  'point de césure U+2027': ch(0x2027),
  'opérateur puce U+2219': ch(0x2219),
  'opérateur point U+22C5': ch(0x22c5),
  'point katakana U+30FB': ch(0x30fb),
  'point katakana demi-chasse U+FF65': ch(0xff65),
  // Apostrophes et guillemets : POSIX et PowerShell citent par eux.
  apostrophe: "'",
  'apostrophe ouvrante U+2018': ch(0x2018),
  'apostrophe fermante U+2019': ch(0x2019),
  'apostrophe basse U+201A': ch(0x201a),
  'apostrophe renversée U+201B': ch(0x201b),
  'lettre apostrophe U+02BC': ch(0x2bc),
  guillemet: '"',
  // C0, DEL et C1.
  'nul U+0000': ch(0),
  'cloche U+0007': ch(7),
  'tabulation U+0009': ch(9),
  'saut de ligne U+000A': ch(0xa),
  'tabulation verticale U+000B': ch(0xb),
  'saut de page U+000C': ch(0xc),
  'retour chariot U+000D': ch(0xd),
  'échappement U+001B': ch(0x1b),
  'séparateur d’unité U+001F': ch(0x1f),
  'DEL U+007F': ch(0x7f),
  'C1 U+0080': ch(0x80),
  'ligne suivante U+0085': ch(0x85),
  'C1 U+009F': ch(0x9f),
  'séparateur de ligne U+2028': ch(0x2028),
  'séparateur de paragraphe U+2029': ch(0x2029),
  // Lettres et chiffres qui changent de forme à la normalisation ou à la casse.
  'signe Kelvin U+212A': ch(0x212a),
  'ligature fi U+FB01': ch(0xfb01),
  'chiffre pleine chasse U+FF11': ch(0xff11),
  'lettre pleine chasse U+FF21': ch(0xff21),
  'e accent aigu U+00E9': ch(0xe9),
  // Invisibles.
  'espace insécable U+00A0': ch(0xa0),
  'espace sans chasse U+200B': ch(0x200b),
  'liant sans chasse U+200D': ch(0x200d),
  'renversement droite-gauche U+202E': ch(0x202e),
  'indicateur d’ordre U+FEFF': ch(0xfeff),
  'trait d’union conditionnel U+00AD': ch(0xad),
  'marque de lettre arabe U+061C': ch(0x61c),
  'séparateur de voyelle mongol U+180E': ch(0x180e),
  'sélecteur de variante U+FE0F': ch(0xfe0f),
  'sélecteur de variante U+E0100': ch(0xe0100),
  'étiquette U+E0041': ch(0xe0041),
  'point réservé du bloc des étiquettes U+E0000': ch(0xe0000),
  'invisible non assigné U+2065': ch(0x2065),
  'sélecteur de variante mongol U+180B': ch(0x180b),
  'fin d’étiquette U+E007F': ch(0xe007f),
  'remplissage hangûl U+3164': ch(0x3164),
  // Sosies de crochets et de guillemets « », qui fermeraient une citation ou un [id].
  'chevrons mathématiques U+27E8 U+27E9': ch(0x27e8, 0x27e9),
  'chevrons doubles U+27EA U+27EB': ch(0x27ea, 0x27eb),
  'crochets lenticulaires U+3010 U+3011': ch(0x3010, 0x3011),
  'crochets en écaille U+3014 U+3015': ch(0x3014, 0x3015),
  'parenthèses blanches U+2985 U+2986': ch(0x2985, 0x2986),
  // Le shell.
  espace: ' ',
  substitution: '$(touch x)',
  'accent grave': '`x`',
  'point-virgule': ';',
  esperluette: '&',
  barre: '|',
  joker: '*',
  remontée: '/../',
  // Une chaîne très longue.
  'chaîne très longue': 'a'.repeat(5000),
}

/**
 * Les valeurs qui ne sont pas du texte, qu'un fichier relu ou un envoi peut porter à la place d'une
 * chaîne : elles se passent entières (pas glissées dans une valeur, où `ab${null}cd` deviendrait
 * « abnullcd »). Un garde de forme les refuse toutes ; une neutralisation les accepte sans lever
 * d'erreur et rend un texte.
 */
export const NON_TEXT = {
  null: null,
  undefined: undefined,
  nombre: 42,
  'nombre non fini': Number.POSITIVE_INFINITY,
  booléen: true,
  'tableau vide': [],
  'tableau de texte': ['ab'],
  'objet vide': {},
  'objet avec toString': { toString: () => 'ab' },
}

/** Les points de code de `from` à `to`, bornes comprises. */
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

/**
 * La classe « ligne sûre » : les familles qu'un garde de ligne sûre refuse, chacune par ses points de
 * code (pas par la regex d'un garde, qu'elle éprouve), et les sosies de guillemets et d'apostrophes
 * qu'il garde, puisqu'ils n'ouvrent pas de ligne. Les marques bidirectionnelles retenues sont celles
 * qui ouvrent un enchâssement, un forçage ou un isolement : elles retournent l'affichage d'une ligne.
 */
export const LINE_BREAKERS = {
  'fins de ligne': [0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029],
  'contrôles C0': range(0x00, 0x1f),
  'contrôles C1 et DEL': range(0x7f, 0x9f),
  'marques bidirectionnelles d’enchâssement, de forçage et d’isolement': [...range(0x202a, 0x202e), ...range(0x2066, 0x2069)],
}
export const QUOTE_LOOKALIKES = ["'", '"', ch(0x2018), ch(0x2019), ch(0x201a), ch(0x201b), ch(0x201c), ch(0x201d), ch(0x2bc), ch(0xab), ch(0xbb)]
