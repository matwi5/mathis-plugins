"""Tests du refus d'un ticket sensible sans sa recherche citée, et d'une case mal formée (scripts/check.py, hook pre-commit) :
python3 -m unittest discover -s scripts/tests."""

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

OLD = "travail/essai/issues/01-ancien.md"
NEW = "travail/essai/issues/02-nouveau.md"
SENSITIVE = "# 0X: essai\n\nZone sensible : oui (suppression)\nLogique : oui\n\n- [ ] critère\n"
SEARCH = "Recherche des chemins qui effacent : `grep -rn \"unlink\" hooks` — 2 résultats, `model.ts:12`, `model.ts:40`.\n"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class TicketRepo(unittest.TestCase):
    """Un dépôt d'essai avec un ancien ticket sensible commité sans recherche, et le hook pointé dessus ;
    sans test à lui."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        # Un ticket sensible d'avant le contrôle, déjà commité sans recherche.
        self.write(OLD, SENSITIVE)
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def stage(self, rel, text):
        self.write(rel, text)
        git(self.repo, "add", rel)


class SensitiveTicketTest(TicketRepo):
    def test_un_nouveau_ticket_sensible_sans_recherche_est_refuse(self):
        self.stage(NEW, SENSITIVE)
        problems = check.tickets_without_search([NEW])
        self.assertEqual(len(problems), 1)
        self.assertIn(NEW, problems[0])
        self.assertIn("Recherche", problems[0])
        with self.assertRaises(check.Failed):
            check.staged()

    def test_un_ticket_sensible_avec_sa_recherche_ou_non_sensible_passe(self):
        self.stage(NEW, SENSITIVE + SEARCH)
        self.stage("travail/essai/issues/03-texte.md", "# 03: texte\n\nZone sensible : non\n")
        self.assertEqual(check.tickets_without_search([NEW, "travail/essai/issues/03-texte.md"]), [])
        check.staged()

    def test_une_ligne_recherche_sans_commande_ou_sans_resultat_ne_suffit_pas(self):
        for search in ["Recherche : à faire.\n", "Recherche : `grep -rn x hooks`\n", "**Recherche** :\n```\n$ grep -rn x hooks\n```\n"]:
            self.stage(NEW, SENSITIVE + search)
            self.assertEqual(len(check.tickets_without_search([NEW])), 1, search)

    def test_la_ligne_recherche_ecrite_selon_la_consigne_du_cadrage_passe(self):
        # La forme que la consigne du cadrage (register.tsx) donne à la ligne « Recherche », remplie : des
        # tickets sensibles avaient été refusés faute de connaître cette forme avant de l'écrire.
        source = (Path(__file__).resolve().parents[2] / "plugins/flow-board/hooks/register.tsx").read_text(encoding="utf-8")
        form = re.search(r"« (Recherche : `<command>` — <result>) »", source)
        self.assertIsNotNone(form, "la consigne du cadrage ne donne plus la forme de la ligne « Recherche »")
        line = form.group(1).replace("<command>", 'grep -rn "unlink" hooks').replace("<result>", "2 résultats, `model.ts:12`")
        self.stage(NEW, SENSITIVE + line + "\n")
        self.assertEqual(check.tickets_without_search([NEW]), [])
        check.staged()
        # Le modèle seul, sans commande ni résultat, ne suffit pas.
        self.stage(NEW, SENSITIVE + form.group(1) + "\n")
        self.assertEqual(len(check.tickets_without_search([NEW])), 1)

    def test_la_forme_en_gras_avec_un_bloc_de_code_est_reconnue(self):
        fenced = "**Recherche** (01/11/2026, relire avant de coder) :\n```\n$ grep -n -E \"eraseFile\" hooks/erase-run.ts\n→ 460 mainRefPath\n```\nSuite du ticket.\n"
        self.stage(NEW, SENSITIVE + fenced)
        self.assertEqual(check.tickets_without_search([NEW]), [])

    def test_un_resultat_entre_accents_graves_passe_un_hash_seul_non(self):
        self.stage(NEW, SENSITIVE + "**Recherche** : `grep -n foo plugins/x.ts` → `x.ts:12`\n")
        self.assertEqual(check.tickets_without_search([NEW]), [])
        self.stage(NEW, SENSITIVE + "Recherche faite (main `a73c609`) : à faire\n")
        self.assertEqual(len(check.tickets_without_search([NEW])), 1)

    def test_a_la_fusion_un_ticket_deja_commite_sur_la_branche_fusionnee_passe(self):
        git(self.repo, "checkout", "-q", "-b", "groupe")
        self.write(NEW, SENSITIVE)
        git(self.repo, "add", NEW)
        git(self.repo, "commit", "-q", "-m", "ancien ticket du groupe")
        git(self.repo, "checkout", "-q", "main")
        git(self.repo, "merge", "-q", "--no-ff", "--no-commit", "groupe")
        self.assertEqual(check.tickets_without_search([NEW]), [])

    def test_la_zone_sensible_en_gras_est_reconnue(self):
        self.stage(NEW, "# 02: essai\n\n**Zone sensible :** oui. Concurrence : un fichier par session.\n")
        self.assertEqual(len(check.tickets_without_search([NEW])), 1)
        self.stage(NEW, "# 02: essai\n\n**Zone sensible :** non.\n")
        self.assertEqual(check.tickets_without_search([NEW]), [])

    def test_un_ancien_ticket_sensible_sans_recherche_passe_quand_on_le_coche(self):
        self.stage(OLD, SENSITIVE.replace("- [ ]", "- [x]"))
        self.assertEqual(check.tickets_without_search([OLD]), [])
        check.staged()

    def test_un_ticket_qui_devient_sensible_sans_recherche_est_refuse(self):
        self.write(NEW, SENSITIVE.replace("oui (suppression)", "non"))
        git(self.repo, "add", NEW)
        git(self.repo, "commit", "-q", "-m", "texte")
        self.stage(NEW, SENSITIVE)
        self.assertEqual(len(check.tickets_without_search([NEW])), 1)


class CheckboxTest(TicketRepo):
    """Les cases d'un ticket indexé : seules « - [ ] » et « - [x] » sont bien formées."""

    def test_une_case_mal_formee_est_refusee_avec_le_fichier_la_ligne_et_la_forme_attendue(self):
        for bad in ("- [x ] fait", "- [ x] fait", "- [] à faire", "- [X] fait", "  - [  ] sous-critère", "* [x] fait", "-[x] fait", "- [x]fait"):
            with self.subTest(bad=bad):
                self.stage(NEW, f"# 02: essai\n\n- [x] bon\n{bad}\n")
                problems = check.malformed_checkboxes([NEW])
                self.assertEqual(len(problems), 1)
                self.assertIn(f"{NEW}:4", problems[0])
                self.assertIn("« - [ ] »", problems[0])
                self.assertIn("« - [x] »", problems[0])
                with self.assertRaises(check.Failed):
                    check.staged()

    def test_des_cases_bien_formees_un_lien_ou_un_bloc_de_code_passent(self):
        text = ("# 02: essai\n\n- [ ] à faire\n- [x] fait\n  - [x] sous-critère\n- [CR](lien) une liste de liens\n"
                "Exemple cité : `- [x ]`, refusé.\n```\n- [x ] dans un bloc de code\n```\n")
        self.stage(NEW, text)
        self.assertEqual(check.malformed_checkboxes([NEW]), [])
        check.staged()

    def test_un_bloc_clos_par_tildes_cache_ses_cases_mais_pas_celles_d_apres(self):
        text = ("# 02: essai\n\n~~~\n- [x ] exemple dans un bloc\n```\n- [ x] toujours dans le bloc\n~~~\n"
                "- [x ] hors du bloc\n")
        self.stage(NEW, text)
        problems = check.malformed_checkboxes([NEW])
        self.assertEqual(len(problems), 1)
        self.assertIn(f"{NEW}:8", problems[0])

    def test_un_lien_dont_le_texte_est_x_ou_vide_n_est_pas_une_case(self):
        self.stage(NEW, "# 02: essai\n\n- [x](lien) un lien\n- [ ](lien) un autre\n")
        self.assertEqual(check.malformed_checkboxes([NEW]), [])


if __name__ == "__main__":
    unittest.main()
