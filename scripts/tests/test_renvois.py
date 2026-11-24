"""Tests de scripts/renvois.py (les renvois `chemin:ligne` d'une spec ou d'un ticket) :
python3 -m unittest discover -s scripts/tests."""

import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import renvois  # noqa: E402
import test_check_snapshot  # noqa: E402  (le lecteur du corpus hostile commun)

CODE = "\n".join(["# en-tête", "", "def premier():", "    pass", "", "", "", "", "", "", "def second():", "    pass"]) + "\n"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Depot(unittest.TestCase):
    """Un dépôt d'essai : `src/code.py` (12 lignes, `premier` ligne 3, `second` ligne 11) suivi, un fichier
    non suivi, un fichier hors du dépôt ; un ticket écrit hors du dépôt. Sans test à lui."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name).resolve()
        self.repo = base / "depot"
        self.repo.mkdir()
        self.outside = base / "dehors.py"
        self.outside.write_text("def premier():\n    pass\n", encoding="utf-8")
        git(self.repo, "init", "-q", "-b", "main")
        (self.repo / "src").mkdir()
        (self.repo / "src/code.py").write_text(CODE, encoding="utf-8")
        git(self.repo, "add", "src/code.py")
        (self.repo / "src/libre.py").write_text(CODE, encoding="utf-8")
        self.ticket = base / "ticket.md"

    def tearDown(self):
        self.dir.cleanup()

    def run_on(self, text):
        self.ticket.write_text(text, encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = renvois.main([str(self.ticket)], root=self.repo)
        return code, out.getvalue()

    def assert_refused(self, ref, reason):
        """Le renvoi est refusé pour cette raison, sans échec, et aucun fichier cité n'est ouvert."""
        with mock.patch.object(renvois, "read_cited", wraps=renvois.read_cited) as read:
            code, out = self.run_on(f"La fonction `premier` (`{ref}`).\n")
        self.assertEqual(code, 0, out)
        self.assertIn(f"refusé, non lu ({reason})", out)
        self.assertIn("1 refusé(s) non lu(s)", out)
        self.assertEqual(read.call_args_list, [], "un chemin refusé n'est jamais ouvert")


