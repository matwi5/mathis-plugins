"""Tests de scripts/show.py : python3 -m unittest discover -s scripts/tests."""

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "show.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8")


class ShowTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / "doc.md"
        lines = [f"ligne {n}" for n in range(1, 41)]
        lines[9] = "## Règles (git, $(x) et [crochets])"
        lines[29] = "## Règles (git, $(x) et [crochets]) bis"
        self.file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_affiche_la_plage_depuis_le_motif_litteral_avec_les_numeros(self):
        out = run(str(self.file), "Règles (git, $(x) et [crochets])", "+3")
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = out.stdout.splitlines()
        self.assertEqual(rows[:4], ["10\t## Règles (git, $(x) et [crochets])", "11\tligne 11", "12\tligne 12", "13\tligne 13"])
        self.assertIn("aussi ligne 30", out.stdout)

    def test_sans_nombre_la_plage_par_defaut_et_la_fin_du_fichier(self):
        out = run(str(self.file), "ligne 38")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.splitlines(), ["38\tligne 38", "39\tligne 39", "40\tligne 40"])

    def test_un_motif_absent_sort_en_erreur(self):
        out = run(str(self.file), "absent")
        self.assertEqual(out.returncode, 1)
        self.assertIn("ÉCHEC", out.stderr)
        self.assertEqual(out.stdout, "")

    def test_un_motif_absent_donne_la_ligne_la_plus_proche(self):
        self.file.write_text("# Titre\nexport function calculerTotal(lignes) {\n  return 0\n}\nfin\n", encoding="utf-8")
        out = run(str(self.file), "function calculeTotal(")
        self.assertEqual(out.returncode, 1)
        self.assertIn("ligne la plus proche : 2 : export function calculerTotal(lignes) {", out.stderr)

    def test_la_ligne_la_plus_proche_d_un_fragment_sur_une_longue_ligne(self):
        long_line = "x" * 4000 + " le réglage « revue de sécurité » par projet " + "y" * 4000
        self.file.write_text(f"court\nun réglage\n{long_line}\nfin\n", encoding="utf-8")
        out = run(str(self.file), "le réglage « revue de securité » par projet")
        self.assertEqual(out.returncode, 1)
        self.assertIn("ligne la plus proche : 3 : ", out.stderr)
        self.assertLess(len(out.stderr), 600)

    def test_un_fichier_vide_sans_ligne_proche(self):
        self.file.write_text("", encoding="utf-8")
        out = run(str(self.file), "x")
        self.assertEqual(out.returncode, 1)
        self.assertNotIn("plus proche", out.stderr)

    def test_arguments_et_fichier_invalides(self):
        self.assertEqual(run(str(self.file)).returncode, 2)
        self.assertEqual(run(str(self.file), "ligne", "3").returncode, 2)
        self.assertEqual(run(str(self.file), "ligne", "+0").returncode, 2)
        self.assertEqual(run(str(Path(self.dir.name) / "absent.md"), "ligne").returncode, 1)


class ListeTest(unittest.TestCase):
    """`show.py --liste <fichier> <motif>` : une ligne par occurrence, son numéro et un extrait borné
    autour du motif, même sur une ligne de plusieurs milliers de caractères."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / "README.md"
        long_line = "a" * 3000 + " Rétro du lien " + "b" * 3000 + " Rétro du lien " + "c" * 50
        self.file.write_text(f"# Titre\nla Rétro du lien\n{long_line}\nfin\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_une_ligne_par_occurrence_avec_son_numero_et_un_extrait_borne(self):
        out = run("--liste", str(self.file), "Rétro du lien")
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = out.stdout.splitlines()
        self.assertEqual(rows[0], "2\tla Rétro du lien")
        self.assertEqual(len(rows), 3)
        for row in rows[1:]:
            self.assertTrue(row.startswith("3\t…"), row)
            self.assertIn("Rétro du lien", row)
            self.assertLess(len(row), 260)
        self.assertTrue(rows[1].endswith("…"))
        self.assertTrue(rows[2].endswith("c" * 50))

    def test_un_motif_absent_rend_le_code_1(self):
        out = run("--liste", str(self.file), "absent")
        self.assertEqual(out.returncode, 1)
        self.assertIn("ÉCHEC", out.stderr)
        self.assertEqual(out.stdout, "")

    def test_un_fichier_absent_ou_un_motif_vide_sont_des_erreurs(self):
        self.assertEqual(run("--liste", str(Path(self.dir.name) / "absent.md"), "x").returncode, 1)
        self.assertEqual(run("--liste", str(self.file), "").returncode, 2)
        out = run("--liste", str(self.file))
        self.assertEqual(out.returncode, 2)
        self.assertIn("--liste <fichier> <motif>", out.stderr)
        self.assertIn("<motif> [+N]", run(str(self.file)).stderr)


MODULE = """import { x } from './x'

