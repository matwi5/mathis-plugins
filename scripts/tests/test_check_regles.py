"""Tests des contrôles des règles du dépôt (scripts/check.py) : le prénom dans une règle ou une référence
commune exportée, l'en-tête `paths:` d'une règle de projet (`.claude/rules/*.md`) et les exceptions de
`.gitignore` qui gardent `.claude/settings.json` et `.claude/rules/`. Lancés par check.sh (`--quick`
compris) et par le hook pre-commit, même en documentation seule. python3 -m unittest discover -s scripts/tests."""

import io
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

RULE = "config/rules/essai.md"
REFERENCE = "config/reference/essai.md"
PROJECT_RULE = ".claude/rules/essai.md"
GITIGNORE = ".gitignore"
KEPT = "/.claude/*\n!/.claude/settings.json\n!/.claude/rules/\n"
PATHS = '---\npaths:\n  - "plugins/*/hooks/**"\n---\n\n# Essai\n'
NAME_MESSAGE = "prénom dans une règle commune exportée : écrire « l'utilisateur »"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class RulesRepo(unittest.TestCase):
    """Un dépôt d'essai qui passe les trois contrôles, et le hook pointé dessus ; sans test à lui."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.write(GITIGNORE, KEPT)
        self.write(RULE, "# Règle\n\nVoir `~/.claude/plugins/marketplaces/mathis-plugins/config/rules/essai.md`.\n")
        self.write(PROJECT_RULE, PATHS)
        git(self.repo, "add", "-f", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.saved = (check.REPO, check.run.__defaults__, check.validate, check.tool)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)
        # Un `.gitignore` indexé n'est pas de la documentation : `claude plugin validate` n'a rien à
        # relire dans ce dépôt d'essai.
        check.validate = lambda *args, **kwargs: None
        check.tool = lambda name: name

    def tearDown(self):
        check.REPO, check.run.__defaults__, check.validate, check.tool = self.saved
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def stage(self, rel, text):
        self.write(rel, text)
        git(self.repo, "add", "-f", rel)

    def staged_failure(self):
        """Le message d'échec du hook pre-commit, None s'il passe."""
        with redirect_stdout(io.StringIO()):
            try:
                check.staged()
            except check.Failed as err:
                return str(err)
        return None


class FirstNameTest(RulesRepo):
    def test_le_prenom_seul_dans_une_regle_indexee_est_refuse_avec_fichier_ligne_et_message(self):
        self.stage(RULE, "# Règle\n\nDemander à Mathis avant de pousser.\n")
        failure = self.staged_failure()
        self.assertIsNotNone(failure)
        self.assertIn(f"{RULE}:3", failure)
        self.assertIn(NAME_MESSAGE, failure)

    def test_le_prenom_dans_une_reference_commune_est_refuse(self):
        self.stage(REFERENCE, "# Référence\n\nmathis valide.\n")
        failure = self.staged_failure()
        self.assertIsNotNone(failure)
        self.assertIn(f"{REFERENCE}:3", failure)

    def test_le_nom_du_depot_passe(self):
        self.stage(RULE, "# Règle\n\nLe dépôt `~/mathis-plugins` et `mathis-plugins/plugins`.\n")
        self.assertIsNone(self.staged_failure())

    def test_le_prenom_hors_des_regles_communes_passe(self):
        self.stage("config/CLAUDE.personal.md", "# Personnel\n\nMathis maintient ce dépôt.\n")
        self.assertIsNone(self.staged_failure())


class ProjectRuleTest(RulesRepo):
    def test_une_regle_de_projet_sans_paths_est_refusee(self):
        self.stage(PROJECT_RULE, "# Essai\n\nSans en-tête.\n")
        failure = self.staged_failure()
        self.assertIsNotNone(failure)
        self.assertIn(PROJECT_RULE, failure)
        self.assertIn("paths:", failure)

    def test_une_regle_de_projet_a_liste_vide_est_refusee(self):
        self.stage(PROJECT_RULE, "---\npaths: []\n---\n\n# Essai\n")
        self.assertIsNotNone(self.staged_failure())
        self.stage(PROJECT_RULE, "---\npaths:\n---\n\n# Essai\n")
        self.assertIsNotNone(self.staged_failure())

    def test_une_regle_de_projet_a_paths_en_ligne_passe(self):
        self.stage(PROJECT_RULE, '---\npaths: ["plugins/*/tests/**"]\n---\n\n# Essai\n')
        self.assertIsNone(self.staged_failure())

    def test_paths_suivi_d_un_seul_commentaire_est_refuse(self):
        self.stage(PROJECT_RULE, "---\npaths: # à remplir\n---\n\n# Essai\n")
        self.assertIsNotNone(self.staged_failure())

    def test_un_en_tete_apres_un_bom_ou_avec_des_espaces_passe(self):
        self.stage(PROJECT_RULE, "﻿---  \npaths:\n  - \"plugins/*/hooks/**\"  # les hooks\n--- \n\n# Essai\n")
        self.assertIsNone(self.staged_failure())

    def test_paths_hors_de_l_en_tete_ne_compte_pas(self):
        self.stage(PROJECT_RULE, '# Essai\n\npaths:\n  - "plugins/*/hooks/**"\n')
        self.assertIsNotNone(self.staged_failure())


class GitignoreTest(RulesRepo):
    def test_un_gitignore_sans_l_exception_des_regles_est_refuse(self):
        self.stage(GITIGNORE, "/.claude/*\n!/.claude/settings.json\n")
        failure = self.staged_failure()
        self.assertIsNotNone(failure)
        self.assertIn("!/.claude/rules/", failure)

    def test_un_gitignore_sans_l_exception_des_reglages_est_refuse(self):
        self.stage(GITIGNORE, "/.claude/*\n!/.claude/rules/\n")
        failure = self.staged_failure()
        self.assertIsNotNone(failure)
        self.assertIn("!/.claude/settings.json", failure)

    def test_un_gitignore_qui_ignore_tout_le_dossier_est_refuse_malgre_ses_exceptions(self):
        # git ne réinclut rien dans un dossier ignoré en entier : les deux lignes d'exception ne jouent plus.
        self.stage(GITIGNORE, "/.claude/\n!/.claude/settings.json\n!/.claude/rules/\n")
        self.assertIsNotNone(self.staged_failure())

    def test_une_exception_placee_avant_l_exclusion_est_refusee(self):
        self.stage(GITIGNORE, "!/.claude/settings.json\n!/.claude/rules/\n/.claude/*\n")
        self.assertIsNotNone(self.staged_failure())

    def test_une_exception_ecrite_autrement_qui_joue_passe(self):
        self.stage(GITIGNORE, "/.claude/*\n!/.claude/settings.json\n!/.claude/rules\n")
        self.assertIsNone(self.staged_failure())

    def test_un_gitignore_qui_garde_les_deux_exceptions_passe(self):
        self.stage(GITIGNORE, "# commentaire\n" + KEPT + "*.pyc\n")
        self.assertIsNone(self.staged_failure())


class RepoTest(unittest.TestCase):
    def test_le_depot_d_aujourd_hui_passe_les_trois_controles(self):
        self.assertEqual(check.repo_rules_problems(), [])

    def test_check_sh_les_lance_sur_le_depot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "config" / "rules").mkdir(parents=True)
            (root / "config" / "rules" / "essai.md").write_text("Mathis\n", encoding="utf-8")
            (root / GITIGNORE).write_text(KEPT, encoding="utf-8")
            problems = check.repo_rules_problems(root)
        self.assertEqual(len(problems), 1)
        self.assertIn("config/rules/essai.md:1", problems[0])


if __name__ == "__main__":
    unittest.main()
