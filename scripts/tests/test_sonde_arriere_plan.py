"""Tests du mode d'arrière-plan de la sonde (scripts/sonde.py, `--arriere-plan`, `--arreter`, `--retirer`) :
`claude stop` et `claude rm` ne visent que la session dont l'id court est noté dans le dossier jetable, et le
nettoyage ne supprime sous `~/.claude` que ce que ce lancement a créé, repéré par le nom de son dossier jetable
ou par l'identifiant de sa session, jamais un fichier de la session qui a lancé la sonde. Tout se joue sur un
faux `~/.claude`, un faux dossier temporaire et un faux `claude` : python3 -m unittest discover -s scripts/tests."""

import argparse
import io
import json
import os
import sys
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sonde  # noqa: E402
from test_journal_mission import DOTS, PIECES  # noqa: E402  (le corpus hostile commun des tests Python)
from test_sonde_nettoyage import OTHER, SESSION, Essai  # noqa: E402

SHORT = SESSION[:8]
# La session qui lance la sonde : ses fichiers restent, quoi qu'il arrive.
LAUNCHER = "5e5e5e5e-1111-2222-3333-444455556666"
# Une autre session dont l'id commence comme celui de la session du lancement.
TWIN = f"{SHORT}-9999-8888-7777-666655554444"
NOW_NS = time.time_ns()


class Fake:
    """Un faux `claude` : chaque appel est noté ; `stop` et `rm` répondent leur code ; `agents` liste `sessions`
    (un `rm` réussi en retire l'id), ou rend `agents` tel quel (texte brut), avec `agents_code` ; `after_rm`,
    s'il est donné, est la sortie brute d'`agents` une fois le `rm` passé."""

    def __init__(self, stop=0, rm=0, sessions=(), agents=None, agents_code=0, after_rm=None, bg=None):
        self.calls, self.stop, self.rm, self.bg = [], stop, rm, bg
        self.sessions, self.agents, self.agents_code, self.after_rm = list(sessions), agents, agents_code, after_rm
        self.removed = False

    def __call__(self, cmd, **kwargs):
        self.calls.append((list(cmd), kwargs))
        verb = cmd[1] if len(cmd) > 1 else ""
        if verb == "stop":
            return mock.Mock(returncode=self.stop, stdout=f"stopped {cmd[2]}\n" if not self.stop else "", stderr="" if not self.stop else "no such session\n")
        if verb == "rm":
            if not self.rm:
                self.removed = True
                self.sessions = [s for s in self.sessions if s.get("id") != cmd[2]]
            return mock.Mock(returncode=self.rm, stdout=f"removed {cmd[2]}\n" if not self.rm else "", stderr="" if not self.rm else "not safe\n")
        if verb == "agents":
            raw = self.after_rm if self.removed and self.after_rm is not None else self.agents
            return mock.Mock(returncode=self.agents_code, stdout=json.dumps(self.sessions) if raw is None else raw, stderr="")
        if verb == "--bg":
            return self.bg
        return mock.Mock(returncode=0, stdout="2.1.329 (Claude Code)\n", stderr="")

    def verbs(self):
        return [c[1:] for c, _ in self.calls if len(c) > 1 and c[1] in ("stop", "rm")]


