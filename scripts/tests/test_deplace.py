"""Tests de scripts/deplace.py, qui déplace des déclarations d'un module de `hooks/` à un autre :
python3 -m unittest discover -s scripts/tests.

Un plugin d'essai dans un dossier temporaire : `model.ts` (la source), `link.ts` (une cible), `basics.ts`,
une vue `.tsx` et un test qui importent de la source."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "deplace.py"

MODEL = """import type { Run } from '../types'
import { isTime } from './basics.ts'

const LIMIT = 3

// Le titre d'un parcours : sa date, puis son nom ('#1' entre guillemets, accolade « { » comprise).
// Deuxième ligne du commentaire.
export const title = (run: Run): string => {
  const at = isTime(run.at) ? run.at : '—'
  return `${at} · ${run.name} {`
}

/** Le nombre de groupes, borné. */
export function count(run: Run) {
  return Math.min(run.groups.length, LIMIT)
}

export const summary = (run: Run) => `${title(run)} (${count(run)})`
"""

LINK = """import { isTime } from './basics.ts'

export const linked = (v: unknown) => isTime(v)
"""

BASICS = """export const isTime = (v: unknown): v is string => typeof v === 'string'
"""

VIEW = """import { summary, title } from './model.ts'

// title vient de model.ts
export const View = (run: any) => <Text>{summary(run)} {title(run)}</Text>
"""

TEST = """import { count, title } from '../hooks/model.ts'

test('titre', () => title({} as any))
test('compte', () => count({} as any))
"""

TITLE = """// Le titre d'un parcours : sa date, puis son nom ('#1' entre guillemets, accolade « { » comprise).
// Deuxième ligne du commentaire.
export const title = (run: Run): string => {
  const at = isTime(run.at) ? run.at : '—'
  return `${at} · ${run.name} {`
}
"""


def run(*args, cwd=None):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8", cwd=cwd)


class DeplaceTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.plugin = Path(self.dir.name) / "essai-board"
        for rel, text in (("hooks/model.ts", MODEL), ("hooks/link.ts", LINK), ("hooks/basics.ts", BASICS),
                          ("hooks/view.tsx", VIEW), ("tests/model.test.ts", TEST)):
            self.write(rel, text)

    def tearDown(self):
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.plugin / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))

    def read(self, rel):
        return (self.plugin / rel).read_bytes().decode("utf-8")

    def snapshot(self):
        return {p.relative_to(self.plugin).as_posix(): p.read_bytes() for p in sorted(self.plugin.rglob("*")) if p.is_file()}

    def move(self, *args):
        return run(*args, cwd=self.plugin)

    def test_deplace_une_declaration_avec_son_commentaire_et_reecrit_les_imports(self):
        out = self.move("hooks/model.ts", "hooks/link.ts", "title")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.read("hooks/link.ts"), "import { isTime } from './basics.ts'\nimport type { Run } from '../types'\n\n"
                         "export const linked = (v: unknown) => isTime(v)\n\n" + TITLE)
        self.assertEqual(self.read("hooks/model.ts"), """import type { Run } from '../types'
import { title } from './link.ts'

const LIMIT = 3

/** Le nombre de groupes, borné. */
export function count(run: Run) {
  return Math.min(run.groups.length, LIMIT)
}

export const summary = (run: Run) => `${title(run)} (${count(run)})`
""")
        self.assertTrue(self.read("hooks/view.tsx").startswith("import { summary } from './model.ts'\nimport { title } from './link.ts'\n"))
        self.assertTrue(self.read("tests/model.test.ts").startswith("import { count } from '../hooks/model.ts'\nimport { title } from '../hooks/link.ts'\n"))
        self.assertIn("identiques", out.stdout)
        self.assertIn("title", out.stdout)

    def test_l_essai_liste_dependances_importeurs_et_renvois_sans_rien_ecrire(self):
        before = self.snapshot()
        out = self.move("--essai", "hooks/model.ts", "hooks/link.ts", "title")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.snapshot(), before)
        for expected in ("isTime (import de './basics.ts'", "Run (import de '../types'", "la source utilise encore title",
                         "hooks/view.tsx, tests/model.test.ts", "hooks/view.tsx:3 « // title vient de model.ts »",
                         "rien n'est écrit", "identiques"):
            self.assertIn(expected, out.stdout)

    def test_deplace_plusieurs_noms_vers_un_module_neuf(self):
        out = self.move("hooks/model.ts", "hooks/titre.ts", "summary", "title")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.read("hooks/titre.ts"), "import type { Run } from '../types'\nimport { isTime } from './basics.ts'\n"
                         "import { count } from './model.ts'\n\n" + TITLE + "\nexport const summary = (run: Run) => `${title(run)} (${count(run)})`\n")
        self.assertEqual(self.read("hooks/model.ts"), """import type { Run } from '../types'

const LIMIT = 3

