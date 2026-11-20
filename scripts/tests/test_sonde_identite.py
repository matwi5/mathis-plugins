"""Tests de l'identité de la sonde (scripts/sonde.py) : lancée depuis une session Claude Code, elle tourne
sous un id neuf, sans aucune variable d'identité de la session qui la lance, dont elle passe l'id à son mod ;
un `--env` qui lui redonnerait cet id est refusé avant toute écriture.
python3 -m unittest discover -s scripts/tests."""

import importlib.util
import io
import json
import os
import shlex
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sonde  # noqa: E402
from test_journal_mission import DOTS, PIECES  # noqa: E402  (le corpus hostile commun des tests Python)

LAUNCHER = "0a1b2c3d-1111-2222-3333-444455556666"
NEW = "9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff"
COMMON = dict(tmux="tmux", name="sonde", folder=Path("/T/sonde-abcd1234"), journals=Path("/j"), claude="/bin/claude",
              plugins=[], model="haiku", effort="low", clean_name=None, keep=False)


def claude_part(command):
    """La partie de la commande tmux qui lance Claude Code (avant l'étape de fin), en mots."""
    return shlex.split(command[-1].split("; ")[0])


class IdentityListTest(unittest.TestCase):
    def test_une_seule_liste_partagee_avec_mesure_depart(self):
        expected = {"CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED",
                    "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_BRIDGE_SESSION_ID",
                    "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_PID", "CLAUDE_JOB_DIR"}
        self.assertEqual(set(sonde.IDENTITY), expected)
        spec = importlib.util.spec_from_file_location("mesure_depart", Path(sonde.__file__).with_name("mesure-depart.py"))
        md = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(md)
        # mesure-depart.py garde son traitement propre de CLAUDE_CONFIG_DIR et CLAUDE_EFFORT.
        self.assertEqual(set(md.INHERITED), expected | {"CLAUDE_CONFIG_DIR", "CLAUDE_EFFORT"})
        for name in sonde.IDENTITY:
            self.assertIn(name, md.INHERITED)


class SessionCommandTest(unittest.TestCase):
    def test_la_session_ne_porte_aucune_variable_d_identite_et_prend_un_id_neuf(self):
        words = claude_part(sonde.session_command(env=[], resume=False, session_id=NEW, launcher=LAUNCHER, **COMMON))
        removed = {words[i + 1] for i, w in enumerate(words) if w == "-u"}
        self.assertTrue(set(sonde.IDENTITY) <= removed, set(sonde.IDENTITY) - removed)
        self.assertIn(sonde.LAUNCHER_VAR, removed)
        assigned = [w.split("=", 1)[0] for w in words if "=" in w and not w.startswith("-")]
        self.assertFalse(set(assigned) & set(sonde.IDENTITY), assigned)
        self.assertEqual(words[words.index("--session-id") + 1], NEW)
        self.assertNotIn("--continue", words)

    def test_une_reprise_garde_la_reprise_du_moteur_sans_id_choisi(self):
        words = claude_part(sonde.session_command(env=[], resume=True, session_id=NEW, launcher=LAUNCHER, **COMMON))
        self.assertIn("--continue", words)
        self.assertNotIn("--session-id", words)

    def test_l_id_du_lanceur_passe_au_mod_apres_les_env(self):
        words = claude_part(sonde.session_command(env=[f"{sonde.LAUNCHER_VAR}=autre", "X=1"], resume=False,
                                                  session_id=NEW, launcher=LAUNCHER, **COMMON))
        values = [w for w in words if w.startswith(f"{sonde.LAUNCHER_VAR}=")]
        # `env` garde la dernière affectation : celle de la sonde, après les --env.
        self.assertEqual(values[-1], f"{sonde.LAUNCHER_VAR}={LAUNCHER}")
        self.assertLess(words.index("X=1"), words.index(values[-1]))

    def test_sans_lanceur_en_forme_aucune_variable_du_lanceur_n_est_posee(self):
        for launcher in (None, "pas-un-id", ""):
            with self.subTest(launcher=launcher):
                words = claude_part(sonde.session_command(env=[], resume=False, session_id=NEW, launcher=launcher, **COMMON))
                self.assertFalse([w for w in words if w.startswith(f"{sonde.LAUNCHER_VAR}=")])
                self.assertIn(sonde.LAUNCHER_VAR, words)  # toujours retirée de l'environnement hérité