class BackgroundEssai(Essai):
    """Le faux `~/.claude` d'`Essai`, mais pour un lancement en arrière-plan : pas de journal de la sonde, l'id
    court noté à côté de la marque, la session retirée (`REMOVED`) et un relevé de stats-board dans la fenêtre."""

    def setUp(self):
        super().setUp()
        (self.folder / "journaux" / "essai.jsonl").unlink()
        self.claude = os.path.realpath(sys.executable)
        self.remark(LAUNCHER)
        sonde.write_private(self.folder / sonde.BACKGROUND, {"court": SHORT})
        self.request = self.req(SESSION, NOW_NS - 50_000_000_000)
        self.launcher_request = self.req(LAUNCHER, NOW_NS - 40_000_000_000)
        self.launcher_registry = self.write(self.agents / f"{LAUNCHER}.json",
                                            json.dumps({"session": LAUNCHER, "root": "/Users/moi/projet"}))
        self.retire()

    def remark(self, launcher, raw=False):
        marker = self.folder / sonde.MARKER
        marker.unlink()
        if raw:
            sonde.write_private(marker, {"dossier": os.path.realpath(self.folder), "claude": self.claude})
        else:
            sonde.mark_launch(self.folder, self.claude, launcher=launcher)
        os.utime(marker, ns=(NOW_NS - 100_000_000_000, NOW_NS - 100_000_000_000))

    def retire(self):
        removed = self.folder / sonde.REMOVED
        if not removed.exists():
            sonde.write_private(removed, {"court": SHORT})
        os.utime(removed, ns=(NOW_NS, NOW_NS))

    def unretire(self):
        (self.folder / sonde.REMOVED).unlink()

    def req(self, session, ns):
        return self.write(self.home / "stats-board" / "requetes" / f"{session}_{ns // 1_000_000}.json", "{}")

    def renote(self, data, raw=None):
        path = self.folder / sonde.BACKGROUND
        path.unlink()
        if raw is not None:
            path.write_text(raw, encoding="utf-8")
            path.chmod(0o600)
        else:
            sonde.write_private(path, data)

    def ours(self):
        return [self.agents / f"{SESSION}.json", self.agents / f"{SESSION}.1.json", self.request, self.mission, self.project]

    def assertNothingDeleted(self, report=None):
        if report is not None:
            self.assertEqual(report.deleted, [])
        for path in self.ours():
            self.assertTrue(path.exists(), f"{path} supprimé")
        self.assertLauncherKept()
        self.assertNeighboursKept()

    def assertLauncherKept(self):
        self.assertTrue(self.launcher_request.is_file())
        self.assertTrue(self.launcher_registry.is_file())

    def log(self):
        return (self.folder / "journaux" / sonde.LOG_NAME).read_text(encoding="utf-8")