/** Le nombre de groupes, borné. */
export function count(run: Run) {
  return Math.min(run.groups.length, LIMIT)
}
""")
        self.assertTrue(self.read("hooks/view.tsx").startswith("import { summary, title } from './titre.ts'\n"))
        self.assertEqual(out.stdout.count("identiques"), 2)

    def test_un_import_sur_plusieurs_lignes_garde_sa_forme(self):
        self.write("tests/model.test.ts", "import {\n  count,\n  type Run as R,\n  title,\n} from '../hooks/model'\n\ntest('t', () => title(count))\n")
        out = self.move("hooks/model.ts", "hooks/link.ts", "title")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue(self.read("tests/model.test.ts").startswith(
            "import {\n  count,\n  type Run as R,\n} from '../hooks/model'\nimport { title } from '../hooks/link'\n\n"), self.read("tests/model.test.ts"))

    def assertRefused(self, args, reason):
        before = self.snapshot()
        out = self.move(*args)
        self.assertEqual(out.returncode, 1, out.stdout)
        self.assertIn(reason, out.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_un_nom_introuvable_est_refuse(self):
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "absent"], "introuvable : absent")

    def test_une_declaration_deja_dans_la_cible_est_refusee(self):
        self.write("hooks/link.ts", LINK + "\nexport const title = 1\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "title : déjà déclaré dans hooks/link.ts")

    def test_un_cycle_d_imports_cree_est_refuse(self):
        self.write("hooks/link.ts", "import { count } from './model.ts'\n\nexport const linked = count\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "cycle d'imports créé : link.ts ↔ model.ts")

    def test_une_dependance_non_exportee_ou_une_declaration_non_exportee_encore_utilisee_est_refusee(self):
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "count"], "LIMIT : déclaration de la source que le code déplacé utilise, non exportée")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "LIMIT"], "LIMIT : non exporté, mais la source l'utilise encore")

    def test_une_lecture_qui_deraille_est_refusee(self):
        self.write("hooks/model.ts", MODEL + "const ouverte = 'pas fermée\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "la lecture a déraillé")

    def test_un_gabarit_ferme_en_colonne_0_part_en_entier(self):
        self.write("hooks/model.ts", "export const PROMPT = `\nligne un\n`\n\nexport const other = 1\n")
        out = self.move("hooks/model.ts", "hooks/link.ts", "PROMPT")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue(self.read("hooks/link.ts").endswith("\nexport const PROMPT = `\nligne un\n`\n"))
        self.assertEqual(self.read("hooks/model.ts"), "export const other = 1\n")

    def test_les_membres_d_un_type_ne_sont_pas_des_usages(self):
        self.write("hooks/model.ts", "export const status = 1\n\nexport type Run = {\n  name: string\n  status?: string\n  at: number;\n}\n")
        out = self.move("hooks/model.ts", "hooks/link.ts", "Run")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertNotIn("status }", self.read("hooks/link.ts"))

    def test_un_import_renomme_du_nom_deplace_dans_la_cible_est_refuse(self):
        self.write("hooks/link.ts", "import { title as t } from './model.ts'\n\nexport const linked = t\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "title : importé sous un autre nom dans hooks/link.ts")

    def test_un_nom_deja_importe_d_un_autre_module_dans_la_cible_est_refuse(self):
        self.write("hooks/link.ts", "import { title } from './basics.ts'\n\nexport const linked = title\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "title : déjà importé dans hooks/link.ts d'un autre module")

    def test_une_dependance_que_la_cible_a_deja_sous_un_autre_sens_est_refusee(self):
        self.write("hooks/link.ts", "export const isTime = 2\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "isTime : la cible a déjà un autre isTime")

    def test_un_export_par_defaut_est_refuse(self):
        self.write("hooks/model.ts", "export default function title() {}\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "title : export par défaut")

    def test_un_import_etoile_ou_un_export_from_qui_vise_un_nom_deplace_est_refuse(self):
        self.write("hooks/view.tsx", "import * as m from './model.ts'\n\nexport const v = m.title\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "`* as` ou `export *` de la source")
        self.write("hooks/view.tsx", "export { title } from './model.ts'\n")
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "vise un nom déplacé : le réécrire à la main")

    def test_un_export_de_la_source_n_est_ni_une_dependance_ni_retire(self):
        # Un `export { } from` ne lie aucun nom : le paramètre homonyme du code déplacé n'en dépend pas.
        self.write("hooks/model.ts", "export { isTime } from './basics.ts'\n\nexport const check = (isTime: unknown) => isTime\n")
        self.write("hooks/view.tsx", "import { isTime, check } from './model.ts'\n\nexport const v = [isTime, check]\n")
        out = self.move("hooks/model.ts", "hooks/link.ts", "check")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.read("hooks/model.ts"), "export { isTime } from './basics.ts'\n")
        self.assertTrue(self.read("hooks/view.tsx").startswith("import { isTime } from './model.ts'\nimport { check } from './link.ts'\n"))

    def test_un_nom_exporte_qu_aucun_autre_fichier_ne_nomme_plus_est_signale(self):
        self.write("hooks/view.tsx", "export const View = () => null\n")
        out = self.move("--essai", "hooks/model.ts", "hooks/link.ts", "summary")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("exporté sans autre lecteur après le déplacement (refusé par le contrôle des exports morts de check.sh) : summary", out.stdout)
        out = self.move("--essai", "hooks/model.ts", "hooks/link.ts", "title")
        self.assertNotIn("exporté sans autre lecteur", out.stdout)
        # Un type n'est pas une valeur : le contrôle des exports morts ne le compte pas.
        self.write("hooks/model.ts", MODEL + "\nexport type Seul = number\n")
        out = self.move("--essai", "hooks/model.ts", "hooks/link.ts", "Seul")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertNotIn("exporté sans autre lecteur", out.stdout)

    def test_une_ecriture_refusee_remet_les_fichiers_deja_ecrits(self):
        # La source s'écrit en dernier : la cible et les importeurs, déjà écrits, sont remis.
        source = self.plugin / "hooks" / "model.ts"
        source.chmod(0o444)
        self.assertRefused(["hooks/model.ts", "hooks/link.ts", "title"], "les fichiers déjà écrits sont remis")
        source.chmod(0o644)

    def test_une_source_et_une_cible_hors_d_un_meme_dossier_hooks_sont_refusees(self):
        self.assertRefused(["hooks/model.ts", "tests/autre.ts", "title"], "même dossier hooks/")


if __name__ == "__main__":
    unittest.main()
