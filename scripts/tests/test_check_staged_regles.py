"""Tests du hook pre-commit (scripts/check.py --staged) et de ses contrôles statiques. Sur un commit qui
ne touche que la règle d'un plugin (`config/rules/<plugin>.md`) ou une liste d'admis
(`scripts/renvois-admis.json`, `scripts/interpolations-admises.json`, `scripts/exports-admis.json`) : il lance les contrôles statiques
qui les lisent, sur la copie de l'index, et refuse une liste d'admis qui augmente face à HEAD. Sur un
commit qui indexe un fichier de code d'un plugin : il lance sur la copie de l'index les contrôles
statiques de check.sh hors arbre « Architecture » et appels du moteur (renvois, termes retirés, valeurs
relues brutes, exports morts, termes de l'export public, règles du code). python3 -m unittest discover -s scripts/tests."""

import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

RULE = "config/rules/flow-board.md"
REFS = "scripts/renvois-admis.json"
INTERPOLATIONS = "scripts/interpolations-admises.json"
HOOK = "plugins/flow-board/hooks/model.ts"
USES = "plugins/flow-board/hooks/view.tsx"
EXPORTS = "scripts/exports-admis.json"
# Un site brut admis (`${run.title}`) et un renvoi admis (« Q3 ») dans les hooks du plugin.
CODE = "// la règle (Q3)\nexport const titre = (run: any) => `Parcours ${run.title}`\n"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def admitted(counts):
    return json.dumps({"date": "2026-11-01", "files": counts}, indent=2) + "\n"


class StagedRepo(unittest.TestCase):
    """Un dépôt d'essai avec le plugin flow-board, sa règle et ses listes d'admis, et le hook pointé
    dessus ; sans test à lui."""

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
        # Un autre module nomme ses exports : aucun n'est mort (exports-admis.json, absent, n'en admet aucun).
        self.write(USES, "import { titre } from './model'\n")
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


class StagedRulesTest(StagedRepo):
    def test_un_terme_retire_ajoute_a_la_regle_seule_est_refuse(self):
        self.stage(RULE, "# Règle\n\n- en mode auto, le mod lance la vague suivante.\n")
        self.assertIn("flow-board", self.refused())

    def test_un_renvoi_de_la_regle_vers_une_section_absente_est_refuse(self):
        self.stage("config/rules/agents.md", "# Agents\n\n## Revues dans un spécialiste Opus\n")
        self.stage(RULE, "# Règle\n\n- voir la section « Revues par Haiku » de `agents.md`.\n")
        refused = self.refused()
        self.assertIn(f"{RULE}:3", refused)
        self.assertIn("« Revues par Haiku »", refused)
        self.stage(RULE, "# Règle\n\n- voir la section « Revues dans un spécialiste Opus » de `agents.md`.\n")
        check.staged()

    def test_un_titre_renomme_dans_une_regle_commune_relit_les_renvois_de_chaque_plugin(self):
        self.stage("config/rules/agents.md", "# Agents\n\n## Revues dans un spécialiste Opus\n")
        self.stage(RULE, "# Règle\n\n- voir la section « Revues dans un spécialiste Opus » de `agents.md`.\n")
        check.staged()
        git(self.repo, "commit", "-q", "--no-verify", "-m", "renvoi juste")
        for renamed in ("config/rules/agents.md", "config/reference/revues.md"):
            with self.subTest(renamed=renamed):
                if renamed == "config/reference/revues.md":
                    self.stage(RULE, "# Règle\n\n- voir la section « Tableau » de `config/reference/revues.md`.\n")
                    self.stage(renamed, "# Revues\n\n## Tableau\n")
                    check.staged()
                    git(self.repo, "commit", "-q", "--no-verify", "-m", "renvoi vers une référence")
                    self.stage(renamed, "# Revues\n\n## Tableau des efforts\n")
                else:
                    self.stage(renamed, "# Agents\n\n## Revues par Opus\n")
                refused = self.refused()
                self.assertIn(f"{RULE}:3", refused)
                git(self.repo, "checkout", "HEAD", "--", renamed)

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

    def test_la_liste_des_exports_admis_se_releve_une_fois_puis_n_augmente_plus(self):
        self.stage(HOOK, CODE + "export const mort = 1\n")
        self.stage(EXPORTS, admitted({"flow-board/hooks/model.ts": 1}))
        check.staged()
        git(self.repo, "commit", "-q", "--no-verify", "-m", "relevé des exports morts")
        self.stage(EXPORTS, admitted({"flow-board/hooks/model.ts": 2}))
        self.assertIn(EXPORTS, self.refused())
        self.stage(EXPORTS, admitted({}))
        self.assertIn("« mort »", self.refused())

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

    def test_une_regle_qui_n_est_pas_celle_d_un_plugin_ne_relit_que_les_renvois_de_section(self):
        # Ni les termes retirés d'un plugin ni ses autres contrôles : seuls les renvois de section des plugins.
        self.stage("config/rules/general.md", "# Règles générales\n\nla vague suivante\n")
        with mock.patch.object(check, "check_code", side_effect=AssertionError("contrôle du code lancé")):
            check.staged()
        self.assertEqual(self.exported, 1)

    def test_une_cle_d_admis_hors_des_plugins_ne_designe_aucun_plugin(self):
        # Une clé baissée qui ne nomme pas un plugin (« .. », un nom inconnu) : rien à contrôler hors de plugins/.
        self.stage(REFS, admitted({"flow-board/hooks/model.ts": 1, "../x.ts": 0}))
        check.staged()
        self.write(REFS, admitted({"flow-board/hooks/model.ts": 1, "../x.ts": 2}))
        git(self.repo, "add", REFS)
        git(self.repo, "commit", "-q", "--no-verify", "-m", "liste avec une clé hors des plugins")
        self.stage(REFS, admitted({"flow-board/hooks/model.ts": 1, "../x.ts": 1}))
        self.assertEqual(check.admitted_changes(REFS)[1], set())

    def test_un_terme_retire_ajoute_que_la_regle_porte_encore_est_refuse(self):
        self.stage("plugins/flow-board/termes-retires.txt", "# termes retirés\n0.1.0\tvague suivante\n0.2.0\tlui-même\n")
        refused = self.refused()
        self.assertIn(f"{RULE}:3", refused)
        self.assertIn("lui-même", refused)

    def test_la_liste_des_termes_retires_seule_ne_lance_que_les_controles_statiques(self):
        self.stage("plugins/flow-board/termes-retires.txt", "# termes retirés\n0.1.0\tvague suivante\n0.2.0\tvague close\n")
        self.stage("plugins/flow-board/README.md", "# flow-board\n")
        heavy = AssertionError("contrôle du code lancé pour une liste de termes retirés")
        with mock.patch.object(check, "check_code", side_effect=heavy), \
                mock.patch.object(check, "validate", side_effect=heavy), \
                mock.patch.object(check, "typecheck", side_effect=heavy), \
                mock.patch.object(check, "plugin_tests", side_effect=heavy):
            check.staged()
        self.assertEqual(self.exported, 1)

    def test_un_commit_de_documentation_sans_ces_fichiers_reste_sans_controle(self):
        self.stage("README.md", "# Dépôt\n\nla vague suivante, Q4, Q5\n")
        self.stage("travail/essai/notes.md", "notes\n")
        check.staged()
        self.assertEqual(self.exported, 0)