class BackgroundPlanTest(BackgroundEssai):
    def test_les_restes_d_une_session_d_arriere_plan_partent_et_rien_d_autre(self):
        report = sonde.clean(self.folder, self.home)
        self.assertIsNone(report.error)
        for path in self.ours():
            self.assertFalse(path.exists(), f"{path} resté")
        self.assertEqual(len(report.deleted), 5)
        self.assertLauncherKept()
        self.assertNeighboursKept()
        self.assertTrue((self.folder / sonde.MARKER).is_file(), "le dossier jetable lui-même n'est pas touché")

    def test_une_autre_session_du_dossier_garde_le_dossier_de_projet_et_la_mission(self):
        later = self.write(self.project / f"{OTHER}.jsonl", json.dumps({"cwd": str(self.folder)}) + "\n")
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(later.is_file() and self.project.is_dir() and self.mission.is_file())
        self.assertTrue(any("hors de ce lancement" in line for line in report.remaining()))

    def test_deux_sessions_au_meme_id_court_ne_suppriment_rien(self):
        self.write(self.project / f"{TWIN}.jsonl", json.dumps({"cwd": str(self.folder)}) + "\n")
        report = sonde.clean(self.folder, self.home)
        self.assertNothingDeleted(report)
        self.assertTrue(any("2 sessions" in line for line in report.remaining()))

    def test_un_registre_au_meme_id_court_d_une_autre_racine_ne_compte_pas_et_reste(self):
        twin = self.write(self.agents / f"{TWIN}.json", json.dumps({"session": TWIN, "root": str(self.neighbour)}))
        sonde.clean(self.folder, self.home)
        self.assertTrue(twin.is_file())
        self.assertFalse(self.project.exists())

    def test_un_registre_au_meme_id_court_de_ce_dossier_compte_et_rien_ne_part(self):
        self.write(self.agents / f"{TWIN}.json", json.dumps({"session": TWIN, "root": str(self.folder)}))
        self.assertNothingDeleted(sonde.clean(self.folder, self.home))

    def test_sans_transcript_ni_registre_de_l_id_court_rien_ne_part(self):
        (self.project / f"{SESSION}.jsonl").unlink()
        (self.project / SESSION / "subagents").rmdir()
        (self.project / SESSION).rmdir()
        (self.agents / f"{SESSION}.json").unlink()
        report = sonde.clean(self.folder, self.home)
        self.assertEqual(report.deleted, [])
        self.assertTrue(any("aucune session" in line for line in report.remaining()))

    def test_un_releve_hors_de_la_fenetre_reste(self):
        before = self.req(SESSION, NOW_NS - 500_000_000_000)
        after = self.req(SESSION, NOW_NS + 500_000_000_000)
        report = sonde.clean(self.folder, self.home)
        self.assertTrue(before.is_file() and after.is_file())
        self.assertFalse(self.request.exists())
        self.assertTrue(any("hors de la fenêtre" in line for line in report.remaining()))

    def test_sans_retrait_rien_n_est_supprime_et_c_est_dit(self):
        self.unretire()
        report = sonde.clean(self.folder, self.home)
        self.assertNothingDeleted(report)
        self.assertTrue(any("pas retirée" in line for line in report.remaining()))

    def test_un_retrait_d_avant_la_marque_ne_supprime_rien(self):
        os.utime(self.folder / sonde.REMOVED, ns=(NOW_NS - 200_000_000_000, NOW_NS - 200_000_000_000))
        self.assertNothingDeleted(sonde.clean(self.folder, self.home))

    def test_un_id_court_absent_ou_hors_forme_ne_supprime_rien(self):
        pieces = [*PIECES, DOTS, chr(0x661), "é"]
        hostile = [*(SHORT + p for p in pieces), *(SHORT[:4] + p + SHORT[5:] for p in pieces), SHORT.upper(), SESSION,
                   SHORT[:7], "", None, 42, [], {}]
        for value in hostile:
            with self.subTest(value=repr(value)[:40]):
                self.renote({"court": value})
                self.assertEqual(sonde.background_state(self.folder)[0], "douteux")
                self.assertNothingDeleted(sonde.clean(self.folder, self.home))
        for raw in ("pas du json", "[]", json.dumps({"autre": SHORT})):
            with self.subTest(raw=raw):
                self.renote(None, raw=raw)
                self.assertNothingDeleted(sonde.clean(self.folder, self.home))

    @unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
    def test_un_id_note_en_lien_symbolique_ne_supprime_rien(self):
        target = self.write(self.tmp / "ailleurs.json", json.dumps({"court": SHORT}))
        (self.folder / sonde.BACKGROUND).unlink()
        (self.folder / sonde.BACKGROUND).symlink_to(target)
        self.assertEqual(sonde.background_state(self.folder)[0], "douteux")
        self.assertNothingDeleted(sonde.clean(self.folder, self.home))

    @unittest.skipIf(os.name == "nt", "droits POSIX factices sous Windows")
    def test_un_id_note_ouvert_en_ecriture_au_groupe_ne_supprime_rien(self):
        (self.folder / sonde.BACKGROUND).chmod(0o620)
        self.assertEqual(sonde.background_state(self.folder)[0], "douteux")
        self.assertNothingDeleted(sonde.clean(self.folder, self.home))

    def test_une_marque_sans_lanceur_ne_supprime_rien(self):
        self.remark(None, raw=True)
        self.assertNothingDeleted(sonde.clean(self.folder, self.home))

    def test_la_session_du_lanceur_n_est_jamais_prise(self):
        self.remark(SESSION)
        report = sonde.clean(self.folder, self.home)
        self.assertNothingDeleted(report)
        self.assertTrue(any("lancé la sonde" in line for line in report.remaining()))

    def test_session_env_n_est_pas_une_famille_d_arriere_plan(self):
        env = self.home / "session-env" / SESSION
        env.mkdir(parents=True)
        report = sonde.clean(self.folder, self.home)
        self.assertFalse(self.project.exists(), "le nettoyage a bien tourné")
        self.assertEqual(len(report.deleted), 5)
        self.assertTrue(env.is_dir(), "la mesure n'a pas montré de session-env : il n'est pas pris")


