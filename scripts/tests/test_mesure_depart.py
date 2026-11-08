"""Tests de la mesure du départ (scripts/mesure-depart.py) : le plan d'effacement ne retire que ce que ce
lancement a créé (`<id>.jsonl` et `<id>/` d'un dossier de projet, vérifiés par `sessionId` et `cwd`),
jamais le transcript d'une autre session ; et la lecture de l'usage de chaque requête. Sur un faux
`~/.claude` et des fichiers posés, sans lancer Claude Code : python3 -m unittest discover -s scripts/tests."""

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "mesure-depart.py"
sys.path.insert(0, str(SCRIPT.parent))
spec = importlib.util.spec_from_file_location("mesure_depart", SCRIPT)
md = importlib.util.module_from_spec(spec)
spec.loader.exec_module(md)

SID = "0a1b2c3d-1111-2222-3333-444455556666"
OTHER = "9f8e7d6c-1111-2222-3333-444455556666"
FIRST, SECOND = md.PROMPTS


def line(**fields):
    return json.dumps(fields) + "\n"


class Essai(unittest.TestCase):
    """Un faux `~/.claude` : le dossier de projet d'un vrai dossier mesuré, avec le transcript du lancement
    (`SID`, son dossier `SID/`) et celui d'une autre session (`OTHER`), qui doit rester."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(os.path.realpath(self.dir.name))
        self.home = base / "claude"
        self.folder = base / "projet"
        self.folder.mkdir()
        self.project = self.home / "projects" / md.project_dir_name(self.folder)
        self.project.mkdir(parents=True)
        self.transcript = self.project / f"{SID}.jsonl"
        self.transcript.write_text(self.ours(SID, str(self.folder)), encoding="utf-8")
        (self.project / SID / "tool-results").mkdir(parents=True)
        (self.project / SID / "tool-results" / "r.txt").write_text("x", encoding="utf-8")
        self.other = self.project / f"{OTHER}.jsonl"
        self.other.write_text(line(type="user", sessionId=OTHER, cwd=str(self.folder), message={"content": "autre"}), encoding="utf-8")
        (self.project / OTHER).mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def ours(self, sid, cwd):
        """Un transcript de mesure : deux tours, une requête chacun (le premier écrit en deux lignes)."""
        usage1 = {"input_tokens": 3, "cache_creation_input_tokens": 40000, "cache_read_input_tokens": 0}
        usage2 = {"input_tokens": 5, "cache_creation_input_tokens": 1200, "cache_read_input_tokens": 40000}
        return "".join([
            line(type="permission-mode", sessionId=sid),
            line(type="file-history-snapshot", messageId="m0"),
            line(type="user", sessionId=sid, cwd=cwd, message={"role": "user", "content": FIRST}),
            line(type="attachment", sessionId=sid, cwd=cwd, attachment={"type": "deferred_tools_delta"}),
            line(type="assistant", sessionId=sid, cwd=cwd, message={"id": "msg_1", "model": "claude-haiku-5-5", "usage": usage1}),
            line(type="assistant", sessionId=sid, cwd=cwd, message={"id": "msg_1", "model": "claude-haiku-5-5", "usage": usage1}),
            line(type="user", sessionId=sid, cwd=cwd, message={"role": "user", "content": [{"type": "text", "text": SECOND}]}),
            line(type="assistant", sessionId=sid, cwd=cwd, message={"id": "msg_2", "model": "claude-haiku-5-5", "usage": usage2}),
        ])

    def clean(self, keep=False, new_dirs=()):
        return md.clean(self.home, self.folder, SID, keep=keep, new_dirs=new_dirs)


class CleanTest(Essai):
    def test_seuls_le_transcript_et_le_dossier_du_lancement_sont_effaces(self):
        report = self.clean()
        self.assertIsNone(report.error)
        self.assertFalse(self.transcript.exists())
        self.assertFalse((self.project / SID).exists())
        self.assertTrue(self.other.exists())
        self.assertTrue((self.project / OTHER).is_dir())
        self.assertEqual(report.deleted, [str(self.project / SID), str(self.transcript)])

    def test_un_transcript_d_une_autre_session_au_bon_nom_n_est_pas_efface(self):
        self.transcript.write_text(self.ours(OTHER, str(self.folder)), encoding="utf-8")
        report = self.clean()
        self.assertTrue(self.transcript.exists())
        self.assertTrue((self.project / SID).exists())
        self.assertEqual(report.deleted, [])
        self.assertTrue(any(OTHER in k for k in report.kept))

    def test_un_transcript_d_un_autre_dossier_n_est_pas_efface(self):
        self.transcript.write_text(self.ours(SID, str(self.folder / "sous-dossier")), encoding="utf-8")
        self.clean()
        self.assertTrue(self.transcript.exists())
        self.assertTrue((self.project / SID).exists())

    def test_un_transcript_repris_par_une_autre_demande_n_est_pas_efface(self):
        with open(self.transcript, "a", encoding="utf-8") as f:
            f.write(line(type="user", sessionId=SID, cwd=str(self.folder), message={"content": "un vrai travail"}))
        self.clean()
        self.assertTrue(self.transcript.exists())

    def test_une_reprise_avec_une_image_n_est_pas_effacee(self):
        content = [{"type": "text", "text": "corrige ça"}, {"type": "image", "source": {}}]
        with open(self.transcript, "a", encoding="utf-8") as f:
            f.write(line(type="user", sessionId=SID, cwd=str(self.folder), message={"content": content}))
        self.clean()
        self.assertTrue(self.transcript.exists())
        self.assertTrue((self.project / SID).exists())

    def test_un_message_mis_en_file_n_est_pas_efface(self):
        with open(self.transcript, "a", encoding="utf-8") as f:
            f.write(line(type="attachment", sessionId=SID, cwd=str(self.folder),
                         attachment={"type": "queued_command", "prompt": "autre chose"}))
        self.clean()
        self.assertTrue(self.transcript.exists())

    def test_un_resultat_d_outil_ne_compte_pas_comme_une_reprise(self):
        with open(self.transcript, "a", encoding="utf-8") as f:
            f.write(line(type="user", sessionId=SID, cwd=str(self.folder),
                         message={"content": [{"type": "tool_result", "content": "x"}]}))
        self.clean()
        self.assertFalse(self.transcript.exists())

    def test_un_champ_d_une_autre_forme_fait_garder_le_transcript(self):
        with open(self.transcript, "a", encoding="utf-8") as f:
            f.write(line(type="user", sessionId=SID, cwd=[str(self.folder)], message="texte"))
        report = self.clean()
        self.assertTrue(self.transcript.exists())
        self.assertIsNone(report.error)

    def test_un_message_absent_ou_d_une_autre_forme_fait_garder_le_transcript_sans_erreur(self):
        for message in ({}, {"message": None}, {"message": "texte"}):
            with self.subTest(message=message):
                with open(self.transcript, "a", encoding="utf-8") as f:
                    f.write(line(type="user", sessionId=SID, cwd=str(self.folder), **message))
                self.assertIsNotNone(md.transcript_doubt(self.transcript, SID, md.roots_of(self.folder)))
                md.usage_rows(self.transcript)
        self.clean()
        self.assertTrue(self.transcript.exists())

    def test_une_session_rouverte_apres_l_arret_n_est_pas_effacee(self):
        # `claude --resume` de la mesure après son arrêt, sans rien taper encore : son registre porte l'id.
        (self.home / "sessions").mkdir()
        (self.home / "sessions" / "4242.json").write_text(json.dumps({"pid": 4242, "sessionId": SID}), encoding="utf-8")
        report = self.clean()
        self.assertTrue(self.transcript.exists())
        self.assertTrue((self.project / SID).exists())
        self.assertIn("rouverte", report.error)

    def test_un_registre_d_une_autre_forme_ne_fait_pas_planter(self):
        (self.home / "sessions").mkdir()
        (self.home / "sessions" / "1.json").write_text("[1, 2]", encoding="utf-8")
        self.assertEqual(md.open_sessions(self.home, SID), [])

    def test_le_dossier_ne_s_efface_pas_si_son_transcript_change_entre_le_plan_et_l_effacement(self):
        # Relu juste avant l'effacement du dossier : une reprise écrite après le plan le garde.
        original = md.folder_doubts

        def resumed(folder, sid, roots):
            with open(self.transcript, "a", encoding="utf-8") as f:
                f.write(line(type="user", sessionId=SID, cwd=str(self.folder), message={"content": "reprise"}))
            md.folder_doubts = original
            return original(folder, sid, roots)
        md.folder_doubts = resumed
        try:
            report = self.clean()
        finally:
            md.folder_doubts = original
        self.assertTrue((self.project / SID).exists())
        self.assertTrue(self.transcript.exists())
        self.assertIsNotNone(report.error)

    def test_une_ligne_illisible_fait_garder_le_transcript(self):
        with open(self.transcript, "a", encoding="utf-8") as f:
            f.write('{"type": "assistant", "sessi')
        self.clean()
        self.assertTrue(self.transcript.exists())

    def test_un_transcript_sans_sessionId_ni_cwd_n_est_pas_efface(self):
        self.transcript.write_text(line(type="user", message={"content": FIRST}), encoding="utf-8")
        self.clean()
        self.assertTrue(self.transcript.exists())

    def test_un_lien_symbolique_n_est_jamais_suivi_ni_efface(self):
        target = self.folder / "precieux"
        target.mkdir()
        (target / "garde.txt").write_text("x", encoding="utf-8")
        (self.project / SID / "lien").symlink_to(target)
        self.clean()
        self.assertTrue((target / "garde.txt").exists())
        self.assertTrue((self.project / SID).exists())
        self.assertTrue(self.transcript.exists())

    def test_un_dossier_de_session_sans_transcript_qui_le_prouve_reste(self):
        self.transcript.unlink()
        report = self.clean()
        self.assertTrue((self.project / SID).exists())
        self.assertEqual(report.deleted, [])

    def test_un_transcript_au_meme_id_dans_un_autre_projet_n_est_pas_efface(self):
        elsewhere = self.home / "projects" / "-ailleurs"
        elsewhere.mkdir()
        (elsewhere / f"{SID}.jsonl").write_text(self.ours(SID, str(self.folder)), encoding="utf-8")
        report = self.clean()
        self.assertTrue((elsewhere / f"{SID}.jsonl").exists())
        self.assertTrue(any("-ailleurs" in k for k in report.kept))

    def test_garder_n_efface_rien_et_donne_les_chemins(self):
        report = self.clean(keep=True)
        self.assertEqual(report.deleted, [])
        self.assertTrue(self.transcript.exists())
        self.assertTrue((self.project / SID).exists())
        self.assertTrue(any(str(self.transcript) in k for k in report.kept))

    def test_un_dossier_de_projet_cree_par_le_lancement_et_vide_part_aussi(self):
        self.other.unlink()
        (self.project / OTHER).rmdir()
        report = self.clean(new_dirs=[self.project])
        self.assertFalse(self.project.exists())
        self.assertIn(str(self.project), report.deleted)

    def test_un_dossier_de_projet_qui_existait_reste(self):
        self.other.unlink()
        (self.project / OTHER).rmdir()
        self.clean()
        self.assertTrue(self.project.is_dir())

    def test_le_premier_effacement_qui_echoue_arrete_le_nettoyage(self):
        os.chmod(self.project / SID, 0o500)
        try:
            report = self.clean()
        finally:
            os.chmod(self.project / SID, 0o700)
        self.assertIsNotNone(report.error)
        self.assertTrue(self.transcript.exists())
        self.assertIn(str(self.transcript), " ".join(report.remaining()))


class RunsTest(Essai):
    """Le nettoyage de plusieurs lancements, et l'arrêt d'une session."""

    def second(self):
        """Un deuxième lancement, dans un autre dossier mesuré, avec son transcript."""
        folder = self.folder.parent / "projet2"
        folder.mkdir()
        project = self.home / "projects" / md.project_dir_name(folder)
        project.mkdir()
        (project / f"{OTHER}.jsonl").write_text(self.ours(OTHER, str(folder)), encoding="utf-8")
        return md.Run(folder, OTHER, f"mesure-{OTHER}", []), project / f"{OTHER}.jsonl"

    def test_le_premier_effacement_qui_echoue_arrete_le_nettoyage_des_dossiers_suivants(self):
        self.other.unlink()  # OTHER devient l'id du deuxième lancement
        run2, transcript2 = self.second()
        os.chmod(self.project / SID, 0o500)
        try:
            reports = list(md.clean_runs(self.home, [md.Run(self.folder, SID, f"mesure-{SID}", []), run2], keep=False))
        finally:
            os.chmod(self.project / SID, 0o700)
        self.assertIsNotNone(reports[0][1].error)
        self.assertTrue(transcript2.exists())
        self.assertEqual(reports[1][1].deleted, [])
        self.assertTrue(any(str(transcript2) in k for k in reports[1][1].kept))

    def test_une_session_qui_tourne_encore_garde_tout(self):
        run = md.Run(self.folder, SID, f"mesure-{SID}", [], alive=True)
        report = list(md.clean_runs(self.home, [run], keep=False))[0][1]
        self.assertTrue(self.transcript.exists())
        self.assertIsNotNone(report.error)

    def running_with(self, stderr):
        run = md.Run(self.folder, SID, f"mesure-{SID}", [])
        saved = md.tmux_cmd
        md.tmux_cmd = lambda *args: subprocess.CompletedProcess(args, 1, "", stderr)
        try:
            return md.running("tmux", self.home, run)
        finally:
            md.tmux_cmd = saved

    def test_un_registre_de_session_ouverte_qui_porte_l_id_la_dit_en_cours(self):
        self.assertFalse(self.running_with(f"can't find session: mesure-{SID}\n"))
        self.assertFalse(self.running_with("no server running on /tmp/tmux-1/default\n"))
        (self.home / "sessions").mkdir()
        (self.home / "sessions" / "4242.json").write_text(json.dumps({"pid": 4242, "sessionId": SID}), encoding="utf-8")
        self.assertTrue(self.running_with(f"can't find session: mesure-{SID}\n"))

    def test_une_erreur_de_tmux_qui_ne_dit_pas_la_session_absente_la_dit_en_cours(self):
        self.assertTrue(self.running_with("error connecting to /tmp/tmux-1/default (Permission denied)\n"))


class ModsTest(Essai):
    def test_seuls_les_plugins_a_modules_de_forme_sure_sont_coupes(self):
        mod, skill = self.folder / "mod", self.folder / "skill"
        (mod / "hooks").mkdir(parents=True)
        (mod / "hooks" / "hooks.json").write_text(json.dumps({"modules": ["./register.tsx"]}), encoding="utf-8")
        skill.mkdir()
        (self.home / "plugins").mkdir()
        (self.home / "plugins" / "installed_plugins.json").write_text(json.dumps({"plugins": {
            "mod@place": [{"installPath": str(mod)}],
            "skill@place": [{"installPath": str(skill)}],
            "x'; rm -rf ~ #@place": [{"installPath": str(mod)}],
            "relatif@place": [{"installPath": "plugins/flow-board"}],
            "chaine@place": ["pas un objet"],
        }}), encoding="utf-8")
        self.assertEqual(md.mods(self.home), ["mod@place"])

    def test_un_fichier_d_une_autre_forme_ne_coupe_rien(self):
        (self.home / "plugins").mkdir()
        (self.home / "plugins" / "installed_plugins.json").write_text("[1, 2]", encoding="utf-8")
        self.assertEqual(md.mods(self.home), [])


class IdTest(Essai):
    def test_un_id_deja_pris_est_reconnu(self):
        self.assertTrue(md.id_traces(self.home, SID))
        self.assertTrue(md.id_traces(self.home, OTHER))
        self.assertEqual(md.id_traces(self.home, "11111111-2222-3333-4444-555555555555"), [])

    def test_un_id_d_une_session_ouverte_est_reconnu(self):
        sid = "11111111-2222-3333-4444-555555555555"
        (self.home / "sessions").mkdir()
        (self.home / "sessions" / "123.json").write_text(json.dumps({"sessionId": sid}), encoding="utf-8")
        self.assertTrue(md.id_traces(self.home, sid))


class UsageTest(Essai):
    def test_l_usage_de_chaque_requete_donne_les_trois_compteurs_et_la_ligne(self):
        rows = md.usage_rows(self.transcript)
        self.assertEqual(rows, [
            {"tour": 1, "ligne": 5, "modele": "claude-haiku-5-5", "entree": 3, "cache_ecrit": 40000, "cache_lu": 0},
            {"tour": 2, "ligne": 8, "modele": "claude-haiku-5-5", "entree": 5, "cache_ecrit": 1200, "cache_lu": 40000},
        ])

    def test_un_compteur_hors_bornes_s_affiche_comme_absent(self):
        self.transcript.write_text("".join([
            line(type="user", sessionId=SID, cwd=str(self.folder), message={"content": FIRST}),
            line(type="assistant", sessionId=SID, cwd=str(self.folder),
                 message={"id": "m", "usage": {"input_tokens": -1, "cache_creation_input_tokens": "x", "cache_read_input_tokens": 1e400}}),
        ]), encoding="utf-8")
        row = md.usage_rows(self.transcript)[0]
        self.assertEqual((row["entree"], row["cache_ecrit"], row["cache_lu"]), (None, None, None))
        out = io.StringIO()
        with redirect_stdout(out):
            md.print_usage(self.folder, self.transcript)
        self.assertIn("—", out.getvalue())


if __name__ == "__main__":
    unittest.main()
