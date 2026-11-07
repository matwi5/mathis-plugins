"""Tests du nettoyage de la sonde (scripts/sonde.py) : à la fin d'un essai, il ne supprime sous
`~/.claude` que ce que ce lancement a créé, repéré par le nom de son dossier jetable. Tout se joue sur
un faux `~/.claude` et un faux dossier temporaire : python3 -m unittest discover -s scripts/tests."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sonde  # noqa: E402

SESSION = "0a1b2c3d-1111-2222-3333-444455556666"
OTHER = "9f8e7d6c-1111-2222-3333-444455556666"


class Essai(unittest.TestCase):
    """Un faux `~/.claude` avec les restes d'un essai (son dossier jetable `sonde-abcd1234`) et ceux d'un
    voisin (`sonde-abcd1235`, et un vrai projet) qui doivent rester."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(os.path.realpath(self.dir.name))
        self.home = base / "claude"
        self.tmp = base / "T"
        self.folder = self.tmp / "sonde-abcd1234"
        self.neighbour = self.tmp / "sonde-abcd1235"
        for folder in (self.folder, self.neighbour):
            folder.mkdir(parents=True)
        sonde.mark_launch(self.folder, "/bin/claude")
        # Le journal de la sonde : chaque ligne porte la session du lancement (`sid`).
        self.write(self.folder / "journaux" / "essai.jsonl",
                   json.dumps({"ev": "session.start", "sid": SESSION}) + "\n" + json.dumps({"ev": "turn.start", "sid": SESSION}) + "\n")
        self.project = self.home / "projects" / sonde.project_dir_name(self.folder)
        self.write(self.project / f"{SESSION}.jsonl", json.dumps({"cwd": str(self.folder)}) + "\n")
        (self.project / SESSION / "subagents").mkdir(parents=True)
        self.agents = self.home / "flow-board" / "agents"
        self.write(self.agents / f"{SESSION}.json", json.dumps({"session": SESSION, "root": str(self.folder)}))
        # Un morceau de registre n'a pas de racine (`RegistryPart`) : il se rattache par sa session.
        self.write(self.agents / f"{SESSION}.1.json", json.dumps({"v": 1, "session": SESSION, "part": 1, "agents": []}))
        self.mission = self.home / "flow-board" / "parcours" / f"{sonde.mission_slug(self.folder)}.json"
        self.write(self.mission, json.dumps({"root": str(self.folder), "runs": []}))
        # Les restes du voisin, et ceux d'un vrai projet : jamais touchés.
        self.kept = [
            self.write(self.home / "projects" / sonde.project_dir_name(self.neighbour) / f"{OTHER}.jsonl",
                       json.dumps({"cwd": str(self.neighbour)}) + "\n"),
            self.write(self.agents / f"{OTHER}.json", json.dumps({"session": OTHER, "root": str(self.neighbour)})),
            self.write(self.home / "flow-board" / "parcours" / f"{sonde.mission_slug(self.neighbour)}.json",
                       json.dumps({"root": str(self.neighbour)})),
            self.write(self.home / "flow-board" / "parcours" / "users-moi-projet.json", json.dumps({"root": "/Users/moi/projet"})),
        ]

    def tearDown(self):
        for path in Path(self.dir.name).rglob("*"):
            if path.is_dir() and not path.is_symlink():
                path.chmod(0o755)
        self.dir.cleanup()

    def write(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def assertNeighboursKept(self):
        for path in self.kept:
            self.assertTrue(path.is_file(), f"{path} supprimé")


class CleanTest(Essai):
    def test_supprime_les_trois_familles_de_ce_lancement_et_rien_d_autre(self):
        report = sonde.clean(self.folder, self.home)
        self.assertIsNone(report.error)
        self.assertFalse(self.project.exists())
        self.assertFalse((self.agents / f"{SESSION}.json").exists())
        self.assertFalse((self.agents / f"{SESSION}.1.json").exists())
        self.assertFalse(self.mission.exists())
        self.assertEqual(len(report.deleted), 4)
        self.assertNeighboursKept()

    def test_garder_ne_supprime_rien_et_liste_ce_qui_reste(self):
        report = sonde.clean(self.folder, self.home, keep=True)
        self.assertEqual(report.deleted, [])
        self.assertTrue(self.project.is_dir() and self.mission.is_file())
        self.assertEqual(len(report.kept), 4)
        self.assertNeighboursKept()

    def test_une_suppression_qui_echoue_s_arrete_et_dit_ce_qui_reste(self):
        self.agents.chmod(0o555)
        report = sonde.clean(self.folder, self.home)
        self.assertIsNotNone(report.error)
        self.assertTrue(self.project.is_dir(), "le dossier de projet part en dernier")
        self.assertTrue(self.mission.is_file())
        self.assertTrue(any(str(self.project) in line for line in report.remaining()))
        self.assertNeighboursKept()

    def test_un_fichier_de_mission_d_un_autre_dossier_au_meme_nom_reste(self):
        # Le nom de fichier de flow-board fusionne les signes : sa racine fait foi.
        self.write(self.mission, json.dumps({"root": str(self.neighbour)}))
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(self.mission.is_file())
        self.assertTrue(any(str(self.mission) in line for line in report.remaining()))

    def test_un_registre_d_une_autre_racine_ou_d_une_session_etrangere_reste(self):
        self.write(self.agents / f"{SESSION}.json", json.dumps({"session": SESSION, "root": str(self.neighbour)}))
        foreign = self.write(self.agents / "1234abcd-1111-2222-3333-444455556666.json",
                             json.dumps({"session": "x", "root": str(self.folder)}))
        sonde.clean(self.folder, self.home)
        self.assertTrue((self.agents / f"{SESSION}.json").is_file())
        self.assertTrue(foreign.is_file(), "un registre dont la session n'a pas de transcript ici reste")

    def test_un_dossier_de_projet_qui_cite_un_autre_dossier_reste(self):
        self.write(self.project / f"{OTHER}.jsonl", json.dumps({"cwd": "/Users/moi/projet"}) + "\n")
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(self.project.is_dir())
        self.assertTrue(any(str(self.project) in line for line in report.remaining()))

    def test_un_dossier_de_projet_en_lien_symbolique_reste(self):
        real = self.home / "ailleurs"
        self.project.rename(real)
        self.project.symlink_to(real, target_is_directory=True)
        sonde.clean(self.folder, self.home)
        self.assertTrue(real.is_dir() and (real / f"{SESSION}.jsonl").is_file())

    def test_un_registre_en_lien_symbolique_reste(self):
        target = self.write(self.home / "precieux.json", json.dumps({"session": SESSION, "root": str(self.folder)}))
        (self.agents / f"{SESSION}.json").unlink()
        (self.agents / f"{SESSION}.json").symlink_to(target)
        sonde.clean(self.folder, self.home)
        self.assertTrue(target.is_file())


class CleanDoubtTest(Essai):
    """Un doute garde la donnée : jamais de suppression sur une absence ou une lecture ratée."""

    def test_un_transcript_sans_dossier_lisible_garde_le_dossier_de_projet(self):
        self.write(self.project / f"{SESSION}.jsonl", "pas du json\n")
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(self.project.is_dir())
        self.assertTrue(any("ne cite aucun dossier" in line for line in report.remaining()))

    def test_un_morceau_d_une_autre_session_ou_a_chiffres_non_ascii_reste(self):
        stranger = self.write(self.agents / f"{SESSION}.2.json", json.dumps({"session": OTHER, "part": 2}))
        wide = self.write(self.agents / f"{SESSION}.{chr(0xFF11)}.json", json.dumps({"session": SESSION}))
        sonde.clean(self.folder, self.home)
        self.assertTrue(stranger.is_file())
        self.assertTrue(wide.is_file())
        self.assertFalse((self.agents / f"{SESSION}.1.json").exists())

    def test_sans_tete_de_registre_de_ce_dossier_les_morceaux_restent(self):
        self.write(self.agents / f"{SESSION}.json", json.dumps({"session": SESSION, "root": str(self.neighbour)}))
        sonde.clean(self.folder, self.home)
        self.assertTrue((self.agents / f"{SESSION}.1.json").is_file())


class LaunchSessionsTest(Essai):
    """Ce lancement se reconnaît aux sessions que son journal nomme, pas au dossier : une session lancée
    ensuite dans le même dossier (un `claude --continue` après un kill-session) n'est pas à lui."""

    def test_une_session_absente_du_journal_garde_le_dossier_de_projet_la_mission_et_son_registre(self):
        later = self.write(self.project / f"{OTHER}.jsonl", json.dumps({"cwd": str(self.folder)}) + "\n")
        reg = self.write(self.agents / f"{OTHER}.json", json.dumps({"session": OTHER, "root": str(self.folder)}))
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(later.is_file())
        self.assertTrue(reg.is_file())
        self.assertTrue(self.mission.is_file(), "la mission peut porter le travail de la session d'après")
        self.assertTrue(any("hors de ce lancement" in line for line in report.remaining()))

    def test_un_dossier_de_session_sans_transcript_de_ce_lancement_garde_le_dossier_de_projet(self):
        self.write(self.project / OTHER / "subagents" / "agent-x.jsonl", json.dumps({"cwd": str(self.folder)}) + "\n")
        sonde.clean(self.folder, self.home)
        self.assertTrue(self.project.is_dir())

    def test_un_transcript_d_agent_qui_cite_un_autre_dossier_garde_le_dossier_de_projet(self):
        self.write(self.project / SESSION / "subagents" / "agent-y.jsonl", json.dumps({"cwd": "/Users/moi/projet"}) + "\n")
        sonde.clean(self.folder, self.home)
        self.assertTrue(self.project.is_dir())

    def test_un_journal_sans_session_ne_supprime_rien(self):
        (self.folder / "journaux" / "essai.jsonl").write_text("{}\n", encoding="utf-8")
        report = sonde.clean(self.folder, self.home)
        self.assertEqual(report.deleted, [])
        self.assertNeighboursKept()


class FinishTest(Essai):
    def args(self, **kw):
        base = dict(nettoyer=str(self.folder), journaux=str(self.folder / "journaux"), apres_session=True,
                    claude="/bin/claude", garder=False)
        base.update(kw)
        return mock.Mock(**base)

    def run_finish(self, args, panes="", code=0, stderr=""):
        def fake(cmd, **kwargs):
            if cmd[1:2] == ["list-panes"]:
                return mock.Mock(returncode=code, stdout=panes, stderr=stderr)
            return mock.Mock(returncode=0, stdout="2.1.317 (Claude Code)\n")
        with mock.patch.object(sonde.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"TMUX_PANE": "%1"}):
            return sonde.finish(args, "tmux", home=self.home, tmp=self.tmp)

    def log(self):
        return (self.folder / "journaux" / sonde.LOG_NAME).read_text(encoding="utf-8")

    def test_l_etape_de_fin_ecrit_la_version_puis_le_nettoyage(self):
        self.assertEqual(self.run_finish(self.args(), panes=f"%1 {self.folder}\n"), 0)
        log = self.log()
        self.assertIn("après l'essai : 2.1.317", log)
        self.assertIn("supprimé :", log)
        self.assertFalse(self.project.exists())

    def test_un_autre_volet_dans_le_dossier_bloque_tout_et_le_journal_le_dit(self):
        with self.assertRaises(sonde.SondeError):
            self.run_finish(self.args(), panes=f"%1 {self.folder}\n%7 {self.folder}/sous-dossier\n")
        self.assertTrue(self.project.is_dir())
        self.assertIn("après l'essai", self.log())
        self.assertIn("nettoyage refusé", self.log())

    def test_une_lecture_de_tmux_ratee_bloque_tout(self):
        with self.assertRaises(sonde.SondeError):
            self.run_finish(self.args(), code=1, stderr="error connecting")
        self.assertTrue(self.project.is_dir())

    def test_un_dossier_refuse_laisse_quand_meme_la_version_au_journal(self):
        (self.folder / sonde.MARKER).unlink()
        with self.assertRaises(sonde.SondeError):
            self.run_finish(self.args())
        self.assertIn("après l'essai", self.log())
        self.assertIn("nettoyage refusé", self.log())
        self.assertTrue(self.project.is_dir())

    def test_une_lecture_impossible_pendant_le_plan_est_un_refus_journalise(self):
        with mock.patch.object(sonde, "plan", side_effect=PermissionError("refusé")):
            with self.assertRaises(sonde.SondeError):
                self.run_finish(self.args(), panes=f"%1 {self.folder}\n")
        self.assertIn("nettoyage refusé", self.log())

    def test_a_la_main_aucun_volet_n_est_exclu(self):
        with self.assertRaises(sonde.SondeError):
            self.run_finish(self.args(apres_session=False, nettoyer="sonde-abcd1234", journaux=None, claude=None),
                            panes=f"%1 {self.folder}\n")