class BackgroundGestureTest(BackgroundEssai):
    def gesture(self, verb, fake, ref=None):
        with mock.patch.object(sonde.subprocess, "run", side_effect=fake), redirect_stdout(io.StringIO()):
            return sonde.background_gesture(verb, ref or str(self.folder), tmp=self.tmp, home=self.home)

    def target(self, **kw):
        """La session de ce lancement telle que `claude agents --json --all` la liste."""
        return {"id": SHORT, "cwd": str(self.folder), "kind": "background", "state": "done", **kw}

    def fake(self, *others, **kw):
        return Fake(sessions=[self.target(), *others], **kw)

    def test_arreter_lance_claude_stop_sur_l_id_note_seulement(self):
        self.unretire()
        fake = self.fake()
        self.assertEqual(self.gesture("stop", fake), 0)
        self.assertEqual(fake.verbs(), [["stop", SHORT]])
        stop = next(c for c in fake.calls if c[0][1] == "stop")
        self.assertEqual(stop[0][0], self.claude, "le Claude Code de la marque")
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", stop[1]["env"])
        self.assertNothingDeleted()

    def test_le_nom_seul_du_dossier_jetable_suffit(self):
        self.unretire()
        fake = self.fake()
        self.gesture("stop", fake, ref=self.folder.name)
        self.assertEqual(fake.verbs(), [["stop", SHORT]])

    def test_un_stop_qui_echoue_le_dit_et_ne_fait_rien_d_autre(self):
        self.unretire()
        with self.assertRaises(sonde.SondeError) as caught:
            self.gesture("stop", self.fake(stop=1))
        self.assertIn("claude stop", str(caught.exception))
        self.assertIn("arrêt refusé", self.log())
        self.assertFalse((self.folder / sonde.REMOVED).exists())
        self.assertNothingDeleted()

    def test_retirer_lance_rm_pose_le_retrait_puis_nettoie(self):
        self.unretire()
        fake = self.fake()
        self.assertEqual(self.gesture("rm", fake), 0)
        self.assertEqual(fake.verbs(), [["rm", SHORT]])
        self.assertTrue((self.folder / sonde.REMOVED).is_file())
        for path in self.ours():
            self.assertFalse(path.exists(), f"{path} resté")
        self.assertLauncherKept()
        self.assertNeighboursKept()
        self.assertIn("supprimé :", self.log())

    def test_un_rm_qui_echoue_ne_supprime_rien_ni_ne_pose_le_retrait(self):
        self.unretire()
        with self.assertRaises(sonde.SondeError) as caught:
            self.gesture("rm", self.fake(rm=1))
        self.assertIn("rien n'est supprimé", str(caught.exception))
        self.assertFalse((self.folder / sonde.REMOVED).exists())
        self.assertIn("retrait refusé", self.log())
        self.assertNothingDeleted()

    def test_une_cible_que_la_liste_ne_montre_pas_une_seule_fois_ici_n_est_ni_arretee_ni_retiree(self):
        cases = {
            "plus listée (retirée hors de la sonde)": Fake(sessions=[]),
            "listée dans un autre dossier": Fake(sessions=[self.target(cwd=str(self.neighbour))]),
            "deux fois sous cet id": self.fake(self.target(cwd="/ailleurs")),
            "liste pas du json": Fake(agents="oups"),
            "liste pas une liste": Fake(agents=json.dumps(self.target())),
            "liste en erreur": self.fake(agents_code=1),
        }
        self.unretire()
        for verb in ("stop", "rm"):
            for name, fake in cases.items():
                fake.calls = []
                with self.subTest(verb=verb, cas=name), self.assertRaises(sonde.SondeError):
                    self.gesture(verb, fake)
                self.assertEqual(fake.verbs(), [], "ni stop ni rm")
                self.assertFalse((self.folder / sonde.REMOVED).exists())
        self.assertNothingDeleted()

    def test_une_session_encore_listee_ou_une_liste_illisible_apres_le_rm_ne_supprime_rien(self):
        cases = {
            "une autre session dans le dossier": self.fake({"id": "12345678", "cwd": str(self.folder / "sous"), "state": "working"}),
            "pas du json": self.fake(after_rm="oups"),
            "pas une liste": self.fake(after_rm=json.dumps({"id": SHORT})),
            "le même id court ailleurs": self.fake(after_rm=json.dumps([self.target(cwd="/ailleurs")])),
        }
        for name, fake in cases.items():
            with self.subTest(name):
                if (self.folder / sonde.REMOVED).exists():
                    self.unretire()
                with self.assertRaises(sonde.SondeError) as caught:
                    self.gesture("rm", fake)
                self.assertNotIn("--retirer", str(caught.exception), "pas un geste que la sonde refuse ensuite")
                self.assertTrue((self.folder / sonde.REMOVED).is_file(), "claude rm a réussi : la fenêtre est fermée")
                self.assertIn("nettoyage refusé après claude rm", self.log())
                self.assertNothingDeleted()

    def test_une_session_d_un_autre_dossier_listee_ne_bloque_pas(self):
        self.unretire()
        fake = self.fake({"id": "12345678", "cwd": str(self.neighbour), "state": "working"})
        self.assertEqual(self.gesture("rm", fake), 0)
        self.assertFalse(self.project.exists())

    def test_deja_retiree_refuse_un_second_geste(self):
        for verb in ("stop", "rm"):
            fake = self.fake()
            with self.subTest(verb), self.assertRaises(sonde.SondeError) as caught:
                self.gesture(verb, fake)
            self.assertIn("--nettoyer", str(caught.exception))
            self.assertEqual(fake.calls, [])
        self.assertNothingDeleted()

    def test_un_dossier_sans_id_note_est_refuse_sans_rien_lancer(self):
        self.unretire()
        (self.folder / sonde.BACKGROUND).unlink()
        for verb in ("stop", "rm"):
            fake = self.fake()
            with self.subTest(verb), self.assertRaises(sonde.SondeError):
                self.gesture(verb, fake)
            self.assertEqual(fake.calls, [])
        self.assertNothingDeleted()

    def test_un_id_hors_forme_est_refuse_sans_rien_lancer(self):
        self.unretire()
        self.renote({"court": SHORT + "; rm -rf"})
        fake = self.fake()
        with self.assertRaises(sonde.SondeError):
            self.gesture("rm", fake)
        self.assertEqual(fake.calls, [])

    def test_un_nom_de_dossier_hors_forme_est_refuse_sans_rien_lancer(self):
        for ref in ("sonde-ABCD1234", "sonde-abcd123", "../sonde-abcd1234", "sonde-abcd1234/..", "autre"):
            fake = self.fake()
            with self.subTest(ref), self.assertRaises(sonde.SondeError):
                self.gesture("rm", fake, ref=ref)
            self.assertEqual(fake.calls, [])
        self.assertNothingDeleted()

    def test_un_claude_de_la_marque_qui_n_est_pas_un_executable_est_refuse(self):
        self.unretire()
        marker = self.folder / sonde.MARKER
        marker.unlink()
        sonde.mark_launch(self.folder, "/nulle/part/claude", launcher=LAUNCHER)
        fake = self.fake()
        with self.assertRaises(sonde.SondeError):
            self.gesture("stop", fake)
        self.assertEqual(fake.calls, [])


