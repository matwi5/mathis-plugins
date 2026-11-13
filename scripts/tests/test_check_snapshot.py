"""Tests de l'avertissement d'un instantané de ticket pas reposé (scripts/check.py, stale_snapshots,
check_snapshots) : au pre-commit d'un worktree, un fichier indexé qu'une référence
`refs/worktree/flow-board/<id>` porte à une autre version est signalé, sans refuser le commit.
python3 -m unittest discover -s scripts/tests."""

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

FILE = "plugins/essai/hooks/a.ts"
OTHER = "plugins/essai/hooks/b.ts"
ROOT = Path(__file__).resolve().parent.parent.parent


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class StaleSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.main = Path(self.dir.name).resolve() / "clone"
        self.main.mkdir()
        git(self.main, "init", "-q", "-b", "main")
        git(self.main, "config", "user.name", "essai")
        git(self.main, "config", "user.email", "essai@localhost")
        git(self.main, "config", "commit.gpgsign", "false")
        for path, text in ((FILE, "a 0\n"), (OTHER, "b 0\n"), (".gitignore", ".claude/\n")):
            target = self.main / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        git(self.main, "add", ".")
        git(self.main, "commit", "-q", "-m", "base")
        # Les instantanés vivent dans les worktrees : le ticket se fait dans l'un d'eux.
        self.repo = self.main / ".claude" / "worktrees" / "groupe-x"
        git(self.main, "worktree", "add", "-q", "-b", "worktree-groupe-x", str(self.repo))
        self.saved = (check.REPO, check.run.__defaults__)
        self.at(self.repo)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def at(self, repo):
        """Les commandes git de check.py tournent dans REPO, valeur par défaut de `run`."""
        check.REPO = repo
        check.run.__defaults__ = (repo, None)

    def write(self, path, text, repo=None):
        target = (repo or self.repo) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def snapshot(self, ticket, *files, repo=None):
        """Un instantané posé dans l'index de la session, comme le font les étapes à la main (sans Node)
        ou `git add` puis `snapshot.mjs --staged` : indexer, écrire l'arbre, un commit hors branche dont
        le parent est HEAD, la référence. `snapshot.mjs <ticket> <fichiers>` pose le même commit sans
        rien indexer."""
        repo = repo or self.repo
        git(repo, "add", "--", *files)
        tree = git(repo, "write-tree")
        commit = git(repo, "commit-tree", tree, "-p", "HEAD", "-m", f"flow-board snapshot {ticket}")
        git(repo, "update-ref", f"refs/worktree/flow-board/{ticket}", commit)
        return commit

    def test_sans_reference_une_seule_commande_et_rien(self):
        self.write(FILE, "a 1\n")
        git(self.repo, "add", FILE)
        calls = []
        real = check.run

        def counted(args, *rest, **kw):
            calls.append(args)
            return real(args, *rest, **kw)
        with mock.patch.object(check, "run", counted):
            self.assertEqual(check.stale_snapshots(), ([], []))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:2], ["git", "for-each-ref"])

    def test_instantane_repose_ne_dit_rien(self):
        self.write(FILE, "a 1\n")
        self.snapshot("07", FILE)
        # Un correctif, puis la repose : l'index porte la version figée.
        self.write(FILE, "a 2\n")
        self.snapshot("07", FILE)
        self.assertEqual(check.stale_snapshots(), ([], []))

    def test_fichier_change_apres_l_instantane_avertit_sans_refuser(self):
        self.write(FILE, "a 1\n")
        self.write(OTHER, "b 1\n")
        self.snapshot("ticket-05", FILE, OTHER)
        self.write(FILE, "a 2\n")
        git(self.repo, "add", FILE)
        warnings, ignored = check.stale_snapshots()
        self.assertEqual(ignored, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn("ticket-05", warnings[0])
        self.assertIn(FILE, warnings[0])
        # Le contrôle ne refuse pas le commit : le message dit comment le défaire sans rien perdre, puis
        # reposer l'index tel qu'il était (--staged, sans rien reprendre de l'arbre), tous ses fichiers nommés.
        self.assertIn(f"node plugins/flow-board/scripts/snapshot.mjs --staged ticket-05 {FILE} {OTHER})", warnings[0])
        self.assertIn("git reset --soft HEAD^", warnings[0])
        # Signalé sans refuser : report_snapshots ne lève pas.
        with mock.patch.object(check, "log") as log:
            check.report_snapshots(warnings, ignored)
        self.assertTrue(any("avertissement" in str(c) for c in log.call_args_list))

    def test_la_commande_de_repose_nomme_aussi_les_fichiers_indexes_hors_de_l_instantane(self):
        # Le commit du ticket indexe aussi sa ligne Status: (hors de l'instantané) : snapshot.mjs refuse
        # un index qui porte un fichier qu'on ne lui nomme pas, la commande le nomme donc.
        ticket_file = "travail/sujet/issues/07-a.md"
        self.write(FILE, "a 1\n")
        self.snapshot("07", FILE)
        self.write(FILE, "a 2\n")
        self.write(ticket_file, "**Status:** fait\n")
        git(self.repo, "add", FILE, ticket_file)
        [warning], _ = check.stale_snapshots()
        self.assertIn(f"snapshot.mjs --staged 07 {FILE} {ticket_file})", warning)

    def test_la_commande_de_repose_nomme_un_fichier_fige_deja_commite_mais_indexe(self):
        # Un fichier de l'instantané déjà commité à sa version figée, changé de nouveau et indexé avec le
        # ticket : snapshot.mjs --staged le refuserait s'il n'était pas nommé.
        self.write(FILE, "a 1\n")
        self.write(OTHER, "b 1\n")
        self.snapshot("07", FILE, OTHER)
        git(self.repo, "reset", "-q")
        git(self.repo, "add", OTHER)
        git(self.repo, "commit", "-q", "-m", "b figé")
        self.write(OTHER, "b 2\n")
        self.write(FILE, "a 2\n")
        git(self.repo, "add", FILE, OTHER)
        [warning], _ = check.stale_snapshots()
        self.assertIn(f"snapshot.mjs --staged 07 {FILE} {OTHER})", warning)

    def test_rien_n_est_dit_quand_un_autre_controle_refuse_le_commit(self):
        # Le conseil suppose le commit fait : un commit refusé (ici une série en double) n'en reçoit pas.
        doc = "travail/essai/issues/01-a.md"
        self.write(doc, "**Status:** en cours\n")
        self.snapshot("01", doc)
        self.write(doc, "**Status:** fait\n")
        git(self.repo, "add", doc)
        with mock.patch.object(check, "log") as log, mock.patch.object(check, "staged_checks", side_effect=check.Failed("refus")):
            with self.assertRaises(check.Failed):
                check.staged()
        self.assertFalse(any("instantané du ticket" in str(c) for c in log.call_args_list))

    def test_fichier_renomme_apres_l_instantane_avertit(self):
        self.write(FILE, "a 1\nligne commune\nligne commune\nligne commune\n")
        self.snapshot("07", FILE)
        git(self.repo, "mv", FILE, "plugins/essai/hooks/c.ts")
        warnings, _ = check.stale_snapshots()
        self.assertEqual(len(warnings), 1)
        self.assertIn(FILE, warnings[0])

    def test_ticket_deja_commite_puis_un_ticket_suivant_ne_dit_rien(self):
        self.write(FILE, "a 1\n")
        self.snapshot("07", FILE)
        git(self.repo, "commit", "-q", "-m", "ticket 07")
        # Le ticket suivant change le même fichier avant le --clean du 07 : HEAD porte la version figée.
        self.write(FILE, "a 2\n")
        git(self.repo, "add", FILE)
        self.assertEqual(check.stale_snapshots(), ([], []))

    def test_fichier_indexe_hors_de_l_instantane_ne_dit_rien(self):
        self.write(FILE, "a 1\n")
        self.snapshot("07", FILE)
        git(self.repo, "reset", "-q")
        self.write(OTHER, "b 1\n")
        git(self.repo, "add", OTHER)
        self.assertEqual(check.stale_snapshots(), ([], []))

    def test_dans_le_clone_principal_rien(self):
        # Les références du clone principal sont communes à ses discussions : rien n'y est signalé.
        self.at(self.main)
        self.write(FILE, "a 1\n", self.main)
        self.snapshot("07", FILE, repo=self.main)
        self.write(FILE, "a 2\n", self.main)
        git(self.main, "add", FILE)
        self.assertEqual(check.stale_snapshots(), ([], []))

    def test_une_fusion_ne_dit_rien(self):
        doc = "travail/essai/issues/01-a.md"
        self.write(doc, "**Status:** en cours\n")
        self.snapshot("01", doc)
        self.write(doc, "**Status:** fait\n")
        git(self.repo, "add", doc)
        with mock.patch.object(check, "log") as log:
            check.staged(merging=True)
        self.assertFalse(any("instantané du ticket" in str(c) for c in log.call_args_list))

    def test_une_fusion_arretee_puis_commitee_ne_dit_rien(self):
        # Une fusion arrêtée (conflit, --no-commit) se commite par le pre-commit, sans --merge : MERGE_HEAD
        # la dit, et le conseil de défaire le commit n'est jamais donné pour elle.
        doc = "travail/essai/issues/01-a.md"
        self.write(doc, "**Status:** en cours\n")
        self.snapshot("01", doc)
        self.write(doc, "**Status:** fait\n")
        git(self.repo, "add", doc)
        merge_head = Path(git(self.repo, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"))
        merge_head.write_text(git(self.main, "rev-parse", "main") + "\n", encoding="utf-8")
        with mock.patch.object(check, "log") as log:
            check.staged()
        self.assertFalse(any("instantané du ticket" in str(c) for c in log.call_args_list))

    def test_nom_de_reference_hors_forme_ignore_et_signale(self):
        self.write(FILE, "a 1\n")
        commit = self.snapshot("07", FILE)
        for bad in ("-x", "a/b", "x" * 65):
            git(self.repo, "update-ref", f"refs/worktree/flow-board/{bad}", commit)
        self.write(FILE, "a 2\n")
        git(self.repo, "add", FILE)
        warnings, ignored = check.stale_snapshots()
        self.assertEqual(len(warnings), 1)
        self.assertIn("07", warnings[0])
        self.assertEqual(sorted(name for name, _ in ignored), sorted(f"refs/worktree/flow-board/{bad}" for bad in ("-x", "a/b", "x" * 65)))

    def test_reference_qui_n_est_pas_un_commit_ou_sans_parent_ignoree(self):
        blob = git(self.repo, "hash-object", "-w", FILE)
        git(self.repo, "update-ref", "refs/worktree/flow-board/blob", blob)
        root = git(self.repo, "commit-tree", git(self.repo, "write-tree"), "-m", "racine")
        git(self.repo, "update-ref", "refs/worktree/flow-board/racine", root)
        _, ignored = check.stale_snapshots()
        self.assertEqual(sorted(name for name, _ in ignored), ["refs/worktree/flow-board/blob", "refs/worktree/flow-board/racine"])

    def test_chemin_avec_espace_cite_pour_le_shell(self):
        spaced = "plugins/essai/hooks/un fichier.ts"
        self.write(spaced, "x 1\n")
        self.snapshot("07", spaced)
        self.write(spaced, "x 2\n")
        git(self.repo, "add", spaced)
        [warning], _ = check.stale_snapshots()
        self.assertIn("snapshot.mjs --staged 07 'plugins/essai/hooks/un fichier.ts'", warning)

    def test_chemin_avec_caractere_de_controle_jamais_cite_tel_quel(self):
        odd = "plugins/essai/hooks/a\u202e\x1b[31m.ts"
        self.write(odd, "x 1\n")
        self.snapshot("07", odd)
        self.write(odd, "x 2\n")
        git(self.repo, "add", odd)
        [warning], _ = check.stale_snapshots()
        self.assertNotIn("\x1b", warning)
        self.assertNotIn("\u202e", warning)
        self.assertIn("<les fichiers indexés>", warning)

    def test_le_hook_avertit_meme_pour_un_commit_de_documentation_seule(self):
        doc = "travail/essai/issues/01-a.md"
        self.write(doc, "**Status:** en cours\n")
        self.snapshot("01", doc)
        self.write(doc, "**Status:** fait\n")
        git(self.repo, "add", doc)
        with mock.patch.object(check, "log") as log:
            check.staged()
        self.assertTrue(any("instantané du ticket 01 pas reposé" in str(c) for c in log.call_args_list))


class SnapshotTicketFormTest(unittest.TestCase):
    """La forme d'un id de ticket de check.py est celle de snapshot.mjs, et passe le corpus hostile commun."""

    def test_meme_forme_que_snapshot_mjs(self):
        source = (ROOT / "plugins" / "flow-board" / "scripts" / "snapshot.mjs").read_text(encoding="utf-8")
        safe = re.search(r"^const SAFE_TICKET = /\^(.+)\$/$", source, re.M)
        self.assertIsNotNone(safe)
        self.assertEqual(check.SNAPSHOT_TICKET.pattern, safe.group(1))

    @staticmethod
    def corpus():
        """Les entrées de `CORPUS` de corpus.mjs, chacune lue sous sa forme : `ch(…)` (points de code en
        hexadécimal ou en décimal, un ou plusieurs), un texte entre apostrophes ou guillemets, ou
        `'x'.repeat(N)` ; une entrée d'une autre forme fait échouer le test plutôt que de se perdre."""
        source = (ROOT / "plugins" / "flow-board" / "tests" / "corpus.mjs").read_text(encoding="utf-8")
        body = source.split("export const CORPUS = {", 1)[1].split("\n}", 1)[0]
        entries = {}
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            m = re.fullmatch(r"('[^']*'|[\w\u00c0-\u024f-]+):\s*(.+?),?", line)
            if m is None:
                raise AssertionError(f"entrée du corpus illisible : {line}")
            key, value = m.group(1).strip("'"), m.group(2)
            if (codes := re.fullmatch(r"ch\(([^)]*)\)", value)) is not None:
                entries[key] = "".join(chr(int(c.strip(), 0)) for c in codes.group(1).split(","))
            elif (rep := re.fullmatch(r"'(.)'\.repeat\((\d+)\)", value)) is not None:
                entries[key] = rep.group(1) * int(rep.group(2))
            elif re.fullmatch(r"'[^'\\]*'|\"[^\"\\]*\"", value):
                entries[key] = value[1:-1]
            else:
                raise AssertionError(f"valeur du corpus illisible : {line}")
        return entries

    def test_corpus_hostile_commun(self):
        entries = self.corpus()
        self.assertGreater(len(entries), 60)
        self.assertIsNotNone(check.SNAPSHOT_TICKET.fullmatch("T07"))
        passing = [name for name, token in entries.items() if check.SNAPSHOT_TICKET.fullmatch(f"T{token}7")]
        self.assertEqual(passing, [])
        self.assertIsNone(check.SNAPSHOT_TICKET.fullmatch("T" * 65))

    def test_chemin_recopie_et_corpus_hostile_commun(self):
        # Le garde des chemins recopiés dans la commande de repose : un chemin valide passe ; chaque entrée
        # du corpus hors de l'ASCII imprimable le fait refuser (l'espace, les apostrophes et le shell
        # restent permis : shlex.quote les cite) ; « - » en tête et la chaîne très longue aussi.
        self.assertIsNotNone(check.PRINTABLE_PATH.fullmatch("plugins/essai/hooks/a.ts"))
        passing = [name for name, token in self.corpus().items()
                   if check.PRINTABLE_PATH.fullmatch(f"plugins/a{token}b.ts") and not all(" " <= c <= "~" for c in token)]
        self.assertEqual(passing, [])
        self.assertIsNone(check.PRINTABLE_PATH.fullmatch("-x.ts"))
        self.assertIsNone(check.PRINTABLE_PATH.fullmatch("a" * 5000))


if __name__ == "__main__":
    unittest.main()