class LaunchFolderTest(Essai):
    def test_un_dossier_repris_par_dir_est_refuse(self):
        (self.folder / sonde.REUSED).write_text("x\n", encoding="utf-8")
        with self.assertRaises(sonde.SondeError):
            sonde.launch_folder("sonde-abcd1234", self.tmp)

    def test_le_chemin_absolu_de_l_etape_de_fin_est_accepte(self):
        self.assertEqual(sonde.launch_folder(str(self.folder)), self.folder)
        with self.assertRaises(sonde.SondeError):
            sonde.launch_folder(str(self.home))

    def test_une_copie_du_dossier_jetable_avec_sa_marque_est_refusee(self):
        copy = self.home.parent / "essais" / "sonde-abcd1234"
        copy.mkdir(parents=True)
        (copy / sonde.MARKER).write_bytes((self.folder / sonde.MARKER).read_bytes())
        with self.assertRaises(sonde.SondeError):
            sonde.launch_folder(str(copy))
        with self.assertRaises(sonde.SondeError):
            sonde.launch_folder("sonde-abcd1234", copy.parent)

    def test_un_lancement_dir_ne_marque_la_reprise_qu_une_fois_lance(self):
        sonde.mark_reused(self.folder)
        self.assertTrue((self.folder / sonde.REUSED).is_file())
        fresh = self.tmp / "sonde-neuf0001"
        fresh.mkdir()
        sonde.mark_reused(fresh)
        self.assertFalse((fresh / sonde.REUSED).exists(), "sans marque de lancement, rien à signaler")

    def test_seul_un_dossier_jetable_neuf_est_nettoye(self):
        self.assertEqual(sonde.clean_target(self.folder, None, []), self.folder)
        self.assertIsNone(sonde.clean_target(self.folder, Path("/x"), []))
        self.assertIsNone(sonde.clean_target(self.folder, None, ["CLAUDE_CONFIG_DIR=/ailleurs"]))
        self.assertIsNone(sonde.clean_target(self.tmp / "sonde-journaux-abcd1234", None, []))

    def test_seul_un_dossier_jetable_de_ce_lancement_est_accepte(self):
        self.assertEqual(sonde.launch_folder("sonde-abcd1234", self.tmp), self.folder)
        for name in ("sonde-abcd1235", "../claude", "/", "", "sonde-journaux-abcd1234", "sonde-abcd123", "sonde-ABCD1234",
                     "sonde-abcd1234/..", "projet"):
            with self.subTest(name=name):
                with self.assertRaises(sonde.SondeError):
                    sonde.launch_folder(name, self.tmp)

    def test_un_dossier_jetable_en_lien_symbolique_est_refuse(self):
        link = self.tmp / "sonde-zzzz1234"
        link.symlink_to(self.folder, target_is_directory=True)
        with self.assertRaises(sonde.SondeError):
            sonde.launch_folder("sonde-zzzz1234", self.tmp)