class BackgroundFinishTest(BackgroundEssai):
    def run_finish(self, fake, garder=False):
        args = mock.Mock(nettoyer=self.folder.name, journaux=None, apres_session=False, claude=None, garder=garder)
        with mock.patch.object(sonde.subprocess, "run", side_effect=fake), redirect_stdout(io.StringIO()):
            return sonde.finish(args, "tmux", home=self.home, tmp=self.tmp)

    def test_nettoyer_reprend_un_essai_interrompu_apres_le_retrait(self):
        fake = Fake()
        self.assertEqual(self.run_finish(fake), 0)
        for path in self.ours():
            self.assertFalse(path.exists(), f"{path} resté")
        self.assertLauncherKept()
        self.assertEqual(fake.verbs(), [], "--nettoyer ne lance ni stop ni rm")
        self.assertFalse(any(c[1:2] == ["list-panes"] for c, _ in fake.calls))

    def test_nettoyer_avec_garder_ne_supprime_rien_et_liste_ce_qui_reste(self):
        self.assertEqual(self.run_finish(Fake(), garder=True), 0)
        self.assertNothingDeleted()
        self.assertIn("(--garder)", self.log())

    def test_nettoyer_sans_retrait_ne_supprime_rien_et_le_dit(self):
        self.unretire()
        self.run_finish(Fake())
        self.assertNothingDeleted()
        self.assertIn("pas retirée", self.log())

    def test_nettoyer_pendant_que_la_session_est_listee_ne_supprime_rien(self):
        with self.assertRaises(sonde.SondeError) as caught:
            self.run_finish(Fake(agents=json.dumps([{"id": SHORT, "cwd": str(self.folder)}])))
        self.assertNothingDeleted()
        self.assertIn("nettoyage refusé", self.log())
        # Le remède dit n'est pas un geste que la sonde refuserait ensuite (--retirer d'une session déjà retirée).
        self.assertIn("à la main", str(caught.exception))
        self.assertNotIn("--retirer", str(caught.exception))

    def test_nettoyer_d_un_lancement_en_arriere_plan_passe_sans_tmux(self):
        self.assertTrue(sonde.background_ref(self.folder.name, self.tmp))
        with mock.patch.object(sonde, "launch_folder", side_effect=PermissionError("refusé")):
            self.assertFalse(sonde.background_ref(self.folder.name, self.tmp), "une lecture ratée : faux, sans trace")
        (self.folder / sonde.BACKGROUND).unlink()
        self.assertFalse(sonde.background_ref(self.folder.name, self.tmp), "un lancement dans tmux lit tmux")
        self.assertFalse(sonde.background_ref("sonde-ABCD1234", self.tmp))

    def main(self, *argv):
        """`main()` sans tmux, `finish` et `drive` remplacés : (code de sortie, finish appelé, drive appelé)."""
        with mock.patch.object(sys, "argv", ["sonde.py", *argv]), \
                mock.patch.object(sonde.shutil, "which", return_value=None), \
                mock.patch.object(sonde.tempfile, "gettempdir", return_value=str(self.tmp)), \
                mock.patch.object(sonde, "finish", return_value=0) as finish, \
                mock.patch.object(sonde, "drive") as drive, self.assertRaises(SystemExit) as caught:
            sonde.main()
        return caught.exception.code, finish.called, drive.called

    def test_main_sans_tmux_ne_laisse_passer_que_le_nettoyage_d_un_lancement_en_arriere_plan(self):
        self.assertEqual(self.main("--nettoyer", self.folder.name), (0, True, False))
        for extra in (["--voir"], ["--envoyer", "x"], ["--touches", "Enter"]):
            with self.subTest(extra=extra):
                code, finished, driven = self.main("--nettoyer", self.folder.name, *extra)
                self.assertIn("tmux introuvable", str(code))
                self.assertFalse(finished or driven)
        (self.folder / sonde.BACKGROUND).unlink()
        code, finished, _ = self.main("--nettoyer", self.folder.name)
        self.assertIn("tmux introuvable", str(code))
        self.assertFalse(finished)