/** Une fonction. */
export function alpha(a: number): number {
  return a
}

// ─── Section détachée ───

/**
 * La const fléchée.
 */
const beta = (
  b: string,
): string =>
  b.trim()

export type Gamma = {
  g: number
}
const TEST_RE =
  /\\b(?:vitest)\\b/i
function doublon() {}
const autre = 1
function doublon() {}
"""


class DeclTest(unittest.TestCase):
    """`show.py --decl <fichier> <nom>` : la déclaration de premier niveau entière, commentaire de tête
    compris, numérotée comme Read."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / "module.ts"
        self.file.write_text(MODULE, encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def decl(self, name):
        out = run("--decl", str(self.file), name)
        self.assertEqual(out.returncode, 0, out.stderr)
        return out.stdout.splitlines()

    def test_une_fonction_avec_son_commentaire_de_tete(self):
        self.assertEqual(self.decl("alpha"), [
            "3\t/** Une fonction. */", "4\texport function alpha(a: number): number {", "5\t  return a", "6\t}"])

    def test_une_const_flechee_sur_plusieurs_lignes_sans_le_commentaire_detache(self):
        rows = self.decl("beta")
        self.assertEqual(rows[0], "10\t/**")
        self.assertEqual(rows[-1], "16\t  b.trim()")
        self.assertEqual(len(rows), 7)

    def test_un_type_s_arrete_a_la_declaration_suivante(self):
        self.assertEqual(self.decl("Gamma"), ["18\texport type Gamma = {", "19\t  g: number", "20\t}"])

    def test_une_expression_reguliere_sur_la_ligne_suivante(self):
        self.assertEqual(self.decl("TEST_RE"), ["21\tconst TEST_RE =", "22\t  /\\b(?:vitest)\\b/i"])

    def test_un_gabarit_dont_des_lignes_commencent_en_colonne_0_reste_entier(self):
        self.file.write_text("export const CONSIGNE = `# Titre\n\nexport const pas_une_declaration = 1\nfin`\n"
                             "const apres = 2\n", encoding="utf-8")
        self.assertEqual([row.split("\t")[0] for row in self.decl("CONSIGNE")], ["1", "2", "3", "4"])
        self.assertEqual(run("--decl", str(self.file), "pas_une_declaration").returncode, 1)

    def test_lu_par_le_masque_une_suite_en_etoile_est_du_code_et_un_bloc_de_commentaire_un_commentaire(self):
        self.file.write_text("export const total = base\n  * facteur;\n\nconst a = 1;\n/* bloc\nNote: texte\n*/\n"
                             "function g() {}\n", encoding="utf-8")
        self.assertEqual([row.split("\t")[0] for row in self.decl("total")], ["1", "2"])
        self.assertEqual([row.split("\t")[0] for row in self.decl("a")], ["4"])
        self.assertEqual([row.split("\t")[0] for row in self.decl("g")], ["5", "6", "7", "8"])

    def test_lu_par_lignes_un_gabarit_coupe_est_signale(self):
        jsx = self.file.with_suffix(".tsx")
        jsx.write_text("const Vue = () => <Text>l'agent</Text>\n"
                       "export const CONSIGNE = `# Titre\nexport const coupe = 1\nfin`\n", encoding="utf-8")
        out = run("--decl", str(jsx), "CONSIGNE")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.splitlines(), ["2\texport const CONSIGNE = `# Titre"])
        self.assertIn("peut-être coupée à la ligne 2", out.stderr)
        self.assertNotIn("ATTENTION", run("--decl", str(jsx), "Vue").stderr)

    def test_un_nom_absent_est_une_erreur_qui_le_dit(self):
        out = run("--decl", str(self.file), "alpah")
        self.assertEqual(out.returncode, 1)
        self.assertIn("aucune déclaration de premier niveau « alpah »", out.stderr)
        self.assertIn("alpha", out.stderr)
        self.assertEqual(out.stdout, "")

    def test_un_nom_declare_deux_fois_est_une_erreur_qui_donne_ses_lignes(self):
        out = run("--decl", str(self.file), "doublon")
        self.assertEqual(out.returncode, 1)
        self.assertIn("déclaré 2 fois au premier niveau, lignes 23, 25", out.stderr)

    def test_arguments_invalides(self):
        self.assertEqual(run("--decl", str(self.file)).returncode, 2)
        self.assertIn("--decl <fichier> <nom>", run("--decl", str(self.file)).stderr)
        self.assertEqual(run("--decl", str(Path(self.dir.name) / "absent.ts"), "alpha").returncode, 1)


