"""Tests du contrôle des citations de décisions au pre-commit (scripts/check.py, `citations_added`) :
python3 -m unittest discover -s scripts/tests."""

import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check  # noqa: E402
from test_check_tickets import TicketRepo  # noqa: E402  (le dépôt d'essai du hook)

CITED = "travail/essai/DECISIONS.md"
DECISIONS = "# Décisions — essai\n\n## Série 1 — La base (20/11/2026)\n\nS10 : « le compte rendu attend ».\n"
TICKET = "travail/essai/issues/03-cite.md"
GOOD = f"La série 1 de `{CITED}` : « le compte rendu attend ».\n"
BAD = f"La série 2 de `{CITED}` dit le contraire.\n"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class CitationsHookTest(TicketRepo):
    def setUp(self):
        super().setUp()
        self.stage(CITED, DECISIONS)
        git(self.repo, "commit", "-q", "-m", "décisions")

    def refused(self):
        with self.assertRaises(check.Failed) as caught:
            check.staged()
        return str(caught.exception)

    def test_une_citation_fausse_ajoutee_est_refusee_avec_le_fichier_et_la_ligne(self):
        self.stage(TICKET, "# 03: essai\n\n" + BAD)
        self.assertIn("1 citation(s) de décisions fausse(s)", self.refused())
        self.assertEqual(check.citations_added([TICKET]),
                         [f"{TICKET}:3 : « série 2 de `{CITED}` » : absent : série 2 n'est pas dans {CITED}"])

    def test_une_citation_juste_passe(self):
        self.stage(TICKET, "# 03: essai\n\n" + GOOD + f"Et S10 de `{CITED}`.\n")
        check.staged()

    def test_une_citation_fausse_deja_dans_head_ne_refuse_pas_le_commit(self):
        self.stage(TICKET, "# 03: essai\n\n" + BAD + "\n- [ ] critère\n")
        git(self.repo, "commit", "-q", "-m", "ticket d'avant le contrôle")
        self.stage(TICKET, "# 03: essai\n\n" + BAD + "\n- [x] critère\n")
        check.staged()
        # Sa propre ligne cochée, avec une note : la citation est la même, rien n'est refusé.
        old = f"- [ ] La série 2 de `{CITED}` : « rien de tel ».\n"
        self.stage(TICKET, "# 03: essai\n\n" + old)
        git(self.repo, "commit", "-q", "-m", "critère d'avant le contrôle")
        self.stage(TICKET, "# 03: essai\n\n" + old.replace("[ ]", "[x]").replace(".\n", " — test_x.\n"))
        check.staged()
        # La citation elle-même changée (série 2 devenue série 3) est relue, et refusée.
        self.stage(TICKET, "# 03: essai\n\n" + old.replace("série 2", "série 3"))
        self.refused()
        # Une deuxième copie de la même citation fausse est nouvelle, après l'ancienne comme au-dessus d'elle.
        self.stage(TICKET, "# 03: essai\n\n" + old + old)
        self.refused()
        self.stage(TICKET, "# 03: essai\n\n" + old + "\nAutre.\n\n" + old)
        git(self.repo, "commit", "-q", "-m", "deux paragraphes")
        self.stage(TICKET, "# 03: essai\n\n" + old + "\nAutre.\n\n" + old + old)
        self.assertEqual(len(check.citations_added([TICKET])), 1)
        self.stage(TICKET, "# 03: essai\n\n" + old + old + "\nAutre.\n\n" + old)
        self.assertEqual(len(check.citations_added([TICKET])), 1)

    def test_une_citation_juste_a_head_que_le_commit_rend_fausse_est_refusee(self):
        # Le même commit change la série citée et coche la ligne qui la cite : HEAD ne la portait pas fausse.
        line = f"- [ ] La série 1 de `{CITED}` : « le compte rendu attend ».\n"
        self.stage(TICKET, "# 03: essai\n\n" + line)
        git(self.repo, "commit", "-q", "-m", "citation juste")
        self.stage(CITED, DECISIONS.replace("attend", "part"))
        self.stage(TICKET, "# 03: essai\n\n" + line.replace("[ ]", "[x]"))
        self.assertEqual(len(check.citations_added([TICKET, CITED])), 1)

    def test_un_echec_de_git_ls_tree_refuse_au_lieu_de_tout_compter_neuf(self):
        self.stage(TICKET, "# 03: essai\n\n" + BAD)
        real = check.run

        def failing(args, timeout, *rest, **kw):
            return (1, "fatal") if args[:2] == ["git", "ls-tree"] else real(args, timeout, *rest, **kw)

        with mock.patch.object(check, "run", failing), self.assertRaises(check.Failed) as caught:
            check.citations_added([TICKET])
        self.assertIn("git ls-tree a échoué", str(caught.exception))

    def test_une_ligne_retiree_au_milieu_d_une_phrase_citee_est_relue(self):
        self.stage(TICKET, f"# 03: essai\n\nLa série 1 de `{CITED}` : « le compte\nrendu\nattend ».\n")
        git(self.repo, "commit", "-q", "-m", "citation sur trois lignes")
        self.stage(TICKET, f"# 03: essai\n\nLa série 1 de `{CITED}` : « le compte\nattend ».\n")
        self.assertIn("citation absente", check.citations_added([TICKET])[0])

    def test_le_fichier_cite_se_lit_dans_l_index(self):
        # Série 2 sur le disque seulement (l'ajout non commité d'une autre discussion) : refusé.
        self.write(CITED, DECISIONS + "\n## Série 2 — La suite (20/11/2026)\n\nS20.\n")
        self.stage(TICKET, "# 03: essai\n\n" + BAD)
        self.refused()
        # Série 2 indexée, le disque revenu en arrière : la citation passe.
        git(self.repo, "add", CITED)
        self.write(CITED, DECISIONS)
        self.assertEqual(check.citations_added([TICKET]), [])

    def test_aucune_commande_du_hook_ne_recoit_le_chemin_cite(self):
        calls = []
        real = subprocess.run

        def spy(args, **kw):
            calls.append([str(a) for a in args])
            return real(args, **kw)

        self.stage(TICKET, "# 03: essai\n\n" + GOOD + f"Puis S10 de `{CITED}` et série 4 de `../x/DECISIONS.md`.\n")
        with mock.patch.object(subprocess, "run", spy):
            self.assertEqual(check.citations_added([TICKET]), [])
        # Le fichier cité a bien été lu dans l'index, par l'empreinte de son contenu.
        self.assertTrue([c for c in calls if c[:2] == ["git", "show"] and len(c) == 3 and len(c[2]) == 40])
        self.assertEqual([c for c in calls if any("DECISIONS.md" in a for a in c)], [])

    def test_une_phrase_citee_fausse_sur_une_ligne_ajoutee_refuse(self):
        self.stage(TICKET, f"# 03: essai\n\nLa série 1 de `{CITED}` : « le compte\nrendu attend ».\n")
        git(self.repo, "commit", "-q", "-m", "ticket juste")
        self.stage(TICKET, f"# 03: essai\n\nLa série 1 de `{CITED}` : « le compte\nrendu part ».\n")
        self.assertIn("citation absente", check.citations_added([TICKET])[0])

    def test_une_spec_refuse_un_fichier_de_decisions_avertit_un_autre_texte_rien(self):
        self.stage("travail/essai/spec.md", BAD)
        self.refused()
        git(self.repo, "reset", "-q")
        # Un fichier de décisions recopie mot pour mot une question qui citait faux : avertissement, commit accepté.
        self.stage(CITED, DECISIONS + "\n## Série 2 — La suite (20/11/2026)\n\n" + f"Voir la série 5 de `{CITED}`.\n")
        check.staged()
        self.assertEqual(len(check.WARNINGS), 1)
        self.assertIn(f"{CITED}:9 : « série 5 de `{CITED}` » : absent : série 5 n'est pas dans {CITED}", check.WARNINGS[0])
        self.assertIn("(fichier de décisions : recopié tel quel, pas refusé)", check.WARNINGS[0])
        check.WARNINGS.clear()
        # Le même commit avec un ticket qui cite faux (la série 2 est maintenant dans l'index) : refusé.
        self.stage(TICKET, "# 03: essai\n\n" + BAD.replace("série 2", "série 3"))
        self.refused()
        git(self.repo, "reset", "-q")
        git(self.repo, "checkout", "-q", "--", CITED)
        git(self.repo, "reset", "-q")
        self.stage("travail/essai/notes.md", BAD)
        check.staged()

    def test_un_ticket_renomme_ne_rejuge_pas_ses_citations_d_avant(self):
        self.stage(TICKET, "# 03: essai\n\n" + BAD)
        git(self.repo, "commit", "-q", "-m", "ticket d'avant le contrôle")
        git(self.repo, "mv", TICKET, "travail/essai/issues/04-cite.md")
        check.staged()

    def test_une_fusion_ne_juge_pas_les_citations(self):
        self.stage(TICKET, "# 03: essai\n\n" + BAD)
        check.staged(merging=True)


if __name__ == "__main__":
    unittest.main()
