"""Tests du refus d'un ticket sensible sans sa recherche citée, et d'une case mal formée (scripts/check.py, hook pre-commit) :
python3 -m unittest discover -s scripts/tests."""

import contextlib
import io
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
        check.WARNINGS.clear()  # un avertissement d'un test ne passe pas au suivant
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
        # La forme que la consigne du cadrage (decoupage.ts) donne à la ligne « Recherche », remplie : des
        # tickets sensibles avaient été refusés faute de connaître cette forme avant de l'écrire.
        source = (Path(__file__).resolve().parents[2] / "plugins/flow-board/hooks/decoupage.ts").read_text(encoding="utf-8")
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
        # Sur un ticket que HEAD porte déjà : un ticket neuf coché est refusé pour une autre raison (DoneNewTicketTest).
        text = ("# 02: essai\n\n- [ ] à faire\n- [x] fait\n  - [x] sous-critère\n- [CR](lien) une liste de liens\n"
                "Exemple cité : `- [x ]`, refusé.\n```\n- [x ] dans un bloc de code\n```\n")
        self.stage(OLD, text)
        self.assertEqual(check.malformed_checkboxes([OLD]), [])
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


class DoneNewTicketTest(TicketRepo):
    """Un ticket neuf (absent de HEAD, pas renommé) ne se commite pas écrit comme déjà fait."""

    def problems(self):
        return check.new_tickets_written_done([NEW], check.staged_moves())

    def test_un_ticket_neuf_au_statut_fait_est_refuse_avec_la_ligne_et_la_forme_attendue(self):
        for status in ("**Status:** fait (03/11/2026)", "Status: done", "**Status:** Fait", "Status : fait"):
            with self.subTest(status=status):
                self.stage(NEW, f"# 02: essai\n\n{status}\n\n- [ ] critère\n")
                problems = self.problems()
                self.assertEqual(len(problems), 1)
                self.assertIn(f"{NEW}:3", problems[0])
                self.assertIn("Status: ready-for-agent", problems[0])
                self.assertIn("« - [ ] »", problems[0])
                with self.assertRaises(check.Failed):
                    check.staged()

    def test_un_ticket_neuf_que_le_relais_lirait_fait_est_refuse(self):
        # Le vocabulaire du relais : « terminé » et « Statut : » disent fait aussi.
        for status in ("**Status:** terminé", "**Statut :** fait", "Statut : Terminé (03/11)"):
            with self.subTest(status=status):
                self.stage(NEW, f"# 02: essai\n\n{status}\n\n- [ ] critère\n")
                self.assertEqual(len(self.problems()), 1)
                with self.assertRaises(check.Failed):
                    check.staged()

    def test_un_ticket_neuf_qui_porte_une_case_cochee_est_refuse(self):
        self.stage(NEW, "# 02: essai\n\n**Status:** ready-for-agent\n\n- [ ] critère\n- [x] check.sh passé\n")
        problems = self.problems()
        self.assertEqual(len(problems), 1)
        self.assertIn(f"{NEW}:6", problems[0])
        with self.assertRaises(check.Failed):
            check.staged()

    def test_une_case_cochee_dans_un_bloc_de_code_passe(self):
        self.stage(NEW, "# 02: essai\n\n**Status:** ready-for-agent\n\n```\n- [x] exemple\n```\n- [ ] critère\n")
        self.assertEqual(self.problems(), [])
        check.staged()

    def test_les_statuts_bloque_retire_et_pret_passent(self):
        for status in ("**Status:** ready-for-agent", "**Status:** blocked (attend 01)", "**Status:** retiré (doublon)",
                       "Status: blocked"):
            with self.subTest(status=status):
                self.stage(NEW, f"# 02: essai\n\n{status}\n\n- [ ] critère\n")
                self.assertEqual(self.problems(), [])
                check.staged()

    def test_un_ticket_deja_a_head_fait_ou_coche_passe(self):
        self.stage(OLD, "# 01: ancien\n\n**Status:** fait\n\n- [x] critère\n")
        self.assertEqual(check.new_tickets_written_done([OLD], check.staged_moves()), [])
        check.staged()

    def test_un_ticket_renomme_passe_une_copie_compte_comme_neuve(self):
        git(self.repo, "rm", "-q", "--cached", OLD)
        (self.repo / OLD).unlink()
        self.write(OLD, "# 01: ancien\n\n**Status:** fait\n\n- [x] critère\n")
        git(self.repo, "add", OLD)
        git(self.repo, "commit", "-q", "-m", "ancien fait")
        git(self.repo, "mv", OLD, NEW)
        self.assertEqual(check.staged_moves()[NEW][0], "R")
        self.assertEqual(self.problems(), [])
        check.staged()
        git(self.repo, "commit", "-q", "-m", "renommé")
        # Une copie du ticket fait sous un nouveau nom : neuve, refusée.
        copy = "travail/essai/issues/03-copie.md"
        self.stage(copy, (self.repo / NEW).read_text(encoding="utf-8"))
        self.assertEqual(len(check.new_tickets_written_done([copy], check.staged_moves())), 2)
        with self.assertRaises(check.Failed):
            check.staged()

    def test_a_la_fusion_un_ticket_fait_de_la_branche_fusionnee_passe(self):
        git(self.repo, "checkout", "-q", "-b", "groupe")
        self.write(NEW, "# 02: essai\n\n**Status:** fait\n\n- [x] critère\n")
        git(self.repo, "add", NEW)
        git(self.repo, "commit", "-q", "-m", "ticket fait du groupe")
        git(self.repo, "checkout", "-q", "main")
        git(self.repo, "merge", "-q", "--no-ff", "--no-commit", "groupe")
        self.assertEqual(self.problems(), [])
        check.staged()
        # Un autre ticket neuf écrit fait pendant la fusion arrêtée, que la branche fusionnée ne portait pas.
        other = "travail/essai/issues/03-autre.md"
        self.stage(other, "# 03: autre\n\n**Status:** fait\n")
        with self.assertRaises(check.Failed):
            check.staged()

    def test_le_hook_d_une_fusion_propre_ne_juge_pas_les_tickets_neufs(self):
        # Le hook pre-merge-commit (check.py --staged --merge) ne voit pas MERGE_HEAD : la fusion n'apporte
        # que des tickets commités ailleurs.
        self.stage(NEW, "# 02: essai\n\n**Status:** fait\n\n- [x] critère\n")
        check.staged(merging=True)
        with self.assertRaises(check.Failed):
            check.staged()