class LaunchBackgroundTest(Essai):
    def args(self, text="Réponds seulement : ok"):
        return argparse.Namespace(arriere_plan=text, model="haiku", effort="low")

    def launch(self, fake, tmp=None, text="Réponds seulement : ok"):
        with mock.patch.object(sonde.subprocess, "run", side_effect=fake):
            return sonde.launch_background(self.args(text), sys.executable, tmp=tmp or self.tmp,
                                           environ={"CLAUDE_CODE_SESSION_ID": LAUNCHER, "PATH": "/bin"})

    def new_folders(self):
        return sorted(p for p in self.tmp.iterdir() if p not in (self.folder, self.neighbour))

    def test_le_lancement_note_l_id_court_de_sa_sortie_et_le_lanceur(self):
        fake = Fake(bg=mock.Mock(returncode=0, stdout="backgrounded · 8cfebb73\n  claude agents   list sessions\n",
                                 stderr="warning: --bg manages the session id\n"))
        folder, short = self.launch(fake)
        self.assertEqual(short, "8cfebb73")
        self.assertEqual(sonde.background_state(folder), ("valide", "8cfebb73"))
        self.assertEqual(sonde.launch_launcher(folder), ("valide", LAUNCHER))
        self.assertEqual(sonde.launch_folder(str(folder)), folder, "un dossier que les gestes acceptent")
        cmd, kwargs = next((c, k) for c, k in fake.calls if c[1] == "--bg")
        self.assertEqual(kwargs["cwd"], folder)
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", kwargs["env"])
        self.assertNotIn("--plugin-dir", cmd)
        self.assertEqual(cmd[-1], "Réponds seulement : ok")
        self.assertIn("backgrounded · 8cfebb73", (folder / "journaux" / sonde.LOG_NAME).read_text(encoding="utf-8"))

    def test_workspace_not_trusted_ne_note_rien_et_dit_le_remede(self):
        fake = Fake(bg=mock.Mock(returncode=1, stdout="", stderr="Workspace not trusted. Run `claude` in /x once and "
                                                                     "accept the trust prompt, then retry.\n"))
        with self.assertRaises(sonde.SondeError) as caught:
            self.launch(fake)
        self.assertIn("TMPDIR", str(caught.exception))
        (folder,) = self.new_folders()
        self.assertEqual(sonde.background_state(folder), ("aucun", None))

    def test_sans_une_seule_ligne_de_lancement_rien_n_est_note(self):
        for stdout in ("", "backgrounded · 8cfebb73\nbackgrounded · 12345678\n", "backgrounded · 8CFEBB73\n",
                       "xbackgrounded · 8cfebb73\n", "backgrounded · 8cfebb734\n"):
            with self.subTest(stdout=stdout):
                fake = Fake(bg=mock.Mock(returncode=0, stdout=stdout, stderr=""))
                with self.assertRaises(sonde.SondeError):
                    self.launch(fake)
        for folder in self.new_folders():
            self.assertEqual(sonde.background_state(folder), ("aucun", None))

    def test_la_ligne_de_lancement_se_lit_entiere(self):
        self.assertEqual(sonde.launched_short_id("backgrounded · 8cfebb73 · un titre\n"), "8cfebb73")
        self.assertEqual(sonde.launched_short_id("  backgrounded · 8cfebb73  \n  claude logs 8cfebb73\n"), "8cfebb73")
        for piece in [*PIECES, DOTS]:
            with self.subTest(piece=repr(piece)):
                self.assertNotEqual(sonde.launched_short_id(f"backgrounded · 8cfe{piece}bb73\n"), "8cfebb73")

    def test_un_code_d_erreur_ne_note_rien_meme_avec_une_ligne(self):
        with self.assertRaises(sonde.SondeError):
            self.launch(Fake(bg=mock.Mock(returncode=2, stdout="backgrounded · 8cfebb73\n", stderr="")))

    def test_un_dossier_temporaire_dans_un_depot_git_est_refuse_sans_rien_creer(self):
        repo = self.tmp / "depot"
        (repo / ".git").mkdir(parents=True)
        (repo / "sous").mkdir()
        fake = Fake(bg=mock.Mock(returncode=0, stdout="backgrounded · 8cfebb73\n", stderr=""))
        with self.assertRaises(sonde.SondeError) as caught:
            self.launch(fake, tmp=repo / "sous")
        self.assertIn("dépôt git", str(caught.exception))
        self.assertEqual(list((repo / "sous").iterdir()), [])
        self.assertEqual(fake.calls, [])

    def test_une_demande_vide_ou_qui_commence_par_un_tiret_est_refusee(self):
        blank = [p for p in PIECES if not p.strip()]
        # Un caractère nul n'entre dans aucun argument d'une commande (subprocess lèverait ValueError).
        for text in ("", "   ", "--help", "-p x", "ok\x00fin", *blank, *(f"-{p}x" for p in PIECES), None, 42):
            fake = Fake(bg=mock.Mock(returncode=0, stdout="backgrounded · 8cfebb73\n", stderr=""))
            with self.subTest(text=repr(text)), self.assertRaises(sonde.SondeError):
                self.launch(fake, text=text)
            self.assertEqual(fake.calls, [])

    def test_une_demande_qui_porte_le_corpus_hostile_hors_de_la_tete_part_telle_quelle(self):
        # Le texte part en un seul argument de la liste de `subprocess.run`, sans shell : seule la tête compte.
        for piece in [p for p in PIECES if p != "\x00"] + [DOTS]:
            text = f"ok{piece}fin"
            fake = Fake(bg=mock.Mock(returncode=0, stdout="backgrounded · 8cfebb73\n", stderr=""))
            with self.subTest(piece=repr(piece)):
                self.launch(fake, text=text)
                cmd = next(c for c, _ in fake.calls if c[1] == "--bg")
                self.assertEqual(cmd[-1], text)


class BackgroundMainTest(unittest.TestCase):
    def args(self, **kw):
        base = dict(arriere_plan=None, arreter=None, retirer=None, dir=None, reprise=False, titre=None, env=[],
                    plugin=[], garder=False, nettoyer=None, envoyer=None, voir=False, touches=[], apres_session=False,
                    desktop=False, model="haiku", effort="low")
        base.update(kw)
        return argparse.Namespace(**base)

    def test_un_seul_geste_sans_option_de_tmux(self):
        for kw in ({"arreter": "sonde-abcd1234", "retirer": "sonde-abcd1234"},
                   {"arreter": "sonde-abcd1234", "dir": Path("/x")},
                   {"retirer": "sonde-abcd1234", "nettoyer": "sonde-abcd1234"},
                   {"arriere_plan": "ok", "env": ["A=1"]},
                   {"arriere_plan": "ok", "garder": True},
                   {"arreter": "sonde-abcd1234", "desktop": True}):
            with self.subTest(kw=kw), mock.patch.object(sonde.subprocess, "run") as run:
                with self.assertRaises(sonde.SondeError):
                    sonde.background_main(self.args(**kw))
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
