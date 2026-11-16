"""Tests de la remise du modèle par défaut du poste par scripts/sonde.py : la sonde note au lancement la clé
`model` de `~/.claude/settings.json` dans la marque de son dossier jetable, et à la sortie ne la remet que
si la valeur du moment est celle qu'un `/model` de sa propre session y a posée (lu dans son journal,
`classic.PostModelSwitch`). Faux dossier personnel ; python3 -m unittest discover -s scripts/tests."""

import calendar
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sonde  # noqa: E402

SESSION = "0a1b2c3d-1111-2222-3333-444455556666"
# Les autres clés du fichier, dans leur ordre : elles ne bougent jamais.
SETTINGS = {"$schema": "x", "env": {"A": "1"}, "model": "opus", "effortLevel": "high", "permissions": {"allow": []}}
# Le journal de la sonde s'ouvre à cette heure (son nom), et son /model tombe 10 s plus tard.
JOURNAL = "2026-11-16T10-00-00-000Z.jsonl"
SWITCH_T_MS = 10_000
SWITCH_NS = (calendar.timegm((2026, 11, 16, 10, 0, 0, 0, 0, 0)) * 1000 + SWITCH_T_MS) * 1_000_000


def switch(requested, to, source="command", t=SWITCH_T_MS):
    """Une ligne du journal de la sonde pour un `/model` (ticket 13), `t` ms après l'ouverture du journal :
    l'alias demandé n'est pas l'id résolu."""
    entry = {"ev": "classic.PostModelSwitch", "sid": SESSION, "from_model": "claude-opus-5-5",
             "to_model": to, "requested_model": requested, "source": source}
    if t is not None:
        entry["t"] = t
    return json.dumps(entry)


class ModeleTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(os.path.realpath(self.dir.name))
        self.home = base / "claude"
        self.home.mkdir()
        self.settings = self.home / "settings.json"
        self.folder = base / "T" / "sonde-abcd1234"
        (self.folder / "journaux").mkdir(parents=True)
        self.folder.chmod(0o700)

    def tearDown(self):
        self.dir.cleanup()

    def write_settings(self, data, at=SWITCH_NS):
        """Le fichier de réglages, daté à `at` (ns) : par défaut, l'heure du /model de la sonde."""
        self.settings.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.utime(self.settings, ns=(at, at))

    def launch(self, data=SETTINGS):
        """Le lancement : le fichier tel qu'il est, puis la marque qui note la clé."""
        if data is not None:
            self.write_settings(data)
        sonde.mark_launch(self.folder, "/bin/claude", sonde.note_model(self.settings))

    def journal(self, *lines):
        (self.folder / "journaux" / JOURNAL).write_text(
            "\n".join([json.dumps({"ev": "session.start", "sid": SESSION}), *lines]) + "\n", encoding="utf-8")

    def model_now(self):
        return json.loads(self.settings.read_text(encoding="utf-8")).get("model", "<absente>")

    def restore(self, keep=False):
        return "\n".join(sonde.restore_model(self.folder, self.home, keep=keep))

    # Le lancement note la clé, sans toucher au fichier.
    def test_le_lancement_note_la_valeur_l_absence_ou_illisible_sans_toucher_au_fichier(self):
        self.write_settings(SETTINGS)
        before = self.settings.read_bytes()
        self.assertEqual(sonde.note_model(self.settings), {"etat": "valeur", "valeur": "opus"})
        self.assertEqual(self.settings.read_bytes(), before)
        self.write_settings({"env": {}})
        self.assertEqual(sonde.note_model(self.settings), {"etat": "absent"})
        self.settings.write_text("{pas du json", encoding="utf-8")
        self.assertEqual(sonde.note_model(self.settings), {"etat": "illisible"})
        self.write_settings({"model": 3})
        self.assertEqual(sonde.note_model(self.settings), {"etat": "illisible"})
        self.settings.unlink()
        self.assertEqual(sonde.note_model(self.settings), {"etat": "illisible"})
        self.launch()
        marker = json.loads((self.folder / sonde.MARKER).read_text(encoding="utf-8"))
        self.assertEqual(marker["modele"], {"etat": "valeur", "valeur": "opus"})

    def test_valeur_posee_par_la_sonde_remise_les_autres_cles_intactes_et_dans_leur_ordre(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})  # ce qu'a écrit le /model fable de la sonde
        report = self.restore()
        self.assertIn("remis", report)
        self.assertEqual(self.model_now(), "opus")
        text = self.settings.read_text(encoding="utf-8")
        self.assertEqual(text, json.dumps(SETTINGS, ensure_ascii=False, indent=2) + "\n")
        self.assertEqual(list(json.loads(text)), list(SETTINGS))

    def test_la_valeur_posee_peut_etre_l_id_resolu(self):
        self.launch()
        self.journal(switch("claude-fable-5-2", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "claude-fable-5-2"})
        self.restore()
        self.assertEqual(self.model_now(), "opus")

    def test_une_cle_absente_au_lancement_est_retiree(self):
        data = {k: v for k, v in SETTINGS.items() if k != "model"}
        self.launch(data)
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**data, "model": "fable"})
        self.restore()
        self.assertEqual(json.loads(self.settings.read_text(encoding="utf-8")), data)

    def test_valeur_inchangee_rien_n_est_ecrit(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"), switch("opus", "claude-opus-5-5"))
        before = os.stat(self.settings).st_mtime_ns, self.settings.read_bytes()
        self.assertIn("rien à remettre", self.restore())
        self.assertEqual((os.stat(self.settings).st_mtime_ns, self.settings.read_bytes()), before)

    def test_valeur_posee_par_un_autre_rien_n_est_ecrit_et_le_rapport_donne_la_commande(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "sonnet"})  # une autre session, ou sync.py
        report = self.restore()
        self.assertEqual(self.model_now(), "sonnet")
        self.assertIn("opus", report)
        self.assertIn("/model opus", report)
        # Sans aucun /model dans le journal (un changement automatique ne compte pas), de même.
        self.write_settings({**SETTINGS, "model": "fable"})
        (self.folder / sonde.MODEL_DONE).unlink()
        self.journal(switch("fable", "claude-fable-5-2", source="auto"))
        self.restore()
        self.assertEqual(self.model_now(), "fable")

    def test_fichier_absent_ou_illisible_rien_n_est_ecrit(self):
        self.launch(None)  # absent au lancement : noté illisible, jamais d'écriture
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        self.assertIn("rien d'écrit", self.restore())
        self.assertEqual(self.model_now(), "fable")
        self.settings.unlink()
        # Lisible au lancement, illisible à la sortie.
        for broken in ("{pas du json", None):
            with self.subTest(broken=broken):
                for name in (sonde.MARKER, sonde.MODEL_DONE):
                    path = self.folder / name
                    if path.exists():
                        path.unlink()
                self.launch()
                if broken is None:
                    self.settings.unlink()
                else:
                    self.settings.write_text(broken, encoding="utf-8")
                self.assertIn("rien d'écrit", self.restore())
                if broken is None:
                    self.assertFalse(self.settings.exists())
                else:
                    self.assertEqual(self.settings.read_text(encoding="utf-8"), broken)

    def test_fichier_change_entre_la_lecture_et_le_renommage_pas_ecrase(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})

        def late_writer(src, dst):
            raise AssertionError("os.replace ne doit pas être appelé")
        original_read = Path.read_bytes
        calls = {"n": 0}

        def read_bytes(path):
            data = original_read(path)
            if path == self.settings:
                calls["n"] += 1
                if calls["n"] == 2:  # la relecture d'avant le renommage : une autre session vient d'écrire
                    self.write_settings({**SETTINGS, "model": "haiku"})
                    return original_read(path)
            return data
        with mock.patch.object(Path, "read_bytes", read_bytes), mock.patch.object(sonde.os, "replace", late_writer):
            report = self.restore()
        self.assertIn("changé", report)
        self.assertEqual(self.model_now(), "haiku")
        self.assertEqual([p.name for p in self.home.iterdir()], ["settings.json"])  # pas de fichier voisin laissé

    def test_garder_rien_n_est_ecrit_et_le_rapport_donne_la_valeur_d_avant(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        report = self.restore(keep=True)
        self.assertEqual(self.model_now(), "fable")
        self.assertIn("--garder", report)
        self.assertIn("/model opus", report)

    def test_second_nettoyage_rien(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        self.restore()
        self.assertEqual(self.model_now(), "opus")
        # Une autre session choisit ensuite fable à son tour : un second --nettoyer n'y touche plus.
        self.write_settings({**SETTINGS, "model": "fable"})
        self.assertIn("premier nettoyage", self.restore())
        self.assertEqual(self.model_now(), "fable")

    def test_une_marque_sans_note_n_ecrit_rien(self):
        sonde.mark_launch(self.folder, "/bin/claude")  # un lancement d'avant ce ticket
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        self.assertIn("rien d'écrit", self.restore())
        self.assertEqual(self.model_now(), "fable")

    def test_l_ecriture_ratee_est_dite_sans_arreter_le_nettoyage(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        args = mock.Mock(nettoyer=str(self.folder), journaux=str(self.folder / "journaux"), apres_session=True,
                         claude="/bin/claude", garder=False)

        def fake(cmd, **kwargs):
            if cmd[1:2] == ["list-panes"]:
                return mock.Mock(returncode=0, stdout="", stderr="")
            return mock.Mock(returncode=0, stdout="2.1.317 (Claude Code)\n")
        cleaned = mock.Mock(return_value=sonde.Report())
        with mock.patch.object(sonde.subprocess, "run", side_effect=fake), \
                mock.patch.object(sonde.os, "replace", side_effect=PermissionError("refusé")), \
                mock.patch.object(sonde, "clean", cleaned), redirect_stdout(io.StringIO()) as out:
            self.assertEqual(sonde.finish(args, "tmux", home=self.home, tmp=self.folder.parent), 0)
        cleaned.assert_called_once()
        self.assertIn("écriture ratée", out.getvalue())
        self.assertIn("écriture ratée", (self.folder / "journaux" / sonde.LOG_NAME).read_text(encoding="utf-8"))
        self.assertEqual(self.model_now(), "fable")
        self.assertEqual([p.name for p in self.home.iterdir()], ["settings.json"])

    def test_la_remise_faite_se_dit_meme_quand_le_releve_du_nettoyage_leve(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        args = mock.Mock(nettoyer=str(self.folder), journaux=str(self.folder / "journaux"), apres_session=True,
                         claude="/bin/claude", garder=False)

        def fake(cmd, **kwargs):
            if cmd[1:2] == ["list-panes"]:
                return mock.Mock(returncode=0, stdout="", stderr="")
            return mock.Mock(returncode=0, stdout="2.1.317 (Claude Code)\n")
        with mock.patch.object(sonde.subprocess, "run", side_effect=fake), \
                mock.patch.object(sonde, "clean", side_effect=PermissionError("refusé")), \
                redirect_stdout(io.StringIO()) as out, self.assertRaises(sonde.SondeError):
            sonde.finish(args, "tmux", home=self.home, tmp=self.folder.parent)
        self.assertEqual(self.model_now(), "opus")
        self.assertIn("remis", out.getvalue())
        log = (self.folder / "journaux" / sonde.LOG_NAME).read_text(encoding="utf-8")
        self.assertIn("remis", log)
        self.assertIn("nettoyage refusé", log)

    def test_la_meme_valeur_ecrite_par_un_autre_apres_ou_avant_le_model_de_la_sonde_n_est_pas_ecrasee(self):
        # La valeur seule ne prouve pas l'auteur : la date du fichier doit être celle du /model de la sonde.
        cases = {
            "même valeur réécrite plus tard": ({**SETTINGS, "model": "fable"}, SWITCH_NS + 60_000_000_000, SWITCH_T_MS),
            "fichier plus ancien que le /model": ({**SETTINGS, "model": "fable"}, SWITCH_NS - 60_000_000_000, SWITCH_T_MS),
            "autre clé changée après": ({**SETTINGS, "model": "fable", "effortLevel": "low"},
                                         SWITCH_NS + 30_000_000_000, SWITCH_T_MS),
            "ligne sans t": ({**SETTINGS, "model": "fable"}, SWITCH_NS, None),
        }
        for name, (data, at, t) in cases.items():
            with self.subTest(name):
                for leftover in (sonde.MARKER, sonde.MODEL_DONE):
                    if (self.folder / leftover).exists():
                        (self.folder / leftover).unlink()
                self.launch()
                self.journal(switch("fable", "claude-fable-5-2", t=t))
                self.write_settings(data, at=at)
                before = self.settings.read_bytes()
                self.assertIn("rien d'écrit", self.restore())
                self.assertEqual(self.settings.read_bytes(), before)

    def test_un_journal_au_nom_illisible_n_ecrit_rien(self):
        self.launch()
        (self.folder / "journaux" / "essai.jsonl").write_text(switch("fable", "claude-fable-5-2") + "\n", encoding="utf-8")
        self.write_settings({**SETTINGS, "model": "fable"})
        self.assertIn("heure illisible", self.restore())
        self.assertEqual(self.model_now(), "fable")

    def test_l_id_resolu_seul_ne_prouve_rien(self):
        # Le /model de la sonde demandait l'alias ; une autre session a écrit l'id complet.
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "claude-fable-5-2"})
        self.assertIn("rien d'écrit", self.restore())
        self.assertEqual(self.model_now(), "claude-fable-5-2")

    def test_model_default_de_la_sonde_est_dit_sans_accuser_une_autre_session(self):
        self.launch()
        self.journal(switch(None, "claude-opus-5-5"))
        self.write_settings({k: v for k, v in SETTINGS.items() if k != "model"})
        report = self.restore()
        self.assertIn("/model default", report)
        self.assertNotIn("une autre session", report)
        self.assertIn("/model opus", report)
        self.assertEqual(self.model_now(), "<absente>")

    def test_des_valeurs_mal_formees_n_arretent_rien_et_n_ecrivent_rien(self):
        self.launch()
        for requested in (["fable"], {"a": 1}, 3, "fable; rm -rf /", "x" * 200):
            with self.subTest(requested=requested):
                if (self.folder / sonde.MODEL_DONE).exists():
                    (self.folder / sonde.MODEL_DONE).unlink()
                self.journal(switch(requested, "claude-fable-5-2"))
                self.write_settings({**SETTINGS, "model": "fable"})
                self.assertIn("rien d'écrit", self.restore())
                self.assertEqual(self.model_now(), "fable")
        # Une valeur notée hors forme : jamais écrite, comme illisible.
        self.write_settings({**SETTINGS, "model": "opus\n\x1b[31m"})
        self.assertEqual(sonde.note_model(self.settings), {"etat": "illisible"})

    def test_un_nombre_que_json_n_ecrit_pas_fait_rater_l_ecriture_sans_rien_changer(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.settings.write_text('{"x": 1e400, "model": "fable"}\n', encoding="utf-8")
        os.utime(self.settings, ns=(SWITCH_NS, SWITCH_NS))
        self.assertIn("écriture ratée", self.restore())
        self.assertEqual(self.settings.read_text(encoding="utf-8"), '{"x": 1e400, "model": "fable"}\n')
        self.assertEqual([p.name for p in self.home.iterdir()], ["settings.json"])

    @unittest.skipIf(os.name == "nt", "droits POSIX")
    def test_la_remise_garde_les_droits_du_fichier(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        self.settings.chmod(0o600)
        os.utime(self.settings, ns=(SWITCH_NS, SWITCH_NS))
        old = os.umask(0o022)
        try:
            self.restore()
        finally:
            os.umask(old)
        self.assertEqual(self.model_now(), "opus")
        self.assertEqual(os.stat(self.settings).st_mode & 0o777, 0o600)

    def test_la_valeur_d_avant_passe_a_l_etape_de_fin_seulement_sans_dossier_a_nettoyer(self):
        common = dict(tmux="tmux", name="sonde", journals=Path("/T/j"), claude="/bin/claude", plugins=[], env=[],
                      model="haiku", effort="low", resume=False, keep=False)
        noted = {"etat": "valeur", "valeur": "opus"}
        given = sonde.session_command(folder=Path("/projet"), clean_name=None, model_before=noted, **common)
        self.assertIn(f"--modele-avant {json.dumps(noted)}".replace('"', ""), given[-1].replace("'", "").replace('"', ""))
        jetable = sonde.session_command(folder=Path("/T/sonde-abcd1234"), clean_name=Path("/T/sonde-abcd1234"),
                                        model_before=noted, **common)
        self.assertNotIn("--modele-avant", jetable[-1])

    def test_une_reecriture_aux_memes_octets_avant_le_renommage_n_est_pas_ecrasee(self):
        self.launch()
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        original = sonde.last_model_switch

        def late(folder):
            # Pendant la lecture du journal, une autre session réécrit les mêmes octets, à une autre heure.
            os.utime(self.settings, ns=(SWITCH_NS + 1_000_000, SWITCH_NS + 1_000_000))
            return original(folder)
        with mock.patch.object(sonde, "last_model_switch", late):
            self.assertIn("changé", self.restore())
        self.assertEqual(self.model_now(), "fable")

    def test_la_marge_de_la_date_est_de_cinq_secondes_des_deux_cotes(self):
        for offset, written in ((4_900_000_000, True), (-4_900_000_000, True), (5_100_000_000, False),
                                (-5_100_000_000, False)):
            with self.subTest(offset=offset):
                for leftover in (sonde.MARKER, sonde.MODEL_DONE):
                    if (self.folder / leftover).exists():
                        (self.folder / leftover).unlink()
                self.launch()
                self.journal(switch("fable", "claude-fable-5-2"))
                self.write_settings({**SETTINGS, "model": "fable"}, at=SWITCH_NS + offset)
                self.restore()
                self.assertEqual(self.model_now(), "opus" if written else "fable")

    def test_un_lancement_sous_claude_config_dir_n_ecrit_jamais(self):
        self.write_settings(SETTINGS)
        sonde.mark_launch(self.folder, "/bin/claude", {**sonde.note_model(self.settings), "ailleurs": True})
        self.journal(switch("fable", "claude-fable-5-2"))
        self.write_settings({**SETTINGS, "model": "fable"})
        report = self.restore()
        self.assertIn("CLAUDE_CONFIG_DIR", report)
        self.assertIn("/model opus", report)
        self.assertEqual(self.model_now(), "fable")

    def test_une_ligne_sans_requested_model_n_est_pas_un_model_default(self):
        self.launch()
        line = json.dumps({"ev": "classic.PostModelSwitch", "sid": SESSION, "to_model": "x", "source": "command",
                           "t": SWITCH_T_MS})
        self.journal(line)
        self.write_settings({**SETTINGS, "model": "fable"})
        report = self.restore()
        self.assertNotIn("/model default", report.split("valeur au lancement")[0])
        self.assertEqual(self.model_now(), "fable")

    def test_les_gardes_de_forme_passent_le_corpus_hostile(self):
        for good in ("opus", "claude-fable-5-2", "opus[1m]", "claude-opus-4-1@20250805",
                     "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "arn:aws:bedrock:us-east-1:1:model/x"):
            self.assertTrue(sonde.valid_model(good), good)
        pieces = ["\x00", "\x1b", "\x85", " ", "\n", " ", "​", "﻿", "K", "１", "١", "é"]
        hostile = [*pieces, *("opus" + p for p in pieces), *("a" + p + "b" for p in pieces), "x" * 201, "",
                   None, [], {}, 42, 4.2, True]
        for value in hostile:
            with self.subTest(value=repr(value)):
                self.assertFalse(sonde.valid_model(value))
        self.assertIsNotNone(sonde.JOURNAL_STAMP.fullmatch(JOURNAL))
        for piece in ("１", "١", " ", "\x00"):
            with self.subTest(stamp=repr(piece)):
                self.assertIsNone(sonde.JOURNAL_STAMP.fullmatch(JOURNAL.replace("0", piece, 1)))

    def test_une_valeur_d_avant_mal_formee_ne_fait_pas_tomber_l_etape_de_fin(self):
        journals = self.folder / "journaux"
        for before in ("{pas du json", json.dumps({"etat": "valeur"}), json.dumps({"etat": "valeur", "valeur": ["x"]})):
            with self.subTest(before=before):
                args = mock.Mock(nettoyer=None, journaux=str(journals), apres_session=True, claude="/bin/claude",
                                 garder=False, modele_avant=before)
                with mock.patch.object(sonde.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="2.1.317\n")), \
                        redirect_stdout(io.StringIO()) as out:
                    self.assertEqual(sonde.finish(args, "tmux", home=self.home, tmp=self.folder.parent), 0)
                self.assertIn("illisible", out.getvalue())

    def test_dir_ou_claude_config_dir_le_rapport_dit_la_valeur_d_avant(self):
        journals = self.folder / "journaux"
        args = mock.Mock(nettoyer=None, journaux=str(journals), apres_session=True, claude="/bin/claude",
                         garder=False, modele_avant=json.dumps({"etat": "valeur", "valeur": "opus"}))
        self.write_settings({**SETTINGS, "model": "fable"})
        with mock.patch.object(sonde.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="2.1.317\n")), \
                redirect_stdout(io.StringIO()) as out:
            self.assertEqual(sonde.finish(args, "tmux", home=self.home, tmp=self.folder.parent), 0)
        self.assertIn("/model opus", out.getvalue())
        self.assertIn("/model opus", (journals / sonde.LOG_NAME).read_text(encoding="utf-8"))
        self.assertEqual(self.model_now(), "fable")


if __name__ == "__main__":
    unittest.main()
