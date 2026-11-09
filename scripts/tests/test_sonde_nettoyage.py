"""Tests du nettoyage de la sonde (scripts/sonde.py) : à la fin d'un essai, il ne supprime sous
`~/.claude` que ce que ce lancement a créé, repéré par le nom de son dossier jetable ou par l'identifiant
de sa session. Tout se joue sur
un faux `~/.claude` et un faux dossier temporaire : python3 -m unittest discover -s scripts/tests."""

import io
import json
import os
import sys
import tempfile
import time
import types
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
        # Fermé aux autres comme `mkdtemp` le crée, quel que soit l'umask du poste.
        self.folder.chmod(0o700)
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
        # Fermée aux autres comme l'original : c'est la marque qui doit la faire refuser, pas l'umask.
        copy.chmod(0o700)
        (copy / sonde.MARKER).write_bytes((self.folder / sonde.MARKER).read_bytes())
        (copy / sonde.MARKER).chmod(0o600)
        with self.assertRaisesRegex(sonde.SondeError, "copie"):
            sonde.launch_folder(str(copy))
        with self.assertRaisesRegex(sonde.SondeError, "copie"):
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

    @unittest.skipUnless(hasattr(os, "getuid"), "droits POSIX")
    def test_la_marque_posee_par_le_lancement_est_fermee_aux_autres(self):
        # Même sous un umask large (002), la marque d'un lancement normal passe le contrôle des droits.
        fresh = self.tmp / "sonde-umask002"
        fresh.mkdir(mode=0o700)
        old = os.umask(0o002)
        try:
            sonde.mark_launch(fresh, "/bin/claude")
        finally:
            os.umask(old)
        self.assertEqual((fresh / sonde.MARKER).stat().st_mode & 0o077, 0)
        self.assertEqual(sonde.launch_folder("sonde-umask002", self.tmp), fresh)


@unittest.skipUnless(hasattr(os, "getuid"), "propriétaire et droits POSIX")
class DroitsTest(Essai):
    """Un dossier jetable qu'un autre compte du poste aurait pu poser ou modifier (propriétaire étranger,
    dossier ou marque ouverts en écriture au groupe ou aux autres) est refusé : rien ne se supprime."""

    args = FinishTest.args
    run_finish = FinishTest.run_finish

    def assertRefused(self, reason):
        with self.assertRaises(sonde.SondeError) as caught:
            self.run_finish(self.args(), panes=f"%1 {self.folder}\n")
        message = str(caught.exception)
        self.assertIn(reason, message)
        self.assertIn(str(self.folder), message)
        self.assertTrue(self.project.is_dir())
        self.assertTrue((self.agents / f"{SESSION}.json").is_file())
        self.assertTrue(self.mission.is_file())
        self.assertNeighboursKept()

    def test_un_dossier_ouvert_en_ecriture_au_groupe_ou_aux_autres_est_refuse(self):
        for mode in (0o770, 0o777, 0o702):
            with self.subTest(mode=oct(mode)):
                self.folder.chmod(mode)
                self.assertRefused("écriture")
        self.folder.chmod(0o700)

    def test_une_marque_ouverte_en_ecriture_au_groupe_ou_aux_autres_est_refusee(self):
        marker = self.folder / sonde.MARKER
        for mode in (0o660, 0o666, 0o602):
            with self.subTest(mode=oct(mode)):
                marker.chmod(mode)
                with self.assertRaises(sonde.SondeError) as caught:
                    sonde.launch_folder("sonde-abcd1234", self.tmp)
                self.assertIn(sonde.MARKER, str(caught.exception))
                self.assertIn("écriture", str(caught.exception))
        marker.chmod(0o600)
        self.assertEqual(sonde.launch_folder("sonde-abcd1234", self.tmp), self.folder)

    def foreign_owner(self, target):
        """`os.lstat` remplacé : `target` appartient à un autre compte, le reste est lu tel quel."""
        real = os.lstat

        def fake(path, *args, **kwargs):
            st = real(path, *args, **kwargs)
            if os.fspath(path) == os.fspath(target):
                fields = list(st)
                fields[4] = os.getuid() + 1  # st_uid
                return os.stat_result(fields)
            return st
        return mock.patch.object(sonde.os, "lstat", side_effect=fake)

    def test_un_dossier_d_un_autre_proprietaire_est_refuse(self):
        with self.foreign_owner(self.folder):
            self.assertRefused("autre compte")

    def test_une_marque_d_un_autre_proprietaire_est_refusee(self):
        with self.foreign_owner(self.folder / sonde.MARKER):
            with self.assertRaises(sonde.SondeError) as caught:
                sonde.launch_folder("sonde-abcd1234", self.tmp)
        self.assertIn("autre compte", str(caught.exception))
        self.assertIn(sonde.MARKER, str(caught.exception))
        self.assertNotIn("chmod", str(caught.exception), "aucun chmod conseillé : la marque a pu être modifiée")

    def test_un_dossier_disparu_pendant_le_controle_est_un_refus_pas_une_trace(self):
        real = os.lstat

        def vanished(path, *args, **kwargs):
            if os.fspath(path) == os.fspath(self.folder):
                raise FileNotFoundError(2, "No such file or directory", os.fspath(path))
            return real(path, *args, **kwargs)
        with mock.patch.object(sonde.os, "lstat", side_effect=vanished):
            with self.assertRaisesRegex(sonde.SondeError, "illisible"):
                sonde.launch_folder("sonde-abcd1234", self.tmp)


