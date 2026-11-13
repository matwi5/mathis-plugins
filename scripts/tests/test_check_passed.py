"""Tests de l'empreinte du dernier `check.sh` vert (scripts/check.py, passed_already, remember_passed) :
le pre-commit saute les tests d'un plugin dont l'index porte exactement un arbre déjà testé vert, dans ce
worktree, ou dans un autre worktree du dépôt (lue sans jamais l'écrire, contexte compris : ce que les
contrôles lisent hors du plugin). python3 -m unittest discover -s scripts/tests."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

PLUGIN = "essai"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class PassedElsewhereTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name).resolve()
        self.main = base / "clone"
        self.main.mkdir()
        git(self.main, "init", "-q", "-b", "main")
        git(self.main, "config", "user.name", "essai")
        git(self.main, "config", "user.email", "essai@localhost")
        git(self.main, "config", "commit.gpgsign", "false")
        self.write(self.main, "hooks/register.tsx", "export const a = 1\n")
        self.write(self.main, "README.md", "# essai\n")
        self.write_repo(self.main, "config/rules/essai.md", "règle 1\n")
        self.write_repo(self.main, "travail/sujet/issues/01-a.md", "**Status:** à faire\n")
        # Comme le dépôt : les worktrees (sous .claude/) et les types du moteur ne sont pas suivis.
        self.write_repo(self.main, ".gitignore", ".claude/\nplugins/*/.claude-plugin/types/\n")
        git(self.main, "add", ".")
        git(self.main, "commit", "-q", "-m", "base")
        self.wt = self.main / ".claude" / "worktrees" / "groupe-x"
        git(self.main, "worktree", "add", "-q", "-b", "worktree-groupe-x", str(self.wt))
        self.saved = (check.REPO, check.run.__defaults__)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def at(self, repo):
        """Les commandes git de check.py tournent dans REPO, valeur par défaut de `run`."""
        check.REPO = repo
        check.run.__defaults__ = (repo, None)

    def write(self, repo, rel, text):
        self.write_repo(repo, f"plugins/{PLUGIN}/{rel}", text)

    def write_repo(self, repo, rel, text):
        target = repo / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def plugin(self, repo):
        return repo / "plugins" / PLUGIN

    def passed_in_worktree(self):
        """Un ticket commité dans le worktree, puis son `check.sh` vert (l'empreinte du worktree)."""
        self.write(self.wt, "hooks/register.tsx", "export const a = 2\n")
        git(self.wt, "commit", "-q", "-am", "ticket")
        self.at(self.wt)
        check.remember_passed(self.plugin(self.wt), check.tree_marks(self.plugin(self.wt)))
        return Path(git(self.wt, "rev-parse", "--path-format=absolute", "--git-path", f"check-ok/{PLUGIN}"))

    def merge_in_main(self):
        self.at(self.main)
        git(self.main, "merge", "-q", "--no-ff", "--no-commit", "worktree-groupe-x")

    def test_l_arbre_teste_vert_dans_un_worktree_et_fusionne_saute_les_tests(self):
        mark = self.passed_in_worktree()
        before = mark.read_text(encoding="utf-8")
        self.merge_in_main()
        self.assertTrue(check.passed_already(self.plugin(self.main)))
        # Lue seulement : l'empreinte du worktree n'a pas bougé, le clone principal n'en a pas écrit.
        self.assertEqual(mark.read_text(encoding="utf-8"), before)
        self.assertFalse((self.main / ".git" / "check-ok" / PLUGIN).exists())

    def test_un_chantier_ou_le_journal_change_dans_la_branche_principale_ne_compte_pas(self):
        self.passed_in_worktree()
        self.write_repo(self.main, "travail/sujet/issues/01-a.md", "**Status:** fait\n")
        self.write_repo(self.main, "ETAT_DU_PROJET.md", "journal\n")
        git(self.main, "add", ".")
        git(self.main, "commit", "-q", "-m", "journal")
        self.merge_in_main()
        self.assertTrue(check.passed_already(self.plugin(self.main)))

    def test_un_arbre_different_d_un_fichier_hors_documentation_ne_saute_pas(self):
        self.passed_in_worktree()
        self.merge_in_main()
        self.write(self.main, "hooks/register.tsx", "export const a = 3\n")
        git(self.main, "add", ".")
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_une_regle_changee_dans_la_branche_principale_relance_les_tests(self):
        # La branche principale a reçu, après le check.sh vert du worktree, une règle que lisent les tests
        # du plugin : l'arbre fusionné n'a jamais été testé, l'empreinte du worktree ne compte pas.
        self.passed_in_worktree()
        self.write_repo(self.main, "config/rules/essai.md", "règle 2\n")
        git(self.main, "commit", "-q", "-am", "règle")
        self.merge_in_main()
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_la_documentation_du_plugin_changee_dans_la_fusion_relance_les_tests(self):
        self.passed_in_worktree()
        self.merge_in_main()
        self.write(self.main, "README.md", "# essai changé\n")
        git(self.main, "add", ".")
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_dans_le_worktree_la_documentation_ne_compte_toujours_pas(self):
        self.passed_in_worktree()
        self.write(self.wt, "README.md", "# essai changé\n")
        self.write_repo(self.wt, "config/rules/essai.md", "règle 3\n")
        git(self.wt, "add", ".")
        self.assertTrue(check.passed_already(self.plugin(self.wt)))
        self.write(self.wt, "hooks/register.tsx", "export const a = 4\n")
        git(self.wt, "add", ".")
        self.assertFalse(check.passed_already(self.plugin(self.wt)))

    def test_un_arbre_change_pendant_les_controles_n_est_pas_retenu(self):
        self.write(self.wt, "hooks/register.tsx", "export const a = 2\n")
        git(self.wt, "commit", "-q", "-am", "ticket")
        self.at(self.wt)
        before = check.tree_marks(self.plugin(self.wt))
        # Une autre discussion change le plugin pendant que les tests tournent.
        self.write(self.wt, "hooks/register.tsx", "export const a = 5\n")
        check.remember_passed(self.plugin(self.wt), before)
        self.assertFalse(Path(git(self.wt, "rev-parse", "--path-format=absolute", "--git-path", f"check-ok/{PLUGIN}")).exists())
        # Sans changement, elle est retenue.
        check.remember_passed(self.plugin(self.wt), check.tree_marks(self.plugin(self.wt)))
        git(self.wt, "add", ".")
        self.assertTrue(check.passed_already(self.plugin(self.wt)))

    def test_un_changement_hors_du_plugin_pendant_les_controles_garde_l_empreinte_propre(self):
        # Pendant les contrôles, la session change un document hors du plugin : l'empreinte du plugin reste
        # retenue pour ce worktree, mais sans contexte, elle ne compte pas pour un autre.
        self.write(self.wt, "hooks/register.tsx", "export const a = 2\n")
        git(self.wt, "commit", "-q", "-am", "ticket")
        self.at(self.wt)
        before = check.tree_marks(self.plugin(self.wt))
        self.write_repo(self.wt, "config/rules/essai.md", "règle pendant les contrôles\n")
        check.remember_passed(self.plugin(self.wt), before)
        git(self.wt, "checkout", "--", "config/rules/essai.md")
        self.assertTrue(check.passed_already(self.plugin(self.wt)))
        self.merge_in_main()
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_un_worktree_lit_l_empreinte_du_clone_principal(self):
        self.at(self.main)
        check.remember_passed(self.plugin(self.main), check.tree_marks(self.plugin(self.main)))
        self.assertTrue((self.main / ".git" / "check-ok" / PLUGIN).is_file())
        self.at(self.wt)
        self.assertTrue(check.passed_already(self.plugin(self.wt)))

    def test_des_types_du_moteur_d_une_autre_version_relancent_les_tests(self):
        # Les types du moteur (ignorés par git) écrits par un autre Claude Code dans le clone principal
        # que dans le worktree testé : tsc n'y lirait pas les mêmes, l'empreinte du worktree ne compte pas.
        for repo, version in ((self.wt, "2.1.300"), (self.main, "2.1.300")):
            self.write(repo, ".claude-plugin/types/claude-code/index.d.ts", f"// Written by Claude Code {version}.\n")
        self.passed_in_worktree()
        self.merge_in_main()
        self.assertTrue(check.passed_already(self.plugin(self.main)))
        self.write(self.main, ".claude-plugin/types/claude-code/index.d.ts", "// Written by Claude Code 2.1.400.\n")
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_une_empreinte_d_avant_le_contexte_ne_compte_que_dans_son_worktree(self):
        # Une empreinte d'une seule ligne (écrite avant l'empreinte du contexte) : son worktree la lit
        # encore, un autre non.
        mark = self.passed_in_worktree()
        mark.write_text(mark.read_text(encoding="utf-8").split("\n")[0] + "\n", encoding="utf-8")
        self.assertTrue(check.passed_already(self.plugin(self.wt)))
        self.merge_in_main()
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_un_worktree_supprime_ne_casse_rien_et_son_empreinte_ne_compte_plus(self):
        mark = self.passed_in_worktree()
        self.merge_in_main()
        # Dossier du worktree effacé sans `git worktree remove` : listé « prunable », son dossier git
        # (et son empreinte) encore là ; elle ne compte plus.
        shutil.rmtree(self.wt)
        self.assertTrue(mark.is_file())
        self.assertFalse(check.passed_already(self.plugin(self.main)))
        # Puis retiré pour de bon : rien ne casse.
        git(self.main, "worktree", "prune")
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_une_empreinte_illisible_ou_trop_longue_est_ignoree(self):
        mark = self.passed_in_worktree()
        good = mark.read_text(encoding="utf-8")
        self.merge_in_main()
        self.assertTrue(check.passed_already(self.plugin(self.main)))
        # Les bonnes empreintes suivies d'octets de trop : au-delà de MARK_MAX_BYTES, rien n'est lu.
        mark.write_text(good + "x" * check.MARK_MAX_BYTES, encoding="utf-8")
        self.assertFalse(check.passed_already(self.plugin(self.main)))
        mark.write_bytes(b"\xff\xfe\x00")
        self.assertFalse(check.passed_already(self.plugin(self.main)))
        mark.unlink()
        mark.mkdir()
        self.assertFalse(check.passed_already(self.plugin(self.main)))

    def test_un_lien_gitdir_hors_du_depot_ou_mal_forme_est_ignore(self):
        # Un autre worktree dont le fichier `.git` renvoie hors du dossier git commun, ou porte une seconde
        # ligne : ignoré ; les worktrees valides restent trouvés.
        self.passed_in_worktree()
        other = self.main / ".claude" / "worktrees" / "groupe-y"
        git(self.main, "worktree", "add", "-q", "-b", "worktree-groupe-y", str(other))
        outside = Path(self.dir.name).resolve() / "ailleurs"
        (outside / "check-ok").mkdir(parents=True)
        common = self.main / ".git"
        self.at(self.main)
        found = check.worktree_passed_paths(self.plugin(self.main))
        self.assertIn(common / "check-ok" / PLUGIN, found)
        self.assertIn(common / "worktrees" / "groupe-x" / "check-ok" / PLUGIN, found)
        self.assertIn(common / "worktrees" / "groupe-y" / "check-ok" / PLUGIN, found)
        for bad in (f"gitdir: {outside}\n", f"gitdir: {common}/worktrees/groupe-y\n{outside}\n",
                    f"gitdir: {common}/worktrees/../../../ailleurs\n"):
            (other / ".git").write_text(bad, encoding="utf-8")
            found = check.worktree_passed_paths(self.plugin(self.main))
            self.assertNotIn(outside / "check-ok" / PLUGIN, found)
            self.assertNotIn(common / "worktrees" / "groupe-y" / "check-ok" / PLUGIN, found)
            self.assertIn(common / "worktrees" / "groupe-x" / "check-ok" / PLUGIN, found)


if __name__ == "__main__":
    unittest.main()