PY_MODULE = '''"""Docstring du module."""

import os

# Le commentaire de tête de la sauvegarde,
# sur deux lignes.
def backup(path):
    """Copie le fichier.
"""
    # un commentaire en fin de corps
    return path


# Un commentaire détaché, séparé par une ligne vide.

@decorateur
@autre(
    1,
)
async def main_clone(a):
    texte = """
# pas un commentaire de tête
def pas_une_declaration():
"""
    return texte

class Sauvegarde:
    def methode(self):
        pass

LIMITE = 3

def doublon():
    pass

def doublon():
    pass
'''


class PyDeclTest(unittest.TestCase):
    """`show.py --decl <fichier>.py <nom>` : une fonction ou une classe de premier niveau, décorateurs et
    commentaire `#` collé au-dessus compris, jusqu'à sa dernière ligne."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / "module.py"
        self.file.write_text(PY_MODULE, encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def decl(self, name, path=None):
        out = run("--decl", str(path or self.file), name)
        self.assertEqual(out.returncode, 0, out.stderr)
        return out.stdout.splitlines()

    def test_une_fonction_avec_son_commentaire_de_tete_et_son_commentaire_de_fin_de_corps(self):
        self.assertEqual(self.decl("backup"), [
            "5\t# Le commentaire de tête de la sauvegarde,", "6\t# sur deux lignes.", "7\tdef backup(path):",
            '8\t    """Copie le fichier.', '9\t"""', "10\t    # un commentaire en fin de corps", "11\t    return path"])

    def test_une_fonction_decoree_et_asynchrone_garde_ses_decorateurs_et_sa_chaine_entiere(self):
        rows = self.decl("main_clone")
        self.assertEqual(rows[0], "16\t@decorateur")
        self.assertEqual(rows[4], "20\tasync def main_clone(a):")
        self.assertEqual(rows[-1], "25\t    return texte")
        self.assertEqual(len(rows), 10)

    def test_une_classe_jusqu_a_l_instruction_suivante(self):
        self.assertEqual(self.decl("Sauvegarde"), ["27\tclass Sauvegarde:", "28\t    def methode(self):",
                                                   "29\t        pass"])

    def test_une_declaration_imbriquee_ou_dans_une_chaine_n_est_pas_de_premier_niveau(self):
        for name in ("methode", "pas_une_declaration", "LIMITE"):
            with self.subTest(name=name):
                self.assertEqual(run("--decl", str(self.file), name).returncode, 1)

    def test_un_nom_absent_cite_les_def_et_class_proches(self):
        out = run("--decl", str(self.file), "bakup")
        self.assertEqual(out.returncode, 1)
        self.assertIn("aucune déclaration de premier niveau « bakup » ; noms proches : backup", out.stderr)
        self.assertEqual(out.stdout, "")

    def test_un_nom_declare_deux_fois_donne_ses_lignes(self):
        out = run("--decl", str(self.file), "doublon")
        self.assertEqual(out.returncode, 1)
        self.assertIn("déclaré 2 fois au premier niveau, lignes 33, 36", out.stderr)

    def test_un_fichier_qui_ne_se_lit_pas_en_python_se_lit_par_lignes_et_le_dit(self):
        broken = self.file.with_name("casse.py")
        broken.write_text("def debut(:\n    pass\n\ndef suite():\n    return 1\n", encoding="utf-8")
        out = run("--decl", str(broken), "suite")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.splitlines(), ["4\tdef suite():", "5\t    return 1"])
        self.assertIn("erreur de syntaxe ligne 1", out.stderr)

    def test_une_extension_ni_js_ts_ni_py_est_refusee_et_renvoie_a_la_plage(self):
        other = self.file.with_name("notes.md")
        other.write_text("def backup():\n    pass\n", encoding="utf-8")
        out = run("--decl", str(other), "backup")
        self.assertEqual(out.returncode, 2)
        self.assertIn(f'python3 scripts/show.py {other} "<motif>" +N', out.stderr)
        self.assertEqual(out.stdout, "")
        self.assertIn(".mts, .ts, .tsx, .py)", out.stderr)
        for suffix in (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"):
            with self.subTest(suffix=suffix):
                js = self.file.with_name("m" + suffix)
                js.write_text("export function f() {}\n", encoding="utf-8")
                self.assertEqual(self.decl("f", js), ["1\texport function f() {}"])

    def test_un_retour_chariot_seul_une_marque_d_ordre_ou_un_octet_nul_gardent_les_lignes_de_read(self):
        odd = self.file.with_name("bizarre.py")
        odd.write_text("X = 1" + chr(13) + "Y = 2\n# a" + chr(13) + "b\ndef f():\n    pass\ndef g():\n    return 2\n",
                       encoding="utf-8")
        # `read_lines` lit un `\r` seul comme une fin de ligne, comme `ast` : les numéros s'accordent.
        self.assertEqual(self.decl("g", odd), ["7\tdef g():", "8\t    return 2"])
        bom = self.file.with_name("bom.py")
        bom.write_text(chr(0xFEFF) + "# tête\ndef f():\n    s = '''\ndef pas_une():\n'''\n", encoding="utf-8")
        out = run("--decl", str(bom), "f")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(len(out.stdout.splitlines()), 5)
        self.assertNotIn("ATTENTION", out.stderr)
        nul = self.file.with_name("nul.py")
        nul.write_text("def f():\n    pass\n# " + chr(0) + "\ndef g():\n    return 1\n", encoding="utf-8")
        out = run("--decl", str(nul), "g")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.splitlines(), ["3\t# " + chr(0), "4\tdef g():", "5\t    return 1"])
        self.assertIn("lu par lignes", out.stderr)

    def test_une_ligne_en_diese_qui_ferme_la_chaine_d_avant_reste_a_la_declaration_d_avant(self):
        closing = self.file.with_name("chaine.py")
        closing.write_text('def f():\n    s = """\n#a"""\ndef g():\n    pass\n', encoding="utf-8")
        self.assertEqual(self.decl("g", closing), ["4\tdef g():", "5\t    pass"])
        self.assertEqual(self.decl("f", closing)[-1], '3\t#a"""')

    def test_l_extension_se_lit_sans_la_casse(self):
        upper = self.file.with_name("M.PY")
        upper.write_text("def f():\n    pass\n", encoding="utf-8")
        self.assertEqual(self.decl("f", upper), ["1\tdef f():", "2\t    pass"])
        ts = self.file.with_name("m.TS")
        ts.write_text("export function f() {}\n", encoding="utf-8")
        self.assertEqual(self.decl("f", ts), ["1\texport function f() {}"])

    def test_l_en_tete_cite_les_extensions_que_lit_le_script(self):
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            import show
        finally:
            sys.path.pop(0)
        doc = " ".join(show.__doc__.split())
        sentence = doc[doc.index("se reconnaissent à leur extension ("):].split(")", 1)[0]
        self.assertEqual(set(re.findall(r"`(\.\w+)`", sentence)), show.JS_SUFFIXES)
        self.assertIn("Sur un fichier `.py`", doc)
        self.assertEqual(show.PY_SUFFIXES, {".py"})


if __name__ == "__main__":
    unittest.main()