A = "aaaaaaaa-1111-2222-3333-444455556666"
B = "bbbbbbbb-1111-2222-3333-444455556666"
C = "cccccccc-1111-2222-3333-444455556666"


class SessionTracesTest(Essai):
    """Les traces de ses sessions, repérées par leur id : `session-env/<id>/` et les relevés de stats-board
    `stats-board/requetes/<id>_<heure en ms>.json`, pour les sessions que le lancement a ouvertes, nées
    dans sa fenêtre (de sa marque à la dernière écriture de son journal)."""

    def setUp(self):
        super().setUp()
        # Une heure d'ouverture dans la fenêtre : juste après la marque.
        self.ms = os.lstat(self.folder / sonde.MARKER).st_mtime_ns // 1_000_000 + 1

    def journal(self, *lines):
        self.write(self.folder / "journaux" / "essai.jsonl", "".join(json.dumps(line) + "\n" for line in lines))

    def opened(self, *sids, source="startup"):
        self.journal(*[{"ev": "classic.SessionStart", "sid": sid, "source": source} for sid in sids])

    def settle(self):
        """La dernière écriture du journal, après les traces posées par le test : la fin de la fenêtre."""
        later = time.time_ns() + 1_000_000_000
        os.utime(self.folder / "journaux" / "essai.jsonl", ns=(later, later))

    def env(self, sid):
        path = self.home / "session-env" / sid
        path.mkdir(parents=True, exist_ok=True)
        return path

    def req(self, name):
        return self.write(self.home / "stats-board" / "requetes" / name, "{}")

    def test_supprime_session_env_et_releves_des_sessions_du_lancement_seulement(self):
        self.opened(A, B)
        mine = [self.env(A), self.env(B), self.req(f"{A}_{self.ms}.json"), self.req(f"{B}_{self.ms + 1}.json")]
        (mine[0] / "x").write_text("x", encoding="utf-8")
        others = [self.env(C), self.req(f"{C}_{self.ms}.json"), self.req(f"{A}_{self.ms}.json.bak"), self.req(f"{A}_x.json")]
        self.settle()
        report = sonde.clean(self.folder, self.home)
        self.assertIsNone(report.error)
        for path in mine:
            self.assertFalse(path.exists(), f"{path} gardé")
            self.assertIn(str(path), report.deleted)
        for path in others:
            self.assertTrue(path.exists(), f"{path} supprimé")
        self.assertNeighboursKept()

    def test_les_traces_nees_hors_de_la_fenetre_du_lancement_restent(self):
        # La même session reprise après le lancement hors de la sonde (`claude --continue` dans le dossier
        # jetable), ou un id hérité d'une session plus ancienne : ses relevés et son session-env sont hors
        # de la fenêtre.
        self.opened(A, B)
        before = self.req(f"{A}_123.json")
        env_b = self.env(B)
        self.settle()
        end = os.lstat(self.folder / "journaux" / "essai.jsonl").st_mtime_ns
        after = self.req(f"{A}_{end // 1_000_000 + 60_000}.json")
        old = 1_000_000_000
        os.utime(env_b, ns=(old, old))
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(before.is_file())
        self.assertTrue(after.is_file())
        self.assertTrue(env_b.is_dir())
        remaining = " ".join(report.remaining())
        for path in (before, after, env_b):
            self.assertIn(str(path), remaining)

    def test_les_traces_partent_avant_le_dossier_de_projet(self):
        self.journal({"ev": "classic.SessionStart", "sid": SESSION, "source": "startup"})
        env, req = self.env(SESSION), self.req(f"{SESSION}_{self.ms}.json")
        self.settle()
        todo, _ = sonde.plan(self.folder, self.home)
        order = [p for p, _ in todo]
        self.assertLess(order.index(env), order.index(self.project))
        self.assertLess(order.index(req), order.index(self.project))
        self.assertEqual(order[-1], self.project)

    def test_une_session_reprise_dans_la_sonde_n_est_pas_a_ce_lancement(self):
        # Une vraie session d'ailleurs, reprise dans la sonde (`/resume`) : son id entre dans le journal,
        # mais ses traces sont d'avant le lancement.
        self.journal({"ev": "classic.SessionStart", "sid": A, "source": "startup"},
                     {"ev": "classic.SessionStart", "sid": B, "source": "resume"},
                     {"ev": "turn.start", "sid": B})
        env_b, req_b = self.env(B), self.req(f"{B}_{self.ms}.json")
        env_a = self.env(A)
        self.settle()
        sonde.clean(self.folder, self.home)
        self.assertTrue(env_b.is_dir())
        self.assertTrue(req_b.is_file())
        self.assertFalse(env_a.exists())

    def test_une_session_ouverte_par_clear_est_a_ce_lancement(self):
        self.journal({"ev": "classic.SessionStart", "sid": A, "source": "startup"},
                     {"ev": "classic.SessionStart", "sid": B, "source": "clear"})
        env_b = self.env(B)
        self.settle()
        sonde.clean(self.folder, self.home)
        self.assertFalse(env_b.exists())

    def test_une_compaction_seule_n_ouvre_pas_de_session(self):
        self.journal({"ev": "classic.SessionStart", "sid": A, "source": "compact"},
                     {"ev": "classic.SessionStart", "sid": B, "source": "startup"})
        env_a, env_b = self.env(A), self.env(B)
        self.settle()
        sonde.clean(self.folder, self.home)
        self.assertFalse(env_b.exists(), "le nettoyage des traces a bien tourné")
        self.assertTrue(env_a.is_dir())

    def test_un_session_env_qui_porte_une_entree_d_avant_le_lancement_reste(self):
        # Un id hérité d'une session existante (`--env CLAUDE_CODE_SESSION_ID=…`) : son session-env/<id>
        # porte déjà des fichiers d'avant la marque, puis la sonde y écrit (le dossier du haut change de date).
        self.opened(A)
        env = self.env(A)
        old_file = env / "ancien"
        old_file.write_text("de la session d'origine", encoding="utf-8")
        old = 1_000_000_000
        os.utime(old_file, ns=(old, old))
        (env / "neuf").write_text("x", encoding="utf-8")
        self.settle()
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(old_file.is_file())
        self.assertIn(str(env), " ".join(report.remaining()))

    def test_sans_date_de_creation_un_session_env_n_est_jamais_pris(self):
        # Linux : la date de modification seule ne dit pas qui a créé l'entrée (un id hérité, réécrit).
        start = os.lstat(self.folder / sonde.MARKER).st_mtime_ns
        window = (start, start + 10**9)
        linux = types.SimpleNamespace(st_mtime_ns=start + 1)
        self.assertFalse(sonde.born_in(linux, window))
        self.assertTrue(sonde.born_in(types.SimpleNamespace(st_mtime_ns=start + 1, st_birthtime_ns=start + 1), window))

    def test_un_session_env_qui_change_entre_le_releve_et_l_effacement_reste(self):
        self.opened(A)
        env = self.env(A)
        self.settle()
        real = sonde.plan

        def plan_then_resume(folder, home):
            result = real(folder, home)
            # Une session reprise ailleurs écrit dans session-env/A après le relevé.
            late = self.write(env / "repris", "x")
            future = time.time_ns() + 10 * 10**9
            os.utime(late, ns=(future, future))
            return result
        with mock.patch.object(sonde, "plan", side_effect=plan_then_resume):
            report = sonde.clean(self.folder, self.home)
        self.assertTrue((env / "repris").is_file())
        self.assertIsNotNone(report.error)
        self.assertIn("changé depuis le relevé", report.error)

    def test_une_fenetre_illisible_ne_prend_rien_et_le_dit(self):
        self.opened(A)
        env = self.env(A)
        late = 1_000_000_000
        os.utime(self.folder / "journaux" / "essai.jsonl", ns=(late, late))  # horloge revenue en arrière
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(env.is_dir())
        self.assertIn("fenêtre du lancement illisible", " ".join(report.remaining()))

    @unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
    def test_un_lien_est_garde_nomme_et_sa_cible_intacte(self):
        self.opened(A, B)
        target = self.home.parent / "precieux"
        target.mkdir()
        (target / "garde.txt").write_text("x", encoding="utf-8")
        (self.home / "session-env").mkdir(parents=True)
        (self.home / "session-env" / A).symlink_to(target, target_is_directory=True)
        nested = self.env(B)
        (nested / "lien").symlink_to(target, target_is_directory=True)
        precious = self.write(self.home.parent / "releve.json", "{}")
        (self.home / "stats-board" / "requetes").mkdir(parents=True)
        link = self.home / "stats-board" / "requetes" / f"{A}_{self.ms}.json"
        link.symlink_to(precious)
        self.settle()
        report = sonde.clean(self.folder, self.home)
        self.assertTrue((target / "garde.txt").is_file())
        self.assertTrue(precious.is_file())
        self.assertTrue((self.home / "session-env" / A).is_symlink())
        self.assertTrue((nested / "lien").is_symlink())
        self.assertTrue(link.is_symlink())
        remaining = " ".join(report.remaining())
        for path in (self.home / "session-env" / A, nested, link):
            self.assertIn(str(path), remaining)

    @unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
    def test_un_dossier_parent_en_lien_garde_ses_traces(self):
        self.opened(A)
        elsewhere = self.home.parent / "ailleurs"
        (elsewhere / A).mkdir(parents=True)
        (self.home / "session-env").symlink_to(elsewhere, target_is_directory=True)
        real_stats = self.home.parent / "stats"
        (real_stats / "requetes").mkdir(parents=True)
        (real_stats / "requetes" / f"{A}_{self.ms}.json").write_text("{}", encoding="utf-8")
        (self.home / "stats-board").symlink_to(real_stats, target_is_directory=True)
        self.settle()
        report = sonde.clean(self.folder, self.home)
        self.assertTrue((elsewhere / A).is_dir())
        self.assertTrue((real_stats / "requetes" / f"{A}_{self.ms}.json").is_file())
        remaining = " ".join(report.remaining())
        self.assertIn(str(self.home / "session-env"), remaining)
        self.assertIn(str(self.home / "stats-board"), remaining)

    @unittest.skipIf(not hasattr(os, "geteuid") or os.geteuid() == 0, "droits POSIX (root lit tout)")
    def test_un_session_env_illisible_ou_non_effacable_est_garde_et_le_reste_part(self):
        for mode in (0o000, 0o400, 0o500):
            with self.subTest(mode=oct(mode)):
                self.opened(A)
                locked = self.env(A) / "sous"
                locked.mkdir(exist_ok=True)
                (locked / "f").write_text("x", encoding="utf-8")
                req = self.req(f"{A}_{self.ms}.json")
                self.settle()
                locked.chmod(mode)
                try:
                    report = sonde.clean(self.folder, self.home)
                finally:
                    locked.chmod(0o700)
                self.assertIsNone(report.error)
                self.assertTrue((locked / "f").is_file())
                self.assertFalse(req.exists(), "les autres traces partent")
                self.assertIn(str(self.home / "session-env" / A), " ".join(report.remaining()))

    @unittest.skipIf(not hasattr(os, "geteuid") or os.geteuid() == 0, "droits POSIX (root lit tout)")
    def test_un_dossier_parent_illisible_garde_ses_traces_et_le_reste_part(self):
        self.opened(SESSION)
        self.req(f"{SESSION}_{self.ms}.json")
        self.settle()
        stats = self.home / "stats-board"
        stats.chmod(0o000)
        try:
            report = sonde.clean(self.folder, self.home)
        finally:
            stats.chmod(0o700)
        self.assertIsNone(report.error)
        self.assertFalse(self.project.exists(), "le reste du nettoyage passe")
        self.assertIn(str(stats), " ".join(report.remaining()))

    def test_garder_liste_les_nouvelles_traces_sans_rien_supprimer(self):
        self.opened(A)
        env, req = self.env(A), self.req(f"{A}_{self.ms}.json")
        self.settle()
        report = sonde.clean(self.folder, self.home, keep=True)
        self.assertEqual(report.deleted, [])
        self.assertTrue(env.is_dir() and req.is_file())
        kept = " ".join(report.kept)
        self.assertIn(f"{env} (--garder)", kept)
        self.assertIn(f"{req} (--garder)", kept)

    def test_un_journal_sans_session_ne_supprime_rien_sous_session_env_ni_requetes(self):
        self.journal({"ev": "classic.SessionStart", "sid": "pas-un-id", "source": "startup"}, {"ev": "x"})
        env, req = self.env(A), self.req(f"{A}_{self.ms}.json")
        loose = self.req(f"pas-un-id_{self.ms}.json")
        self.settle()
        sonde.clean(self.folder, self.home)
        self.assertTrue(env.is_dir() and req.is_file() and loose.is_file())

    def test_claude_json_n_est_ni_lu_ni_ecrit(self):
        self.opened(A)
        env = self.env(A)
        config = self.write(self.home.parent / ".claude.json", '{"projects": {}, "jeton": "secret"}')
        inside = self.write(self.home / ".claude.json", '{"x": 1}')
        self.settle()
        before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in (config, inside)]
        opened = []
        real_open = io.open

        def spy(file, *args, **kwargs):
            opened.append(os.fspath(file) if isinstance(file, (str, os.PathLike)) else file)
            return real_open(file, *args, **kwargs)
        with mock.patch("io.open", side_effect=spy), mock.patch("builtins.open", side_effect=spy):
            report = sonde.clean(self.folder, self.home)
        self.assertFalse(env.exists(), "le nettoyage des traces a bien tourné")
        self.assertEqual([(p.read_bytes(), p.stat().st_mtime_ns) for p in (config, inside)], before)
        self.assertFalse([f for f in opened if isinstance(f, str) and f.endswith(".claude.json")], opened)
        self.assertNotIn("secret", " ".join(report.lines()))


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
                # Sept chiffres ASCII : hors des morceaux (6 au plus), une heure valide pour un relevé.
                if not (token.isascii() and token.isdigit()):
                    self.assertIsNone(sonde.REQUEST.fullmatch(f"_{token}.json"))
        self.assertIsNotNone(sonde.CHUNK.fullmatch(".12.json"))
        self.assertIsNone(sonde.REQUEST.fullmatch("_" + "1" * 21 + ".json"))
        self.assertIsNotNone(sonde.REQUEST.fullmatch("_1762600000000.json"))

    def test_le_journal_porte_la_version_de_claude(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(sonde.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="2.1.316 (Claude Code)\n")):
                sonde.log_version(Path(d), "/bin/claude", "avant")
            text = (Path(d) / sonde.LOG_NAME).read_text(encoding="utf-8")
            self.assertIn("avant", text)
            self.assertIn("2.1.316 (Claude Code)", text)


if __name__ == "__main__":
    unittest.main()