class CommandTest(unittest.TestCase):
    def test_la_session_finit_par_le_nettoyage_seulement_dans_un_dossier_jetable(self):
        common = dict(tmux="tmux", name="sonde", journals=Path("/j"), claude="/bin/claude", plugins=[], env=[],
                      model="haiku", effort="low", resume=False)
        jetable = sonde.session_command(folder=Path("/T/sonde-abcd1234"), clean_name=Path("/T/sonde-abcd1234"), keep=False, **common)
        script = jetable[-1]
        self.assertIn("--apres-session", script)
        self.assertIn("--nettoyer /T/sonde-abcd1234", script)
        self.assertIn("read _", script)
        kept = sonde.session_command(folder=Path("/T/sonde-abcd1234"), clean_name=Path("/T/sonde-abcd1234"), keep=True, **common)
        self.assertIn("--garder", kept[-1])
        given = sonde.session_command(folder=Path("/projet"), clean_name=None, keep=False, **common)
        self.assertIn("--apres-session", given[-1])
        self.assertNotIn("--nettoyer", given[-1])

    def test_la_fin_de_nom_d_un_morceau_passe_le_corpus_hostile(self):
        hostile = ["\x00", "\x1b", "\x85", " ", "​", "﻿", "１", "١", "1" * 7, "../1", "1/2", "-1", "1 "]
        for token in hostile:
            with self.subTest(token=repr(token)):
                self.assertIsNone(sonde.CHUNK.fullmatch(f".{token}.json"))
        self.assertIsNotNone(sonde.CHUNK.fullmatch(".12.json"))

    def test_le_journal_porte_la_version_de_claude(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(sonde.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="2.1.316 (Claude Code)\n")):
                sonde.log_version(Path(d), "/bin/claude", "avant")
            text = (Path(d) / sonde.LOG_NAME).read_text(encoding="utf-8")
            self.assertIn("avant", text)
            self.assertIn("2.1.316 (Claude Code)", text)


if __name__ == "__main__":
    unittest.main()
