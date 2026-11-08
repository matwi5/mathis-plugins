"""Tests de scripts/show.py : python3 -m unittest discover -s scripts/tests."""

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


if __name__ == "__main__":
    unittest.main()
