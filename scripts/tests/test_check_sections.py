"""Tests des renvois de section (scripts/check.py) : un renvoi « section « X » de `<fichier>.md` » vers une
règle commune (`config/rules/`) ou un fichier de référence (`config/reference/`) vise un titre qui existe.
python3 -m unittest discover -s scripts/tests."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

AGENTS = "# Spécialistes\n\n## Revues dans un spécialiste Opus, effort selon l'enjeu\n\nTexte.\n"
REVUES = "# Revues\n\n### Tableau des efforts\n"


class SectionRefsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.plugin = self.root / "plugins" / "essai"
        (self.plugin / "reference").mkdir(parents=True)
        (self.root / "config" / "rules").mkdir(parents=True)
        (self.root / "config" / "reference").mkdir(parents=True)
        (self.root / "config" / "rules" / "agents.md").write_text(AGENTS, encoding="utf-8")
        (self.root / "config" / "reference" / "revues.md").write_text(REVUES, encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def test_un_renvoi_juste_passe(self):
        self.write("plugins/essai/reference/a.md",
                   "Voir la section « Revues dans un spécialiste Opus, effort selon l'enjeu » de `config/rules/agents.md`.\n"
                   "Et la section « Tableau des efforts » de `config/reference/revues.md`.\n")
        self.assertEqual(check.section_refs(self.plugin), [])

    def test_un_titre_a_guillemets_imbriques_se_lit_en_entier(self):
        self.write("config/rules/agents.md", AGENTS + "\n## Le mode « auto »\n")
        self.write("plugins/essai/reference/a.md", "Voir la section « Le mode « auto » » de `config/rules/agents.md`.\n")
        self.assertEqual(check.section_refs(self.plugin), [])
        self.write("config/rules/agents.md", AGENTS + "\n## Le mode auto\n")
        problems = check.section_refs(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("« Le mode « auto » »", problems[0])

    def test_un_renvoi_vers_un_titre_absent_est_refuse(self):
        self.write("plugins/essai/reference/a.md", "Ligne\nVoir la section « Revues par Opus » de `config/rules/agents.md`.\n")
        problems = check.section_refs(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("essai/reference/a.md:2", problems[0])
        self.assertIn("« Revues par Opus »", problems[0])
        self.assertIn("config/rules/agents.md", problems[0])

    def test_dans_la_regle_du_plugin_un_nom_nu_se_lit_a_cote_d_elle(self):
        self.write("config/rules/essai.md", "- règle (section « Revues sans effort » de `agents.md`).\n")
        problems = check.section_refs(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("config/rules/essai.md:1", problems[0])
        self.write("config/rules/essai.md", "- règle (section « Revues dans un spécialiste Opus, effort selon l'enjeu » de `agents.md`).\n")
        self.assertEqual(check.section_refs(self.plugin), [])

    def test_un_lien_markdown_vers_la_regle_est_lu(self):
        self.write("plugins/essai/README.md", "La section « Absente » de [`config/rules/agents.md`](../../config/rules/agents.md).\n")
        self.assertEqual(len(check.section_refs(self.plugin)), 1)

    def test_le_chemin_installe_d_une_regle_est_lu_comme_celui_du_depot(self):
        self.write("plugins/essai/reference/a.md",
                   "La section « Absente » de `~/.claude/plugins/marketplaces/mathis-plugins/config/rules/agents.md`.\n")
        problems = check.section_refs(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("config/rules/agents.md", problems[0])

    def test_un_fichier_vise_introuvable_est_refuse(self):
        self.write("plugins/essai/reference/a.md", "La section « Titre » de `config/rules/disparu.md`.\n")
        problems = check.section_refs(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("introuvable", problems[0])

    def test_un_nom_nu_disparu_depuis_la_regle_est_introuvable(self):
        self.write("config/rules/essai.md", "- règle (section « Titre » de `disparu.md`).\n")
        problems = check.section_refs(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("config/rules/disparu.md, fichier introuvable", problems[0])

    def test_hors_des_regles_communes_et_des_references_rien_n_est_controle(self):
        self.write("plugins/essai/reference/a.md",
                   "La section « Worker autonome » de cette procédure, la section « État » de `ETAT_DU_PROJET.md`.\n")
        self.assertEqual(check.section_refs(self.plugin), [])

    def test_les_tests_et_le_changelog_ne_sont_pas_lus(self):
        self.write("plugins/essai/tests/a.test.ts", "// la section « Absente » de `config/rules/agents.md`\n")
        self.write("plugins/essai/CHANGELOG.md", "## 0.1.0\n\n- la section « Ancienne » de `config/rules/agents.md`\n")
        self.assertEqual(check.section_refs(self.plugin), [])


if __name__ == "__main__":
    unittest.main()
