"""Tests du hook pre-commit (scripts/check.py --staged) sur un commit qui ne touche que la règle d'un
plugin (`config/rules/<plugin>.md`) ou une liste d'admis (`scripts/renvois-admis.json`,
`scripts/interpolations-admises.json`) : il lance les contrôles statiques qui les lisent, sur la copie de
l'index, et refuse une liste d'admis qui augmente face à HEAD. python3 -m unittest discover -s scripts/tests."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

RULE = "config/rules/flow-board.md"
REFS = "scripts/renvois-admis.json"
INTERPOLATIONS = "scripts/interpolations-admises.json"
HOOK = "plugins/flow-board/hooks/model.ts"
# Un site brut admis (`${run.title}`) et un renvoi admis (« Q3 ») dans les hooks du plugin.
CODE = "// la règle (Q3)\nexport const titre = (run: any) => `Parcours ${run.title}`\n"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def admitted(counts):
    return json.dumps({"date": "2026-11-01", "files": counts}, indent=2) + "\n"


class StagedRulesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.write("plugins/flow-board/.claude-plugin/plugin.json", json.dumps({"name": "flow-board", "version": "0.1.0"}))
        self.write("plugins/flow-board/termes-retires.txt", "# termes retirés\n0.1.0\tvague suivante\n")
        self.write(HOOK, CODE)
        self.write(RULE, "# Règle\n\n- en mode auto, le mod lance lui-même les groupes suivants.\n")
        self.write(REFS, admitted({"flow-board/hooks/model.ts": 1}))
        self.write(INTERPOLATIONS, admitted({"flow-board/hooks/model.ts": 1}))
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.saved = (check.REPO, check.run.__defaults__, check.validate, check.tool, check.export_index)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)
        # `claude plugin validate` n'a rien à relire dans ce dépôt d'essai : le hook le lance comme avant.
        check.validate = lambda *args, **kwargs: None
        check.tool = lambda name: name
        self.exported = 0
        original = self.saved[4]

        def counted():
            self.exported += 1
            return original()
        check.export_index = counted

    def tearDown(self):
        check.REPO, check.run.__defaults__, check.validate, check.tool, check.export_index = self.saved
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def stage(self, rel, text):
        self.write(rel, text)
        git(self.repo, "add", rel)

    def refused(self):
        with self.assertRaises(check.Failed) as caught:
            check.staged()
        return str(caught.exception)

    def test_un_terme_retire_ajoute_a_la_regle_seule_est_refuse(self):
        self.stage(RULE, "# Règle\n\n- en mode auto, le mod lance la vague suivante.\n")
        self.assertIn("flow-board", self.refused())

    def test_une_regle_sans_terme_retire_passe(self):
        self.stage(RULE, "# Règle\n\n- en mode auto, le mod lance lui-même les groupes suivants, vague close.\n")
        check.staged()
        self.assertEqual(self.exported, 1)

    def test_une_liste_d_admis_qui_augmente_est_refusee(self):
        for path in (REFS, INTERPOLATIONS):
            with self.subTest(path=path):
                self.stage(path, admitted({"flow-board/hooks/model.ts": 2}))
                self.assertIn(path, self.refused())
                git(self.repo, "checkout", "HEAD", "--", path)

    def test_une_cle_nouvelle_dans_une_liste_d_admis_est_une_augmentation(self):
        self.stage(REFS, admitted({"flow-board/hooks/model.ts": 1, "flow-board/hooks/view.tsx": 1}))
        self.assertIn("view.tsx", self.refused())

    def test_une_liste_d_admis_qui_baisse_passe_si_le_code_suit(self):
        self.stage(HOOK, "export const titre = (run: any) => `Parcours ${shown(run.title)}`\n")
        self.stage(INTERPOLATIONS, admitted({}))
        check.staged()

    def test_une_liste_baissee_sous_le_compte_du_code_indexe_est_refusee(self):
        self.stage(REFS, admitted({}))
        self.assertIn("renvoi", self.refused())
        git(self.repo, "checkout", "HEAD", "--", REFS)
        self.stage(INTERPOLATIONS, admitted({}))
        self.assertIn("brute", self.refused())

    def test_une_regle_qui_n_est_pas_celle_d_un_plugin_ne_copie_pas_l_index(self):
        self.stage("config/rules/general.md", "# Règles générales\n\nla vague suivante\n")
        check.staged()
        self.assertEqual(self.exported, 0)

    def test_une_cle_d_admis_hors_des_plugins_ne_designe_aucun_plugin(self):
        # Une clé baissée qui ne nomme pas un plugin (« .. », un nom inconnu) : rien à contrôler hors de plugins/.
        self.stage(REFS, admitted({"flow-board/hooks/model.ts": 1, "../x.ts": 0}))
        check.staged()
        self.write(REFS, admitted({"flow-board/hooks/model.ts": 1, "../x.ts": 2}))
        git(self.repo, "add", REFS)
        git(self.repo, "commit", "-q", "--no-verify", "-m", "liste avec une clé hors des plugins")
        self.stage(REFS, admitted({"flow-board/hooks/model.ts": 1, "../x.ts": 1}))
        self.assertEqual(check.admitted_changes(REFS)[1], set())

    def test_un_commit_de_documentation_sans_ces_fichiers_reste_sans_controle(self):
        self.stage("README.md", "# Dépôt\n\nla vague suivante, Q4, Q5\n")
        self.stage("travail/essai/notes.md", "notes\n")
        check.staged()
        self.assertEqual(self.exported, 0)


if __name__ == "__main__":
    unittest.main()
