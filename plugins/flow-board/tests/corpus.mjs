// Le corpus hostile commun des gardes de forme (CODING_STANDARDS.md, « Un garde de forme passe le
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