class CheckedNotDoneTest(TicketRepo):
    """Un ticket dont toutes les cases sont cochées et dont le statut ne dit pas fait : signalé au pre-commit,
    par un avertissement, jamais par un échec (le point 9 de la procédure fait commiter un ticket hors zone
    sensible cases cochées avant sa revue, son statut au commit suivant)."""

    def setUp(self):
        super().setUp()
        self.addCleanup(check.WARNINGS.clear)
        check.WARNINGS.clear()

    def warnings(self):
        """Les seuls avertissements du ticket tout coché (celui d'une ligne que le relais ne lit pas a ses tests)."""
        check.WARNINGS.clear()
        check.staged()
        return [w for w in check.WARNINGS if "toutes les cases cochées" in w]

    def test_un_ticket_tout_coche_sans_statut_fait_est_signale_sans_echec(self):
        for status in ("**Status:** ready-for-agent", "Status: en cours", "**Statut :** à faire", ""):
            with self.subTest(status=status):
                self.stage(OLD, f"# 01: ancien\n\n{status}\n\n- [x] critère\n  - [x] sous-critère\n")
                self.assertEqual(self.warnings(), [f"{OLD} : toutes les cases cochées : écrire **Status:** fait"])

    def test_un_ticket_sans_case_ou_avec_une_case_ouverte_n_est_pas_signale(self):
        for body in ("Pas de case.\n", "- [x] fait\n- [ ] à faire\n"):
            with self.subTest(body=body):
                self.stage(OLD, f"# 01: ancien\n\n**Status:** ready-for-agent\n\n{body}")
                self.assertEqual(self.warnings(), [])

    def test_une_case_dans_un_bloc_de_code_est_ignoree(self):
        self.stage(OLD, "# 01: ancien\n\n**Status:** ready-for-agent\n\n```\n- [x] exemple\n```\n")
        self.assertEqual(self.warnings(), [])
        self.stage(OLD, "# 01: ancien\n\n**Status:** ready-for-agent\n\n- [x] fait\n```\n- [ ] exemple\n```\n")
        self.assertEqual(self.warnings(), [f"{OLD} : toutes les cases cochées : écrire **Status:** fait"])

    def test_les_statuts_fait_done_retire_et_bloque_ne_sont_pas_signales(self):
        for status in ("**Status:** fait", "Status: done (03/11)", "**Status:** retiré (doublon)", "**Status:** bloqué",
                       "Status: blocked", "**Statut :** Fait", "**Status:** terminé"):
            with self.subTest(status=status):
                self.stage(OLD, f"# 01: ancien\n\n{status}\n\n- [x] critère\n")
                self.assertEqual(self.warnings(), [])

    def test_docs_check_sh_nomme_chaque_statut_qui_ferme_un_ticket_tout_coche(self):
        # La phrase de docs/check-sh.md se compare à la constante : une copie qui diverge échoue ici.
        doc = (Path(__file__).resolve().parents[2] / "docs/check-sh.md").read_text(encoding="utf-8")
        line = next(l for l in doc.split("\n") if "dont toutes les cases hors bloc de code sont cochées" in l)
        named = set(re.findall(r"ni (\w+)", line))
        self.assertEqual(named, check.CHECKED_STATUS_OK)

    def test_un_ticket_du_meme_dossier_non_indexe_est_aussi_signale(self):
        # Le ticket commité tout coché, puis un autre ticket du même dossier indexé.
        self.write(OLD, "# 01: ancien\n\n**Status:** ready-for-agent\n\n- [x] critère\n")
        git(self.repo, "add", OLD)
        git(self.repo, "commit", "-q", "-m", "ancien coché")
        self.stage(NEW, "# 02: nouveau\n\n**Status:** ready-for-agent\n\n- [ ] critère\n")
        self.assertEqual(self.warnings(), [f"{OLD} : toutes les cases cochées : écrire **Status:** fait"])
        # Un ticket d'un autre dossier ne l'est pas.
        other = "travail/autre/issues/01-autre.md"
        self.stage(other, "# 01: autre\n\n**Status:** ready-for-agent\n\n- [ ] critère\n")
        git(self.repo, "reset", "-q", "--", NEW)
        self.assertEqual(self.warnings(), [])

    def test_le_signal_s_imprime_en_avertissement_apres_le_verdict(self):
        self.stage(OLD, "# 01: ancien\n\n**Status:** ready-for-agent\n\n- [x] critère\n")
        check.staged()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            check.report_warnings()
        self.assertIn(f"AVERTISSEMENT : {OLD} : toutes les cases cochées : écrire **Status:** fait", out.getvalue())