# Ces valeurs que l'export refuse s'écrivent par morceaux : ce fichier part dans la version publique.
MAIL = "git" + "@" + "example.com"
HAS_EXPORT = (Path(check.__file__).resolve().parent / "export_public.py").is_file()


class StagedCodeTest(StagedRepo):
    """Un commit qui indexe un fichier de code d'un plugin : des contrôles statiques de check.sh tournent
    sur la copie de l'index (renvois, termes retirés, termes de l'export public, règles du code ; ni l'arbre
    « Architecture » ni les appels du moteur), avec le fichier et la ligne de chaque défaut."""

    def setUp(self):
        super().setUp()
        # La liste privée de l'export, absente : seuls les adresses et les dossiers personnels comptent.
        # `tsc` et `claude plugin test` n'ont rien à relire dans ce dépôt d'essai.
        for name, value in (("EXPORT_DENYLIST", self.repo / "absente.txt"),
                            ("typecheck", lambda plugin: None), ("plugin_tests", lambda *args: None)):
            patcher = mock.patch.object(check, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_un_renvoi_a_travail_dans_le_code_est_refuse(self):
        self.stage(HOOK, CODE + "// voir travail/diagnostic/spec.md\n")
        self.assertIn("flow-board/hooks/model.ts:3", self.refused())

    def test_un_terme_retire_dans_le_code_est_refuse(self):
        self.stage(HOOK, CODE + "// le mod lance la vague suivante\n")
        refused = self.refused()
        self.assertIn("flow-board/hooks/model.ts:3", refused)
        self.assertIn("vague suivante", refused)

    @unittest.skipUnless(HAS_EXPORT, "sans scripts/export_public.py (version publique)")
    def test_un_terme_de_l_export_public_dans_un_test_est_refuse(self):
        self.stage("plugins/flow-board/tests/a.test.ts", f"const a = 1\nconst m = '{MAIL}'\n")
        refused = self.refused()
        self.assertIn("flow-board/tests/a.test.ts:2", refused)
        self.assertIn("export public", refused)

    def test_un_caractere_invisible_brut_est_refuse(self):
        self.stage(HOOK, CODE + f"export const s = 'a{chr(0x2028)}b'\n")
        refused = self.refused()
        self.assertIn("flow-board/hooks/model.ts:3", refused)
        self.assertIn("U+2028", refused)

    def test_un_export_que_personne_ne_nomme_est_refuse_avec_le_fichier_la_ligne_et_le_nom(self):
        self.stage(HOOK, CODE + "export function oublie() {}\n")
        refused = self.refused()
        self.assertIn("flow-board/hooks/model.ts", refused)
        self.assertIn("3 « oublie »", refused)

    def test_un_bloc_de_doc_detache_est_refuse(self):
        self.stage(HOOK, CODE + "/** premier */\n/** second */\nexport const b = 2\n")
        self.assertIn("flow-board/hooks/model.ts:4", self.refused())

    def test_un_code_propre_passe(self):
        self.stage(HOOK, CODE + "export const b = 2\n")
        self.stage(USES, "import { titre, b } from './model'\n")
        check.staged()
        self.assertEqual(self.exported, 1)

    def test_la_documentation_d_un_plugin_seule_reste_sans_controle(self):
        self.stage("plugins/flow-board/README.md", f"# flow-board\n\nla vague suivante, voir travail/diag/spec.md, {MAIL}\n")
        check.staged()
        self.assertEqual(self.exported, 0)

    def test_un_plugin_identique_au_dernier_check_vert_saute_ces_controles(self):
        self.stage(HOOK, CODE + "// le mod lance la vague suivante\n")
        with mock.patch.object(check, "passed_already", lambda plugin: True):
            check.staged()


class StagedCommentsTest(StagedRepo):
    """Un commit qui ne change que des commentaires d'un module de `hooks/` : le pre-commit garde les
    contrôles statiques, `tsc` et les tests qui épinglent un texte retiré, et saute la suite du plugin ;
    chaque cas a son miroir où la suite tourne."""

    LONG = "// une phrase de commentaire assez longue pour être épinglée par un test\n"

    def setUp(self):
        super().setUp()
        self.calls = []
        for name in ("typecheck", "plugin_tests", "engine_subset"):
            patcher = mock.patch.object(check, name, lambda *args, _n=name, **kw: self.calls.append((_n, args)))
            patcher.start()
            self.addCleanup(patcher.stop)
        original = check.check_code

        def code(*args):
            self.calls.append(("check_code", args))
            return original(*args)
        patcher = mock.patch.object(check, "check_code", code)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(check, "EXPORT_DENYLIST", self.repo / "absente.txt")
        patcher.start()
        self.addCleanup(patcher.stop)

    def ran(self):
        return [name for name, _ in self.calls]

    def staged(self):
        with redirect_stdout(io.StringIO()) as out:
            check.staged()
        return out.getvalue()

    def test_un_commentaire_seul_saute_la_suite_et_garde_les_controles(self):
        out = self.staged_after(HOOK, "// la règle (Q3), relue\n" + CODE.split("\n", 1)[1])
        self.assertIn("check_code", self.ran())
        self.assertIn("typecheck", self.ran())
        self.assertNotIn("plugin_tests", self.ran())
        self.assertIn("commentaires seuls dans hooks/, suite du plugin sautée", out)

    def test_miroir_une_ligne_de_code_lance_la_suite(self):
        self.staged_after(HOOK, CODE.replace("Parcours", "Mission"))
        self.assertIn("plugin_tests", self.ran())

    def test_miroir_un_commentaire_et_un_test_lancent_la_suite(self):
        self.stage("plugins/flow-board/tests/a.test.ts", "// un test\n")
        self.staged_after(HOOK, "// la règle (Q3), relue\n" + CODE.split("\n", 1)[1])
        self.assertIn("plugin_tests", self.ran())

    def test_miroir_un_commentaire_dans_un_module_neuf_lance_la_suite(self):
        self.stage("plugins/flow-board/hooks/neuf.ts", "// rien que du commentaire\n")
        self.staged()
        self.assertIn("plugin_tests", self.ran())

    def test_miroir_un_commentaire_dans_une_chaine_lance_la_suite(self):
        self.write(HOOK, CODE + "const s = '// avant'\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "chaîne")
        self.staged_after(HOOK, CODE + "const s = '// après'\n")
        self.assertIn("plugin_tests", self.ran())

    def test_miroir_un_commentaire_et_un_changement_de_mode_lancent_la_suite(self):
        self.stage(HOOK, "// la règle (Q3), relue\n" + CODE.split("\n", 1)[1])
        git(self.repo, "update-index", "--chmod=+x", HOOK)
        self.staged()
        self.assertIn("plugin_tests", self.ran())

    def test_un_test_qui_epingle_le_commentaire_retire_tourne_seul(self):
        self.write(HOOK, self.LONG + CODE)
        self.write("plugins/flow-board/tests/epingle.test.ts",
                   "// une phrase de commentaire assez longue pour être épinglée par un test\n")
        self.write("plugins/flow-board/tests/autre.test.ts", "// rien\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "épingle")
        out = self.staged_after(HOOK, "// une autre phrase\n" + CODE)
        self.assertNotIn("plugin_tests", self.ran())
        subset = [args for name, args in self.calls if name == "engine_subset"]
        self.assertEqual(len(subset), 1)
        self.assertEqual(subset[0][1], {Path("tests/epingle.test.ts")})
        self.assertIn("epingle.test.ts", out)

    def staged_after(self, rel, text):
        self.stage(rel, text)
        return self.staged()


if __name__ == "__main__":
    unittest.main()