class LauncherTest(unittest.TestCase):
    def test_l_id_du_lanceur_se_lit_dans_l_environnement_en_forme_seulement(self):
        self.assertEqual(sonde.launcher_id({"CLAUDE_CODE_SESSION_ID": LAUNCHER}), LAUNCHER)
        self.assertEqual(sonde.launcher_id({"CLAUDE_CODE_SESSION_ID": LAUNCHER.upper()}), LAUNCHER)
        self.assertIsNone(sonde.launcher_id({}))
        self.assertIsNone(sonde.launcher_id({"CLAUDE_CODE_SESSION_ID": "x; rm -rf /"}))

    def test_un_env_qui_porte_l_id_du_lanceur_est_refuse(self):
        for value in (LAUNCHER, LAUNCHER.upper(), LAUNCHER.replace("-", ""), f"pre{LAUNCHER}post"):
            with self.subTest(value=value):
                self.assertIsNotNone(sonde.env_refusal([f"CLAUDE_CODE_SESSION_ID={value}"], LAUNCHER))
                self.assertIsNotNone(sonde.env_refusal([f"AUTRE={value}"], LAUNCHER))
        self.assertIsNone(sonde.env_refusal(["X=1", f"Y={NEW}"], LAUNCHER))
        self.assertIsNone(sonde.env_refusal([f"X={LAUNCHER}"], None))

    def test_un_env_qui_pose_une_variable_d_identite_est_refuse_lanceur_connu_ou_non(self):
        for name in sonde.IDENTITY:
            for launcher in (LAUNCHER, None):
                with self.subTest(name=name, launcher=launcher):
                    refusal = sonde.env_refusal(["X=1", f"{name}=quelconque"], launcher)
                    self.assertIsNotNone(refusal)
                    self.assertIn(name, refusal)
        self.assertIsNone(sonde.env_refusal(["CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000", "CLAUDE_CONFIG_DIR=/c"], None))

    def test_les_gardes_de_forme_de_l_id_du_lanceur_passent_le_corpus_hostile(self):
        pieces = [*PIECES, DOTS, chr(0x661), "é"]
        hostile = [*pieces, *(LAUNCHER + p for p in pieces), *(p + LAUNCHER for p in pieces),
                   *(LAUNCHER[:8] + p + LAUNCHER[9:] for p in pieces), LAUNCHER * 2, "x" * 10_000, "",
                   None, [], {}, 42, True]
        for value in hostile:
            with self.subTest(value=repr(value)[:60]):
                self.assertIsNone(sonde.launcher_id({"CLAUDE_CODE_SESSION_ID": value}))
                words = claude_part(sonde.session_command(env=[], resume=False, session_id=NEW, launcher=value, **COMMON))
                self.assertFalse([w for w in words if w.startswith(f"{sonde.LAUNCHER_VAR}=")])

    def test_une_reprise_dans_le_dossier_ou_le_lanceur_a_son_transcript_est_refusee(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(os.path.realpath(d))
            config, folder, other = base / "config", base / "projet", base / "ailleurs"
            for f in (folder, other):
                f.mkdir()
            project = config / "projects" / sonde.project_dir_name(folder)
            project.mkdir(parents=True)
            (project / f"{LAUNCHER}.jsonl").write_text("{}\n", encoding="utf-8")
            self.assertIn("lanceur", sonde.resume_refusal(folder, LAUNCHER, config))
            self.assertIsNone(sonde.resume_refusal(other, LAUNCHER, config))
            self.assertIsNone(sonde.resume_refusal(folder, None, config))
            self.assertIsNone(sonde.resume_refusal(folder, NEW, config))

    def test_une_reprise_dans_un_dossier_au_nom_encode_coupe_est_refusee(self):
        # Au-delà de 200 signes, Claude Code coupe le nom encodé et lui ajoute « -<empreinte> » : le
        # transcript du lanceur s'y cherche par ce début (violation trouvée par la passe d'après les correctifs).
        with tempfile.TemporaryDirectory() as d:
            base = Path(os.path.realpath(d))
            folder = base / ("a" * 120) / ("b" * 120)
            folder.mkdir(parents=True)
            name = sonde.project_dir_name(folder)
            self.assertGreater(len(name), sonde.ENCODED_MAX)
            config = base / "config"
            project = config / "projects" / f"{name[:sonde.ENCODED_MAX]}-1a2b3c"
            project.mkdir(parents=True)
            self.assertIsNone(sonde.resume_refusal(folder, LAUNCHER, config))
            (project / f"{LAUNCHER}.jsonl").write_text("{}\n", encoding="utf-8")
            self.assertIn("lanceur", sonde.resume_refusal(folder, LAUNCHER, config))
            # Une autre session, sans transcript dans ce dossier : pas de refus.
            self.assertIsNone(sonde.resume_refusal(folder, NEW, config))
            # La casse du dossier donné peut différer de celle du disque (APFS) : le début se compare sans elle.
            upper = config / "projects" / f"{name[:sonde.ENCODED_MAX].upper()}-9z9z"
            project.rename(upper)
            self.assertIn("lanceur", sonde.resume_refusal(folder, LAUNCHER, config))

    def test_la_marque_note_le_lanceur_inconnu_quand_une_session_lance_sans_id_lisible(self):
        self.assertEqual(sonde.launcher_mark({"CLAUDE_CODE_SESSION_ID": LAUNCHER}), LAUNCHER)
        for environ in ({"CLAUDE_CODE_SESSION_ID": "abc"}, {"CLAUDECODE": "1"}, {"CLAUDECODE": "1", "CLAUDE_PID": "1"}):
            with self.subTest(environ=environ):
                self.assertEqual(sonde.launcher_mark(environ), sonde.UNKNOWN_LAUNCHER)
        # Les autres variables d'identité, seules (un environnement tmux partiel), ne décident pas.
        for environ in ({"PATH": "/bin"}, {"CLAUDE_CODE_BRIDGE_SESSION_ID": "x"}, {"CLAUDE_JOB_DIR": "/j", "CLAUDE_PID": "1"}):
            with self.subTest(environ=environ):
                self.assertIsNone(sonde.launcher_mark(environ))

    def test_un_lancement_reussi_note_le_lanceur_dans_la_marque(self):
        cases = [({"CLAUDE_CODE_SESSION_ID": LAUNCHER}, LAUNCHER, "est supprimé"),
                 ({"CLAUDECODE": "1"}, sonde.UNKNOWN_LAUNCHER, "rien n'est supprimé"),
                 ({"CLAUDE_CODE_SESSION_ID": "abc"}, sonde.UNKNOWN_LAUNCHER, "rien n'est supprimé"),
                 ({}, None, "est supprimé")]
        for extra, expected, said in cases:
            with self.subTest(extra=extra):
                marker, out, log = self.launch(extra)
                self.assertEqual(marker["lanceur"], expected)
                self.assertIn(said, out)
                self.assertIn("inconnu" if expected == sonde.UNKNOWN_LAUNCHER else expected or "aucun", log)

    def launch(self, extra):
        """Un lancement réussi de `main()` (tmux et claude en faux) avec ces variables : la marque écrite, ce
        qui s'affiche et le journal de la sonde."""
        real_mkdtemp = tempfile.mkdtemp
        with tempfile.TemporaryDirectory() as d:
            base = Path(os.path.realpath(d))
            (base / "sonde").mkdir()
            (base / "home" / ".claude").mkdir(parents=True)
            made = []

            def mkdtemp(prefix):
                made.append(Path(real_mkdtemp(prefix=prefix, dir=base)))
                return str(made[-1])
            environ = {"PATH": os.environ.get("PATH", ""), **extra}
            out = io.StringIO()
            with mock.patch.object(sys, "argv", ["sonde.py"]), mock.patch.dict(os.environ, environ, clear=True), \
                    mock.patch.object(sonde.shutil, "which", return_value="/bin/x"), \
                    mock.patch.object(sonde.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="v\n", stderr="")) as run, \
                    mock.patch.object(sonde.tempfile, "mkdtemp", side_effect=mkdtemp), \
                    mock.patch.object(sonde, "SONDE", base / "sonde"), \
                    mock.patch.object(sonde.Path, "home", return_value=base / "home"), \
                    redirect_stdout(out):
                sonde.main()
            # Le client tmux part sans les variables d'identité : un serveur qu'il démarrerait ne les garde pas.
            tmux = [c for c in run.call_args_list if "new-session" in c.args[0]]
            self.assertEqual(len(tmux), 1)
            self.assertFalse(set(tmux[0].kwargs["env"]) & {*sonde.IDENTITY, sonde.LAUNCHER_VAR})
            self.assertIn("PATH", tmux[0].kwargs["env"])
            marker = json.loads((made[0] / sonde.MARKER).read_text(encoding="utf-8"))
            log = (made[0] / "journaux" / sonde.LOG_NAME).read_text(encoding="utf-8")
        return marker, out.getvalue(), log

    def run_refused(self, argv, environ):
        """Lance `main()` avec ces arguments et cet environnement ; rend le texte du refus, après avoir vérifié
        que rien n'a été lancé ni écrit."""
        with mock.patch.object(sys, "argv", argv), mock.patch.dict(os.environ, environ, clear=True), \
                mock.patch.object(sonde.shutil, "which", return_value="/bin/x"), \
                mock.patch.object(sonde.subprocess, "run") as run, \
                mock.patch.object(sonde.tempfile, "mkdtemp") as mkdtemp, \
                mock.patch.object(sonde, "mark_launch") as mark, \
                mock.patch.object(sonde, "log_line") as log, \
                mock.patch.object(Path, "mkdir") as mkdir, \
                mock.patch.object(Path, "write_text") as write, mock.patch.object(Path, "unlink") as unlink:
            with self.assertRaises(SystemExit) as stop:
                sonde.main()
        for called in (run, mkdtemp, mark, log, mkdir, write, unlink):
            called.assert_not_called()
        return str(stop.exception.code)

    def test_le_refus_au_lancement_n_ecrit_ni_ne_lance_rien(self):
        environ = {**os.environ, "CLAUDE_CODE_SESSION_ID": LAUNCHER}
        self.assertIn("lanceur", self.run_refused(["sonde.py", "--env", f"X={LAUNCHER}", "--titre", "t"], environ))
        self.assertIn("CLAUDE_CODE_MESSAGING_TOKEN",
                      self.run_refused(["sonde.py", "--env", "CLAUDE_CODE_MESSAGING_TOKEN=x", "--titre", "t"], environ))
        with tempfile.TemporaryDirectory() as d:
            base = Path(os.path.realpath(d))
            project = base / "config" / "projects" / sonde.project_dir_name(base)
            project.mkdir(parents=True)
            (project / f"{LAUNCHER}.jsonl").write_text("{}\n", encoding="utf-8")
            text = self.run_refused(["sonde.py", "--dir", str(base), "--reprise", "--titre", "t"],
                                    {**environ, "CLAUDE_CONFIG_DIR": str(base / "config")})
        self.assertIn("--reprise", text)
        # Lancée depuis une session dont l'id ne se lit pas : --continue pourrait la reprendre sans qu'on le sache.
        with tempfile.TemporaryDirectory() as d:
            text = self.run_refused(["sonde.py", "--dir", d, "--reprise"], {"PATH": "/bin", "CLAUDECODE": "1"})
        self.assertIn("ne se lit pas", text)


if __name__ == "__main__":
    unittest.main()