class StatusVocabularyTest(TicketRepo):
    """La ligne `Status:` d'un ticket indexé : une valeur hors du vocabulaire est refusée au pre-commit ; le
    vocabulaire est celui du relais de flow-board (`TICKET_STATUS_VOCABULARY` de `relay.ts`)."""

    ADMITTED = ("en cours", "en attente (porteur)", "doing", "in progress", "in-progress", "in_progress", "fait",
                "done", "terminé", "fait (03/11/2026)", "bloqué", "blocked", "bloqué : bute après trois approches",
                "ready-for-agent", "à faire", "todo", "ready", "retiré", "retiré (doublon)", "Fait", "In-Progress")
    REFUSED = ("en revue", "in review", "faite", "terminée", "bloquée", "readyish", "à voir", "encours", "wip", "")

    def test_chaque_valeur_du_vocabulaire_passe(self):
        for value in self.ADMITTED:
            for marker in ("**Status:**", "Status:", "**Statut :**", "Statut :"):
                with self.subTest(value=value, marker=marker):
                    self.stage(OLD, f"# 01: ancien\n\n{marker} {value}\n\n- [ ] critère\n")
                    self.assertEqual(check.unknown_statuses([OLD]), [])
                    check.staged()

    def test_une_valeur_hors_vocabulaire_est_refusee_avec_la_valeur_et_le_vocabulaire(self):
        for value in self.REFUSED:
            with self.subTest(value=value):
                self.stage(OLD, f"# 01: ancien\n\n**Status:** {value}\n\n- [ ] critère\n")
                problems = check.unknown_statuses([OLD])
                self.assertEqual(len(problems), 1)
                self.assertIn(f"{OLD}:3", problems[0])
                self.assertIn(f"« {value} »", problems[0])
                self.assertIn("en cours, en attente, doing", problems[0])
                with self.assertRaises(check.Failed):
                    check.staged()

    def test_une_ligne_absente_ou_dans_un_bloc_de_code_passe(self):
        self.stage(OLD, "# 01: ancien\n\nPas de statut.\n\n- [ ] critère\n")
        self.assertEqual(check.unknown_statuses([OLD]), [])
        self.stage(OLD, "# 01: ancien\n\n```\nStatus: wip\n```\n**Status:** en cours\n")
        self.assertEqual(check.unknown_statuses([OLD]), [])
        check.staged()

    def test_le_vocabulaire_est_celui_du_relais(self):
        source = (Path(__file__).resolve().parents[2] / "plugins/flow-board/hooks/relay.ts").read_text(encoding="utf-8")
        block = re.search(r"export const TICKET_STATUS_VOCABULARY[^=]*= \[(.*?)\n\]", source, re.S)
        self.assertIsNotNone(block, "relay.ts ne déclare plus TICKET_STATUS_VOCABULARY")
        pairs = re.findall(r"\['([^']+)', (?:'(\w+)'|null)\]", block.group(1))
        # Chaque entrée du bloc est lue : une entrée écrite autrement ne passe pas en silence.
        self.assertEqual(block.group(1).count("["), len(pairs), "une entrée du vocabulaire du relais n'est pas lue")
        self.assertEqual([(value, status or None) for value, status in pairs], list(check.STATUS_VOCABULARY.items()))

    def test_le_document_du_tracker_donne_le_vocabulaire_entier(self):
        doc = (Path(__file__).resolve().parents[2] / "docs/agents/issue-tracker.md").read_text(encoding="utf-8")
        line = next(l for l in doc.split("\n") if "Le vocabulaire entier" in l)
        named = re.search(r"Le vocabulaire entier[^:]*: (.*?)\. La valeur", line).group(1)
        values = [v.strip() for part in re.split(r" ; ", named) for v in re.sub(r" \([^)]*\)$", "", part).split(",")]
        self.assertEqual(values, list(check.STATUS_VOCABULARY))

    def test_la_procedure_dicte_l_envoi_que_rejoue_le_test_du_mod(self):
        # L'envoi « en cours » de la procédure d'un worker est rejoué contre le modèle dans lots-sessions-liees.test.ts.
        root = Path(__file__).resolve().parents[2] / "plugins/flow-board"
        procedure = (root / "reference/procedure-groupe.md").read_text(encoding="utf-8")
        replay = (root / "tests/lots-sessions-liees.test.ts").read_text(encoding="utf-8")
        sent = re.search(r"const PROCEDURE_SET = '([^']+)'", replay)
        self.assertIsNotNone(sent, "lots-sessions-liees.test.ts ne rejoue plus l'envoi de la procédure")
        self.assertIn(f"`{sent.group(1)}`", procedure)
        self.assertIn("`**Status:** en cours`", procedure)

    def test_une_ligne_que_le_relais_ne_lit_pas_est_signalee_sans_echec(self):
        # Le relais ne lit ni `Status:` sans gras ni `**Status :**`, et lit un exemple d'un bloc de code plus haut.
        for text, read in (("**Status:** en cours\n", None),
                           ("**Statut :** en cours\n", None),
                           ("Statut : en cours\n", None),
                           ("Status: in-progress\n", "il n'en lit aucune"),
                           ("**Status :** fait\n", "il n'en lit aucune"),
                           ("```\n**Status:** wip\n```\n**Status:** fait\n", "il lit la ligne 4, « wip »")):
            with self.subTest(text=text):
                self.stage(OLD, f"# 01: ancien\n\n{text}\n- [ ] critère\n")
                check.WARNINGS.clear()
                check.staged()
                unread = [w for w in check.WARNINGS if "le relais de flow-board ne lit pas" in w]
                if read is None:
                    self.assertEqual(unread, [])
                else:
                    self.assertEqual(len(unread), 1)
                    self.assertIn(read, unread[0])
                    self.assertIn("écrire « **Status:** ", unread[0])
        self.addCleanup(check.WARNINGS.clear)

    def test_la_ligne_du_relais_est_lue_par_le_meme_motif(self):
        source = (Path(__file__).resolve().parents[2] / "plugins/flow-board/hooks/relay.ts").read_text(encoding="utf-8")
        self.assertIn(f"/{check.RELAY_STATUS_LINE.pattern}/im.exec(text)", source)

    def test_a_la_fusion_une_valeur_deja_portee_par_la_branche_fusionnee_passe(self):
        git(self.repo, "checkout", "-q", "-b", "groupe")
        self.write(NEW, "# 02: essai\n\n**Status:** wip\n")
        git(self.repo, "add", NEW)
        git(self.repo, "commit", "-q", "-m", "ticket du groupe d'avant le contrôle")
        git(self.repo, "checkout", "-q", "main")
        check.staged(merging=True)  # le hook d'une fusion propre ne juge pas ce point
        git(self.repo, "merge", "-q", "--no-ff", "--no-commit", "groupe")
        self.assertEqual(check.unknown_statuses([NEW]), [])
        check.staged()
        other = "travail/essai/issues/03-autre.md"
        self.stage(other, "# 03: autre\n\n**Status:** wip\n")
        with self.assertRaises(check.Failed):
            check.staged()


if __name__ == "__main__":
    unittest.main()