class RenvoisTest(Depot):
    def test_un_nom_a_trois_lignes_au_plus_est_juste(self):
        for line in (3, 1, 6):
            with self.subTest(line=line):
                code, out = self.run_on(f"La fonction `premier` (`src/code.py:{line}`) lit le ticket.\n")
                self.assertEqual(code, 0, out)
                self.assertIn("0 renvoi(s) faux, 0 refusé(s) non lu(s), sur 1 relu(s)", out)

    def test_un_bloc_de_code_n_est_pas_relu(self):
        # Une sortie de grep citée dans un bloc garde ses anciens numéros : ni faux renvoi, ni fin de paragraphe ratée.
        text = ("Recherche :\n```\nsrc/code.py:40:    second()\n~~~\nsrc/code.py:3:second\n```\n"
                "~~~\nsrc/code.py:13\n~~~\nLa fonction `premier` (`src/code.py:3`).\n")
        code, out = self.run_on(text)
        self.assertEqual(code, 0, out)
        self.assertIn("0 renvoi(s) faux, 0 refusé(s) non lu(s), sur 1 relu(s)", out)

    def test_une_plage_compte_entiere(self):
        code, out = self.run_on("Les deux, `second` : `src/code.py:3-9`.\n")
        self.assertEqual(code, 0, out)

    def test_un_nom_present_ailleurs_est_decale(self):
        code, out = self.run_on("La fonction `second` (`src/code.py:3`) lit le ticket.\n")
        self.assertEqual(code, 1)
        self.assertIn("ticket.md:1 : `src/code.py:3` : décalé : second est ligne 11", out)

    def test_un_nom_absent_est_absent(self):
        code, out = self.run_on("La fonction `troisieme` (`src/code.py:3`) lit le ticket.\n")
        self.assertEqual(code, 1)
        self.assertIn("absent : troisieme n'est pas dans src/code.py", out)

    def test_une_ligne_au_dela_de_la_fin_est_hors_fichier(self):
        for ref in ("src/code.py:13", "src/code.py:10-40"):
            with self.subTest(ref=ref):
                code, out = self.run_on(f"Voir `{ref}`.\n")
                self.assertEqual(code, 1)
                self.assertIn("hors fichier (src/code.py a 12 lignes)", out)

    def test_sans_nom_juste_si_la_ligne_existe(self):
        code, out = self.run_on("Voir `src/code.py:12`, et `relay.ts` ailleurs.\n")
        self.assertEqual(code, 0, out)

    def test_le_nom_le_plus_proche_dans_la_meme_phrase(self):
        # `second` est dans la phrase d'avant : seul `premier`, de la phrase du renvoi, compte.
        code, out = self.run_on("On appelle `second`. Puis `premier` (`src/code.py:3`).\n")
        self.assertEqual(code, 0, out)
        code, out = self.run_on("Ici `premier`, puis `second` : `src/code.py:3`.\n")
        self.assertIn("décalé : second est ligne 11", out)

    def test_un_nom_apres_le_renvoi_se_mesure_depuis_sa_fin(self):
        # `second` est à 17 signes avant le renvoi, `premier` à 11 après lui : `premier` est le plus proche.
        code, out = self.run_on("Le nom `second` puis le renvoi `src/code.py:3` qui cite `premier`.\n")
        self.assertEqual(code, 0, out)

    def test_un_nom_qualifie_se_cherche_par_son_dernier_membre(self):
        code, out = self.run_on("Le membre `Code.premier` (`src/code.py:3`).\n")
        self.assertEqual(code, 0, out)
        code, out = self.run_on("Le membre `Code.second` (`src/code.py:3`).\n")
        self.assertIn("décalé : second est ligne 11", out)

    def test_un_chemin_sans_extension_est_un_renvoi(self):
        (self.repo / "src/sans-extension").write_text(CODE, encoding="utf-8")
        git(self.repo, "add", "src/sans-extension")
        code, out = self.run_on("La fonction `second` (`src/sans-extension:3`). Ici ligne:3 n'en est pas un.\n")
        self.assertEqual(code, 1)
        self.assertIn("`src/sans-extension:3` : décalé : second est ligne 11", out)
        self.assertIn("sur 1 relu(s)", out)

    def test_une_plage_inversee_hors_du_fichier_est_hors_fichier(self):
        code, out = self.run_on("Plage inversée `src/code.py:40-3`.\n")
        self.assertEqual(code, 1)
        self.assertIn("hors fichier (src/code.py a 12 lignes)", out)

    def test_a_egalite_le_nom_d_avant(self):
        # `premier` et `second` à deux signes du renvoi, de part et d'autre : celui d'avant compte.
        code, out = self.run_on("`premier` `src/code.py:3` `second`\n")
        self.assertEqual(code, 0, out)
        code, out = self.run_on("`second` `src/code.py:3` `premier`\n")
        self.assertIn("décalé : second est ligne 11", out)

    def test_la_phrase_se_coupe_apres_un_point_virgule_mais_pas_apres_une_abreviation(self):
        code, out = self.run_on("On lit `second` ; puis `src/code.py:3`.\n")
        self.assertEqual(code, 0, out)
        for text in ("La fonction `premier` (cf. `src/code.py:11`).\n", "La fonction `premier`, p. ex. `src/code.py:11`.\n"):
            with self.subTest(text=text):
                code, out = self.run_on(text)
                self.assertIn("décalé : premier est ligne 3", out)
        # Une lettre seule en fin de phrase (« le groupe G. ») clôt la phrase.
        code, out = self.run_on("La fonction `premier` vit dans le groupe G. Le renvoi suivant vaut `src/code.py:11`.\n")
        self.assertEqual(code, 0, out)

    def test_tableau_puces_et_titre_ne_forment_pas_une_phrase(self):
        for text in ("| La fonction d'entrée | `src/code.py:3` |\n| `second` est défini | `src/code.py:11` |\n",
                     "- La première fonction : `src/code.py:3`\n- `second` vient après\n",
                     "## `premier`\nLe renvoi `src/code.py:11` du bas.\n",
                     "1. La première : `src/code.py:3`\n2. `second` ensuite\n"):
            with self.subTest(text=text):
                code, out = self.run_on(text)
                self.assertEqual(code, 0, out)

    def test_un_membre_qui_ressemble_a_une_extension_reste_un_nom(self):
        code, out = self.run_on("La valeur `self.cfg` (`src/code.py:3`).\n")
        self.assertEqual(code, 1)
        self.assertIn("absent : cfg n'est pas dans src/code.py", out)

    def test_un_chemin_windows_absolu_est_refuse(self):
        code, out = self.run_on("Voir C:/Users/x/a.py:3 et C:\\x\\a.py:3.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("2 refusé(s) non lu(s), sur 2 relu(s)", out)
        self.assertIn("refusé, non lu (chemin absolu)", out)

    def test_une_phrase_sur_deux_lignes_garde_son_nom_et_le_renvoi_sa_ligne(self):
        code, out = self.run_on("Titre.\n\nLa fonction `premier`\n(`src/code.py:11`).\n")
        self.assertEqual(code, 1)
        self.assertIn("ticket.md:4 : `src/code.py:11` : décalé : premier est ligne 3", out)
        # Une ligne vide clôt le paragraphe : le nom d'avant ne passe pas.
        code, out = self.run_on("La fonction `premier`\n\n(`src/code.py:11`).\n")
        self.assertEqual(code, 0, out)

    def test_le_chemin_entre_accents_graves_et_la_ligne_dehors(self):
        code, out = self.run_on("`src/code.py`:11 pour `premier`.\n")
        self.assertEqual(code, 1)
        self.assertIn("décalé : premier est ligne 3", out)

    def test_l_hote_d_une_adresse_n_est_pas_un_renvoi(self):
        code, out = self.run_on("Voir https://example.com:8080 et `premier` `src/code.py:3`.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("0 refusé(s) non lu(s), sur 1 relu(s)", out)

    def test_un_fichier_illisible_n_empeche_pas_les_autres(self):
        self.ticket.write_text("La fonction `second` (`src/code.py:3`).\n", encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = renvois.main([str(self.ticket), str(self.repo / "absent.md")], root=self.repo)
        self.assertEqual(code, 2)
        self.assertIn("décalé : second est ligne 11", out.getvalue())
        self.assertIn("absent.md illisible", out.getvalue())

    def test_corpus_hostile_commun_jamais_ouvert(self):
        # Le garde des chemins cités (classe « chemin ») : aucun chemin qui porte une entrée du corpus n'est
        # ouvert, sosie de `src/code.py` compris.
        entries = test_check_snapshot.SnapshotTicketFormTest.corpus()
        self.assertGreater(len(entries), 60)
        known = renvois.tracked(self.repo)
        opened = [name for name, token in entries.items()
                  for path in (f"src/code{token}.py", f"src/{token}/code.py", f"{token}src/code.py")
                  if renvois.admitted(path, self.repo, known)[0] is not None]
        self.assertEqual(opened, [])
        self.assertIsNotNone(renvois.admitted("src/code.py", self.repo, known)[0])

    def test_chemins_refuses_non_lus(self):
        cases = {
            f"{self.repo}/src/code.py:3": "chemin absolu",
            "../dehors.py:1": "segment « .. »",
            "src/../src/code.py:3": "segment « .. »",
            "src/libre.py:3": "non suivi par git",
            "~/x.py:1": "chemin absolu",
        }
        for ref, reason in cases.items():
            with self.subTest(ref=ref):
                self.assert_refused(ref, reason)

    def test_un_chemin_refuse_n_est_passe_a_aucune_commande(self):
        calls = []
        real = subprocess.run

        def spy(args, **kw):
            calls.append(list(args))
            return real(args, **kw)

        with mock.patch.object(renvois.subprocess, "run", spy):
            self.run_on("`premier` (`../dehors.py:1`), `src/code.py:3`, `; rm -rf x.py:1`.\n")
        self.assertEqual(calls, [["git", "ls-files", "-z"]])

    def test_n_ecrit_rien(self):
        before = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        self.run_on("`second` (`src/code.py:3`).\n")
        after = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        self.assertEqual(before, after)

    def test_un_fichier_nomme_se_lit_tel_quel_suivi_ou_non(self):
        # Le ticket est hors du dépôt : il se lit quand même.
        code, out = self.run_on("`premier` : `src/code.py:3`.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("sur 1 relu(s)", out)


DECISIONS = """# Décisions — essai

## Décisions en vigueur

- Série 1 — la base.

## Série 1 — La base (20/11/2026)

S10 : le compte rendu attend. INV-09 et FERM-0 tiennent : « elle n'emploie jamais `git branch -D`
ni `--force` ».

## Série 2 — La suite (20/11/2026)

Q9 : « la reprise « de nuit » refuse ce cas ».
"""
CITED = "travail/essai/DECISIONS.md"


class CitationsTest(Depot):
    """Les citations « <id> de `<chemin>/DECISIONS.md` » et « série <n> de `<chemin>/DECISIONS.md` »."""

    def setUp(self):
        super().setUp()
        (self.repo / "travail/essai").mkdir(parents=True)
        (self.repo / CITED).write_text(DECISIONS, encoding="utf-8")
        git(self.repo, "add", CITED)

    def test_une_citation_juste_passe_et_se_compte_a_part(self):
        text = (f"La série 2 de `{CITED}` et S10 de `{CITED}`, puis `INV-09` de `{CITED}` et FERM-0 de "
                f"`{CITED}`.\nSérie 1 de `{CITED}` aussi.\n")
        code, out = self.run_on(text)
        self.assertEqual(code, 0, out)
        self.assertIn("0 citation(s) de décisions fausse(s), 0 refusée(s) non lue(s), sur 5 relue(s)", out)
        self.assertIn("0 renvoi(s) faux, 0 refusé(s) non lu(s), sur 0 relu(s)", out)

    def test_une_serie_ou_un_id_absents_echouent(self):
        for cited, said in ((f"série 3 de `{CITED}`", f"absent : série 3 n'est pas dans {CITED}"),
                            (f"S1 de `{CITED}`", f"absent : S1 n'est pas dans {CITED}"),
                            (f"INV-0 de `{CITED}`", f"absent : INV-0 n'est pas dans {CITED}")):
            with self.subTest(cited=cited):
                code, out = self.run_on(f"Voir {cited}.\n")
                self.assertEqual(code, 1, out)
                self.assertIn(f"ticket.md:1 : « {cited} » : {said}", out)
                self.assertIn("1 citation(s) de décisions fausse(s)", out)

    def test_sans_chemin_entre_accents_graves_rien_n_est_controle(self):
        text = (f"S99 de {CITED}, série 9 de `DECISIONS.md`, Une de `{CITED}`, README de `{CITED}`, "
                f"la série 9 (`{CITED}`).\n")
        code, out = self.run_on(text)
        self.assertEqual(code, 0, out)
        self.assertIn("sur 0 relue(s)", out)

    def test_une_phrase_citee_se_trouve_mot_pour_mot_dans_la_serie(self):
        # Blancs réduits, retour à la ligne compris ; guillemets imbriqués gardés entiers.
        ok = (f"La série 1 de `{CITED}` : « elle n'emploie jamais `git branch -D` ni\n`--force` ».\n"
              f"Et Q9 de `{CITED}` : « la reprise « de nuit » refuse ce cas ».\n")
        code, out = self.run_on(ok)
        self.assertEqual(code, 0, out)
        self.assertIn("sur 2 relue(s)", out)
        # La phrase est dans le fichier, mais pas dans la série citée.
        code, out = self.run_on(f"La série 2 de `{CITED}` : « elle n'emploie jamais `git branch -D` ».\n")
        self.assertEqual(code, 1, out)
        self.assertIn(f"citation absente : « elle n'emploie jamais `git branch -D` » n'est pas dans la série 2 de {CITED}", out)
        code, out = self.run_on(f"S10 de `{CITED}` : « le compte rendu part ».\n")
        self.assertEqual(code, 1, out)
        self.assertIn(f"citation absente : « le compte rendu part » n'est pas dans {CITED}", out)

    def test_une_phrase_qui_ne_suit_pas_directement_n_est_pas_jugee(self):
        code, out = self.run_on(f"La série 2 de `{CITED}` dit ailleurs : « rien de tel ».\n")
        self.assertEqual(code, 0, out)

    def test_une_citation_dans_un_bloc_de_code_n_est_pas_relue(self):
        code, out = self.run_on(f"```\nsérie 9 de `{CITED}`\n```\n")
        self.assertEqual(code, 0, out)
        self.assertIn("sur 0 relue(s)", out)

    def test_un_fichier_de_decisions_refuse_n_est_pas_ouvert(self):
        (self.repo / "travail/libre").mkdir()
        (self.repo / "travail/libre/DECISIONS.md").write_text(DECISIONS, encoding="utf-8")
        cases = {"travail/libre/DECISIONS.md": "non suivi par git",
                 "travail/../travail/essai/DECISIONS.md": "segment « .. »",
                 "~/travail/DECISIONS.md": "chemin absolu",
                 f"{self.repo}/{CITED}": "chemin absolu",
                 "C:/x/DECISIONS.md": "chemin absolu",
                 "C:\\x\\DECISIONS.md": "chemin absolu"}
        for path, reason in cases.items():
            with self.subTest(path=path):
                with mock.patch.object(renvois, "read_cited", wraps=renvois.read_cited) as read:
                    code, out = self.run_on(f"La série 1 de `{path}`.\n")
                self.assertEqual(code, 0, out)
                self.assertIn(f"refusé, non lu ({reason})", out)
                self.assertIn("0 citation(s) de décisions fausse(s), 1 refusée(s) non lue(s), sur 1 relue(s)", out)
                self.assertEqual(read.call_args_list, [], "un fichier de décisions refusé n'est jamais ouvert")

    def test_le_chemin_d_une_citation_n_est_passe_a_aucune_commande(self):
        calls = []
        real = subprocess.run

        def spy(args, **kw):
            calls.append(list(args))
            return real(args, **kw)

        with mock.patch.object(renvois.subprocess, "run", spy):
            self.run_on(f"La série 1 de `{CITED}`, S10 de `x;rm -rf y/DECISIONS.md` et série 4 de `../a/DECISIONS.md`.\n")
        self.assertEqual(calls, [["git", "ls-files", "-z"]])

    def test_n_ecrit_rien(self):
        before = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        self.run_on(f"La série 3 de `{CITED}` : « rien ». S10 de `{CITED}`.\n")
        after = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        self.assertEqual(before, after)

    def test_les_lignes_d_une_citation_vont_jusqu_a_la_fin_de_sa_phrase_citee(self):
        text = f"Titre.\n\nLa série 1\nde `{CITED}` : « rien\nde tel ».\n"
        wrong, _, _ = renvois.check_citations(text, "t.md", self.repo, renvois.tracked(self.repo), {})
        self.assertEqual([(first, last) for first, last, _, _ in wrong], [(3, 5)])


class FixTest(Depot):
    """`--fix` : le numéro d'un renvoi « décalé » réécrit quand son nom est une déclaration de premier niveau
    unique du fichier cité, dans un ticket suivi par git du dépôt d'essai."""

    def setUp(self):
        super().setUp()
        self.named = self.repo / "travail/t.md"
        self.named.parent.mkdir()

    def fix(self, text, *flags, track=True, raw=None):
        self.named.write_bytes(raw if raw is not None else text.encode("utf-8"))
        if track:
            git(self.repo, "add", "travail/t.md")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = renvois.main(["--fix", *flags, str(self.named)], root=self.repo)
        return code, out.getvalue()

    def test_le_numero_d_un_renvoi_decale_est_reecrit_et_rien_d_autre(self):
        raw = "Titre.\r\n\r\nLa fonction `second` (`src/code.py:3`), voir aussi.\r\nFin  \r\n".encode("utf-8")
        code, out = self.fix(None, raw=raw)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.named.read_bytes(), raw.replace(b"code.py:3`", b"code.py:11`"))
        self.assertIn("corrigé : travail/", out.replace(str(self.repo) + "/", ""))
        self.assertIn("décalé : second est ligne 11 → 11", out)
        self.assertIn("0 renvoi(s) faux", out)
        self.assertIn("1 renvoi(s) corrigé(s), 0 laissé(s), 0 fichier(s) non écrit(s)", out)
        # Relancé sur le fichier corrigé : rien ne change.
        code, out = self.fix(None, raw=self.named.read_bytes())
        self.assertEqual(code, 0, out)
        self.assertEqual(self.named.read_bytes(), raw.replace(b"code.py:3`", b"code.py:11`"))
        self.assertIn("0 renvoi(s) corrigé(s)", out)

    def test_une_plage_garde_sa_longueur(self):
        code, out = self.fix("Les deux, `second` : `src/code.py:2-3`.\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), "Les deux, `second` : `src/code.py:11-12`.\n")

    def test_une_declaration_typescript_se_lit_aussi(self):
        (self.repo / "src/mod.ts").write_text("const a = 1\n\n\n\n\nexport function cible() {}\n", encoding="utf-8")
        git(self.repo, "add", "src/mod.ts")
        code, out = self.fix("La fonction `cible` (`src/mod.ts:1`).\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), "La fonction `cible` (`src/mod.ts:6`).\n")

    def test_ce_qui_n_est_pas_une_declaration_unique_est_laisse_avec_sa_raison(self):
        (self.repo / "src/double.py").write_text("def f():\n    pass\n" + "\n" * 8 + "def f():\n    pass\n", encoding="utf-8")
        git(self.repo, "add", "src/double.py")
        text = ("Le mot `pass` (`src/code.py:8`). La fonction `f` (`src/double.py:6`). "
                "La fonction `troisieme` (`src/code.py:3`). Voir `src/code.py:40`. "
                "La fonction `second` (`src/code.py:3`). Refusé `../dehors.py:1`.\n")
        code, out = self.fix(text)
        self.assertEqual(code, 1, out)
        self.assertIn("(pass n'est pas une déclaration de premier niveau)", out)
        self.assertIn("(f est déclaré 2 fois au premier niveau)", out)
        self.assertIn("laissé : ", out)
        self.assertIn("absent : troisieme n'est pas dans src/code.py", out)
        self.assertIn("hors fichier (src/code.py a 12 lignes)", out)
        self.assertIn("refusé, non lu (segment « .. »)", out)
        self.assertIn("4 renvoi(s) faux", out)
        self.assertIn("1 renvoi(s) corrigé(s), 4 laissé(s)", out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), text.replace("`second` (`src/code.py:3`)", "`second` (`src/code.py:11`)"))

    def test_un_nom_qualifie_ou_une_phrase_a_deux_declarations_est_laisse(self):
        (self.repo / "src/membre.py").write_text("class Store:\n    def save(self):\n        pass\n" + "\n" * 8
                                                + "def save():\n    pass\n", encoding="utf-8")
        git(self.repo, "add", "src/membre.py")
        text = ("La méthode `Store.save` (`src/membre.py:6`). "
                "La fonction `premier` appelle `second` (`src/code.py:7`).\n")
        code, out = self.fix(text)
        self.assertEqual(code, 1, out)
        self.assertIn("(nom qualifié : Store.save n'est pas une déclaration de premier niveau)", out)
        self.assertIn("(la phrase nomme aussi premier, déclaré dans le fichier cité : le renvoi visait peut-être lui)", out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), text)

    def test_deux_renvois_d_une_phrase_chacun_a_son_nom_sont_reecrits(self):
        text = "La fonction `premier` (`src/code.py:8`) appelle `second` (`src/code.py:1`).\n"
        code, out = self.fix(text)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.named.read_text(encoding="utf-8"),
                         "La fonction `premier` (`src/code.py:3`) appelle `second` (`src/code.py:11`).\n")

    def test_une_plage_qui_sortirait_du_fichier_est_laissee(self):
        code, out = self.fix("Les deux, `second` : `src/code.py:3-6`.\n")
        self.assertEqual(code, 1, out)
        self.assertIn("(la plage décalée sortirait du fichier (12 lignes))", out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), "Les deux, `second` : `src/code.py:3-6`.\n")

    def test_essai_montre_sans_rien_ecrire(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        code, out = self.fix(text, "--essai")
        self.assertEqual(code, 1, out)
        self.assertIn("corrigerait : ", out)
        self.assertIn("1 renvoi(s) à corriger (essai, rien écrit)", out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), text)

    def test_essai_sur_un_fichier_non_suivi_n_annonce_aucune_correction(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        code, out = self.fix(text, "--essai", track=False)
        self.assertEqual(code, 1, out)
        self.assertNotIn("corrigerait", out)
        self.assertIn("(non suivi par git)", out)
        self.assertIn("0 renvoi(s) à corriger (essai, rien écrit), 1 laissé(s), 1 fichier(s) non écrit(s)", out)

    def test_un_retour_chariot_seul_reste_une_fin_de_ligne_et_rien_n_est_ecrit(self):
        raw = "Titre.\r\rLa fonction `second` (`src/code.py:3`).\r".encode("utf-8")
        code, out = self.fix(None, raw=raw)
        self.assertEqual(code, 1, out)
        self.assertIn("t.md:3 : `src/code.py:3` : décalé : second est ligne 11", out)
        self.assertIn("(retour chariot seul en fin de ligne)", out)
        self.assertEqual(self.named.read_bytes(), raw)

    def test_les_droits_du_fichier_reecrit_sont_gardes(self):
        self.named.write_text("x", encoding="utf-8")
        os.chmod(self.named, 0o640)
        code, out = self.fix("La fonction `second` (`src/code.py:3`).\n")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.named.stat().st_mode & 0o777, 0o640)

    def test_lance_isole_le_fix_trouve_ses_modules(self):
        # Le script et ses modules copiés dans le dépôt d'essai, qui devient sa racine.
        (self.repo / "scripts").mkdir()
        for name in ("renvois.py", "show.py", "deplace.py"):
            shutil.copy(Path(renvois.__file__).resolve().parent / name, self.repo / "scripts" / name)
        self.named.write_text("La fonction `second` (`src/code.py:3`).\n", encoding="utf-8")
        git(self.repo, "add", "travail/t.md")
        res = subprocess.run([sys.executable, "-I", "scripts/renvois.py", "--fix", "travail/t.md"], cwd=self.repo,
                             capture_output=True, text=True, timeout=60)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertEqual(self.named.read_text(encoding="utf-8"), "La fonction `second` (`src/code.py:11`).\n")

    def test_un_lecteur_de_declarations_qui_deraille_laisse_le_renvoi(self):
        import show

        with mock.patch.object(show, "py_declarations", side_effect=RuntimeError("lecture cassée")):
            code, out = self.fix("La fonction `second` (`src/code.py:3`).\n")
        self.assertEqual(code, 1, out)
        self.assertIn("(déclarations illisibles : lecture cassée)", out)

    def test_essai_sans_fix_est_refuse(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(renvois.main(["--essai", str(self.ticket)], root=self.repo), 2)
        self.assertIn("Usage", out.getvalue())

    def test_un_fichier_non_suivi_n_est_pas_ecrit(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        code, out = self.fix(text, track=False)
        self.assertEqual(code, 1, out)
        self.assertIn("(non suivi par git)", out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), text)
        # Hors du dépôt : le ticket d'essai de `Depot`.
        self.ticket.write_text(text, encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(renvois.main(["--fix", str(self.ticket)], root=self.repo), 1)
        self.assertIn("(hors du dépôt)", out.getvalue())
        self.assertEqual(self.ticket.read_text(encoding="utf-8"), text)

    def test_un_fichier_change_pendant_le_passage_n_est_pas_ecrit(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        real = renvois.check_text

        def then_changed(*args, **kw):
            found = real(*args, **kw)
            self.named.write_text(text + "Ajout d'une autre discussion.\n", encoding="utf-8")
            return found

        with mock.patch.object(renvois, "check_text", then_changed):
            code, out = self.fix(text)
        self.assertEqual(code, 1, out)
        self.assertIn("(changé pendant le passage)", out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), text + "Ajout d'une autre discussion.\n")

    def test_une_ecriture_ratee_laisse_le_fichier_d_avant(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        with mock.patch.object(renvois.os, "replace", side_effect=OSError(28, "No space left on device")):
            code, out = self.fix(text)
        self.assertEqual(code, 1, out)
        self.assertIn("(écriture ratée : No space left on device)", out)
        self.assertEqual(self.named.read_text(encoding="utf-8"), text)
        self.assertEqual(sorted(p.name for p in self.named.parent.iterdir()), ["t.md"], "aucun fichier voisin laissé")

    def test_sans_fix_rien_n_est_ecrit_meme_un_renvoi_corrigeable(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        self.named.write_text(text, encoding="utf-8")
        git(self.repo, "add", "travail/t.md")
        before = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(renvois.main([str(self.named)], root=self.repo), 1)
        after = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        self.assertEqual(before, after)

    def test_le_fix_ne_passe_aucun_texte_a_une_commande(self):
        calls = []
        real = subprocess.run

        def spy(args, **kw):
            calls.append(list(args))
            return real(args, **kw)

        with mock.patch.object(renvois.subprocess, "run", spy):
            self.fix("La fonction `second` (`src/code.py:3`), `; rm -rf x.py:1`.\n")
        # Seul le `git add` du test lui-même précède : le script ne lance que `git ls-files`.
        self.assertEqual([c for c in calls if c[:2] != ["git", "add"]], [["git", "ls-files", "-z"]])


@unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
class FixLienSymboliqueTest(Depot):
    def test_un_lien_symbolique_nomme_n_est_pas_ecrit(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        target = self.repo / "travail/vrai.md"
        target.parent.mkdir()
        target.write_text(text, encoding="utf-8")
        os.symlink(target, self.repo / "travail/lien.md")
        git(self.repo, "add", "travail/vrai.md", "travail/lien.md")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(renvois.main(["--fix", str(self.repo / "travail/lien.md")], root=self.repo), 1)
        self.assertIn("(lien symbolique)", out.getvalue())
        self.assertEqual(target.read_text(encoding="utf-8"), text)

    def test_un_lien_au_dessus_de_la_racine_ne_compte_pas(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        (self.repo / "travail").mkdir()
        (self.repo / "travail/t.md").write_text(text, encoding="utf-8")
        git(self.repo, "add", "travail/t.md")
        os.symlink(self.repo.parent, self.repo.parent / "alias")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = renvois.main(["--fix", str(self.repo.parent / "alias/depot/travail/t.md")], root=self.repo)
        self.assertEqual(code, 0, out.getvalue())
        self.assertEqual((self.repo / "travail/t.md").read_text(encoding="utf-8"), text.replace(":3", ":11"))

    def test_un_chemin_par_un_dossier_lien_symbolique_n_est_pas_ecrit(self):
        text = "La fonction `second` (`src/code.py:3`).\n"
        (self.repo / "travail").mkdir()
        (self.repo / "travail/t.md").write_text(text, encoding="utf-8")
        os.symlink(self.repo / "travail", self.repo / "lien")
        git(self.repo, "add", "travail/t.md", "lien")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(renvois.main(["--fix", str(self.repo / "lien/t.md")], root=self.repo), 1)
        self.assertIn("(chemin qui passe par un lien symbolique)", out.getvalue())
        self.assertEqual((self.repo / "travail/t.md").read_text(encoding="utf-8"), text)


@unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
class LienSymboliqueTest(Depot):
    """Un lien symbolique suivi par git qui vise hors du dépôt, ou un fichier non suivi du dépôt."""

    def test_un_lien_vers_l_exterieur_du_depot_est_refuse(self):
        os.symlink(self.outside, self.repo / "src/lien.py")
        git(self.repo, "add", "src/lien.py")
        self.assert_refused("src/lien.py:1", "hors du dépôt")

    def test_un_lien_vers_un_fichier_non_suivi_du_depot_est_refuse(self):
        os.symlink(self.repo / ".git/config", self.repo / "src/config.py")
        git(self.repo, "add", "src/config.py")
        self.assert_refused("src/config.py:1", "vise un fichier non suivi")


if __name__ == "__main__":
    unittest.main()
