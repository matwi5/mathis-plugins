"""Tests du lecteur des lignes de commentaire d'un module TypeScript (scripts/commentaires.py), qui fait
sauter au pre-commit la suite d'un plugin quand un commit ne change que des commentaires de `hooks/` :
python3 -m unittest discover -s scripts/tests."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import commentaires  # noqa: E402


def changed(old, new):
    """Les lignes retirées (numéros de `old`) et ajoutées (numéros de `new`) quand les deux textes ont le
    même nombre de lignes et ne diffèrent que ligne à ligne : comme les blocs de `git diff -U0`."""
    a, b = old.split("\n"), new.split("\n")
    assert len(a) == len(b)
    lines = [k + 1 for k, (x, y) in enumerate(zip(a, b)) if x != y]
    return lines, lines


def only_comments(old, new, tsx=False):
    removed, added = changed(old, new)
    return commentaires.comment_only(old, new, removed, added, tsx)


# (nom, version d'avant, version d'après, .tsx, attendu) : ce que le pre-commit peut traiter comme des
# commentaires seuls, et chaque forme qui doit rester du code (la suite entière tourne).
CASES = [
    ("ligne // changée", "const a = 1\n// avant\nconst b = 2", "const a = 1\n// après\nconst b = 2", False, True),
    ("intérieur d'un /** */", "/**\n * avant\n */\nexport function f() {}", "/**\n * après\n */\nexport function f() {}", False, True),
    ("ligne qui mêle code et commentaire", "const a = 1 // avant", "const a = 1 // après", False, False),
    ("// dans une chaîne", "const s = \"a // avant\"", "const s = \"a // après\"", False, False),
    ("// dans une chaîne entre apostrophes", "const s = 'a // avant'", "const s = 'a // après'", False, False),
    ("// dans une ligne d'un gabarit", "const s = `\n// avant\n`", "const s = `\n// après\n`", False, False),
    ("/* dans un gabarit", "const s = `x\n/* avant */\n`", "const s = `x\n/* après */\n`", False, False),
    ("// dans le gabarit d'une expression ${}", "const s = `${f(`\n// avant\n`)}`", "const s = `${f(`\n// après\n`)}`", False, False),
    ("texte JSX", "const v = () =>\n  <Text>\n// avant\n</Text>", "const v = () =>\n  <Text>\n// après\n</Text>", True, False),
    ("commentaire avant le JSX d'un .tsx", "// avant\nconst v = () => <Text>x</Text>", "// après\nconst v = () => <Text>x</Text>", True, True),
    ("commentaire après le JSX d'un .tsx", "const v = () => <Text>x</Text>\n// avant", "const v = () => <Text>x</Text>\n// après", True, False),
    ("*/ retiré : du code passe en commentaire", "/* a\n*/\nconst b = 2\n/* c */", "/* a\n\nconst b = 2\n/* c */", False, False),
    ("/* ajouté : du code passe en commentaire", "// a\nconst b = 2\n// c */", "/* a\nconst b = 2\n// c */", False, False),
    ("ligne vide ajoutée près d'un commentaire", "const a = 1\n// x\n\nconst b = 2", "const a = 1\n// y\n// z\nconst b = 2", False, True),
    ("expression régulière qui porte des guillemets", "const r = /[\"'`]/g\n// avant", "const r = /[\"'`]/g\n// après", False, True),
    ("expression régulière qui porte //", "const r = /a\\/\\/b/\n// avant", "const r = /a\\/\\/b/\n// après", False, True),
    ("division suivie d'un /* sur plusieurs lignes", "const a = b / c /* x\n avant */", "const a = b / c /* x\n après */", False, False),
    ("division suivie d'un gabarit sur plusieurs lignes", "const a = b / c + `\n// avant\n`", "const a = b / c + `\n// après\n`", False, False),
    ("assertion non nulle puis division", "const f = m[r]![c]! / m[c]![c]!\n// avant", "const f = m[r]![c]! / m[c]![c]!\n// après", False, True),
    ("JSX après export default", "export default <View>\n// avant\n<Text>a</Text>\n</View>", "export default <View>\n// après\n<Text>a</Text>\n</View>", True, False),
    ("JSX après « : »", "x = cond ? a : <View>\n// avant\n</View>", "x = cond ? a : <View>\n// après\n</View>", True, False),
    ("++ suffixe puis division", "const z = i++ / 2 + `a/b\n// avant\n`\nconst w = 1 // `", "const z = i++ / 2 + `a/b\n// après\n`\nconst w = 1 // `", False, False),
    ("-- suffixe puis division", "const z = i-- / 2 + `a/b\n// avant\n`\nconst w = 1 // `", "const z = i-- / 2 + `a/b\n// après\n`\nconst w = 1 // `", False, False),
    ("} puis /", "const z = {} / 2 + `a/b\n// avant\n`", "const z = {} / 2 + `a/b\n// après\n`", False, False),
    ("mot contextuel puis /", "const of = 4\nconst z = of / 2 + `a/b\n// avant\n`", "const of = 4\nconst z = of / 2 + `a/b\n// après\n`", False, False),
    ("propriété au nom réservé puis division", "const z = o.default / 2\n// avant", "const z = o.default / 2\n// après", False, True),
    ("pragma JSX ajouté", "// a\nconst v = 1", "/** @jsxImportSource preact */\nconst v = 1", True, False),
    ("directive @ts- changée", "// @ts-expect-error avant\nconst v = 1", "// @ts-expect-error après\nconst v = 1", False, False),
    ("référence /// changée", "/// <reference types=\"a\" />\nconst v = 1", "/// <reference types=\"b\" />\nconst v = 1", False, False),
    ("chaîne non fermée", "const s = 'a\n// avant", "const s = 'a\n// après", False, False),
    ("commentaire non fermé", "/* a\n// avant", "/* a\n// après", False, False),
    ("rien de changé", "// a", "// a", False, False),
    ("code changé", "const a = 1", "const a = 2", False, False),
    ("blancs d'une chaîne", "const s = 'a b'", "const s = 'a  b'", False, False),
]


class CommentOnlyTest(unittest.TestCase):
    def test_chaque_forme_du_corpus(self):
        for name, old, new, tsx, expected in CASES:
            with self.subTest(name):
                self.assertIs(only_comments(old, new, tsx), expected)

    def test_un_saut_de_ligne_retire_entre_deux_jetons_compte(self):
        # L'insertion automatique des points-virgules : `return\nx` ne vaut pas `return x`.
        old, new = "return /* a\n */ x", "return /* a */ x"
        self.assertFalse(commentaires.comment_only(old, new, [1, 2], [1]))

    def test_le_doute_dit_sa_raison(self):
        self.assertIsNone(commentaires.lex("const s = 'a\n"))
        self.assertEqual(commentaires.LAST_DOUBT, ["chaîne coupée par un saut de ligne", 1])


if __name__ == "__main__":
    unittest.main()
