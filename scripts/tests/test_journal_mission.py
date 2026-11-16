"""Tests de scripts/journal-mission.py, le journal d'une mission entrelacé avec les arrêts et reprises de ses
discussions : python3 -m unittest discover -s scripts/tests.

Chaque test écrit un faux dossier `~/.claude` (fichier des missions et transcripts) et le donne au script par
`CLAUDE_CONFIG_DIR`."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "journal-mission.py"
OWNER = "81ab9a05-66d2-45d2-b6f0-343d57428d17"
BORN = "2c190b55-d06a-4134-bd9a-73351fa5b9ce"
SECRET = "Texte privé d'un message"


def ms(text):
    """Une date ISO en millisecondes depuis 1970."""
    from datetime import datetime
    return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


class JournalMissionTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.base = Path(self.dir.name) / "claude"
        (self.base / "flow-board" / "parcours").mkdir(parents=True)
        (self.base / "projects" / "-depot").mkdir(parents=True)

    def tearDown(self):
        self.dir.cleanup()

    def mission(self, name="depot.json", **fields):
        run = {"id": "mwawyzj5-3nf4", "title": "Missions détachées de leur discussion", "owner": OWNER,
               "bornIn": BORN, "updatedAt": ms("2026-11-10T12:00:00Z"),
               "log": [{"at": ms("2026-11-10T10:00:00Z"), "glyph": "▶", "text": "mission ouverte", "tone": "info"},
                       {"at": ms("2026-11-10T10:30:00Z"), "glyph": "‖", "text": "mission mise de côté", "tone": "warn"}]}
        run.update(fields)
        path = self.base / "flow-board" / "parcours" / name
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"v": 1, "runs": []}
        data["runs"].append(run)
        path.write_text(json.dumps(data), encoding="utf-8")
        return run

    def transcript(self, session, entries, folder="-depot"):
        path = self.base / "projects" / folder / f"{session}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8")
        return path

    def run_script(self, *args):
        env = {**os.environ, "CLAUDE_CONFIG_DIR": str(self.base)}
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True,
                              encoding="utf-8", env=env)

    def body(self, out):
        """Les lignes d'événements, après la ligne vide qui suit l'en-tête."""
        return out.stdout.split("\n\n", 1)[1].strip().splitlines()

    def test_les_lignes_du_journal_et_des_discussions_sortent_triees_par_date(self):
        self.mission()
        self.transcript(OWNER, [
            {"type": "user", "timestamp": "2026-11-10T09:55:00Z", "message": {"content": SECRET}},
            {"type": "system", "subtype": "compact_boundary", "timestamp": "2026-11-10T10:10:00Z",
             "compactMetadata": {"trigger": "auto"}, "content": SECRET},
            {"type": "assistant", "timestamp": "2026-11-10T10:20:00Z", "message": {"content": SECRET}},
            {"type": "cost-state", "startTime": 1},
            {"type": "cost-state", "startTime": 1},
            {"type": "last-prompt"},
            {"type": "user", "timestamp": "2026-11-10T11:00:00Z", "message": {"content": SECRET}},
        ])
        self.transcript(BORN, [{"type": "user", "timestamp": "2026-11-10T09:00:00Z", "message": {"content": SECRET}}],
                        folder="-autre")
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertNotIn(SECRET, out.stdout + out.stderr)
        self.assertIn(f"discussion {OWNER} (titulaire)", out.stdout)
        self.assertIn(f"discussion {BORN} (née dans)", out.stdout)
        self.assertEqual([" ".join(line.split()) for line in self.body(out)], [
            "2026-11-10 09:00:00 discussion 2c190b55 démarrage",
            "2026-11-10 09:55:00 discussion 81ab9a05 démarrage",
            "2026-11-10 10:00:00 mission ▶ mission ouverte",
            "2026-11-10 10:10:00 discussion 81ab9a05 compaction (auto)",
            "2026-11-10 10:20:00 discussion 81ab9a05 fin du processus (dernière activité)",
            "2026-11-10 10:30:00 mission ‖ mission mise de côté",
            "2026-11-10 11:00:00 discussion 81ab9a05 reprise (première entrée datée)",
        ])

    def full_log(self, count):
        """Un journal de `count` entrées, la plus récente d'abord, une par minute depuis 10:00 (la plus ancienne)."""
        return [{"at": ms("2026-11-10T10:00:00Z") + 60_000 * i, "glyph": "·", "text": f"entrée {i}"}
                for i in reversed(range(count))]

    def test_un_journal_au_plafond_le_dit_en_tete_avec_les_debuts_connus(self):
        self.mission(log=self.full_log(80), phases=[{"skill": "to-tickets", "startedAt": ms("2026-11-10T08:30:00Z")}])
        self.transcript(OWNER, [{"type": "user", "timestamp": "2026-11-10T09:55:00Z", "message": {"content": SECRET}}])
        self.transcript(BORN, [{"type": "user", "timestamp": "2026-11-10T09:00:00Z", "message": {"content": SECRET}}],
                        folder="-autre")
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        head = out.stdout.splitlines()
        self.assertTrue(head[0].startswith("Mission mwawyzj5-3nf4"))
        self.assertEqual(head[1:4], [
            "journal au plafond (80 entrées) : la plus ancienne gardée date du 2026-11-10 10:00:00 ; ce qui précède est perdu",
            "mission commencée le 2026-11-10 08:30:00 (début de sa première phase)",
            "premier démarrage d'une discussion lue : 2026-11-10 09:00:00 (discussion 2c190b55), le début d'une discussion, pas celui de la mission",
        ])

    def test_un_journal_sous_le_plafond_ne_dit_rien(self):
        self.mission(log=self.full_log(79), phases=[{"startedAt": ms("2026-11-10T08:30:00Z")}])
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertNotIn("plafond", out.stdout)
        self.assertNotIn("mission commencée", out.stdout)

    def test_un_journal_au_plafond_sans_transcript_ni_phase_lisible_le_dit_aussi(self):
        log = self.full_log(79) + ["entrée illisible"]
        self.mission(log=log, phases=[{"startedAt": "hier"}])
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        head = out.stdout.splitlines()
        self.assertEqual(head[1:4], [
            "journal au plafond (80 entrées) : la plus ancienne entrée datée gardée date du 2026-11-10 10:00:00 "
            "(1 sans date lisible) ; ce qui précède est perdu",
            "début de la mission inconnu (date de sa première phase absente ou illisible)",
            "premier démarrage d'une discussion inconnu (aucun transcript lu, ou sans entrée datée)",
        ])

    def test_le_plafond_du_script_est_celui_du_journal_de_flow_board(self):
        spec = importlib.util.spec_from_file_location("journal_mission", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        basics = (SCRIPT.parent.parent / "plugins" / "flow-board" / "hooks" / "basics.ts").read_text(encoding="utf-8")
        import re
        limits = re.search(r"export const LIMITS = \{(.*?)\}", basics, re.S)
        self.assertIsNotNone(limits, "LIMITS introuvable dans basics.ts")
        found = re.search(r"^\s*log:\s*(\d+),", limits.group(1), re.M)
        self.assertIsNotNone(found, "LIMITS.log introuvable dans basics.ts")
        self.assertEqual(module.LOG_CAP, int(found.group(1)))

    def test_un_titre_trouve_la_mission_et_un_titre_qui_en_designe_plusieurs_donne_leur_liste(self):
        self.mission()
        self.mission(id="mwb00000-aaaa", title="Rétrospective · Missions détachées de leur discussion")
        out = self.run_script("missions détachées de leur discussion")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Mission mwawyzj5-3nf4", out.stdout)
        out = self.run_script("détachées")
        self.assertEqual(out.returncode, 1)
        self.assertIn("2 missions désignées", out.stderr)
        self.assertIn("'mwawyzj5-3nf4'", out.stderr)
        self.assertIn("'mwb00000-aaaa'", out.stderr)
        self.assertEqual(out.stdout, "")
        out = self.run_script("aucune pareille")
        self.assertEqual(out.returncode, 1)
        self.assertIn("aucune mission", out.stderr)

    def test_la_meme_mission_dans_deux_fichiers_prend_la_plus_recente_et_nomme_l_autre(self):
        self.mission("depot.json")
        self.mission("worktree.json", updatedAt=ms("2026-11-10T13:00:00Z"),
                     log=[{"at": ms("2026-11-10T12:59:00Z"), "text": "dans le worktree"}])
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("worktree.json)", out.stdout.splitlines()[0])
        self.assertIn("aussi dans : depot.json", out.stdout)
        self.assertIn("dans le worktree", out.stdout)

    def test_un_id_de_discussion_hors_forme_est_ignore_et_signale_sans_entrer_dans_un_chemin(self):
        # Un id relu du fichier qui sortirait de `projects/` s'il entrait dans un chemin : jamais lu.
        outside = Path(self.dir.name) / "dehors.jsonl"
        outside.write_text(json.dumps({"type": "user", "timestamp": "2026-11-10T08:00:00Z"}) + "\n", encoding="utf-8")
        for bad in ("../../dehors", "a/b", "id\nfaux", "x" * 101, "é", 42):
            with self.subTest(bad=bad):
                (self.base / "flow-board" / "parcours" / "depot.json").unlink(missing_ok=True)
                self.mission(owner=bad, bornIn=None)
                out = self.run_script("mwawyzj5-3nf4")
                self.assertEqual(out.returncode, 0, out.stderr)
                self.assertIn("owner ignoré", out.stdout)
                self.assertIn("n'a pas la forme d'un id de session", out.stdout)
                self.assertNotIn("08:00:00", out.stdout)
                self.assertNotIn("\nfaux", out.stdout)

    @unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
    def test_un_transcript_absent_ou_un_lien_se_dit_et_le_journal_sort_quand_meme(self):
        # Le transcript du titulaire est un lien vers un fichier hors de `projects/` ; celui de `bornIn` manque.
        self.mission()
        outside = Path(self.dir.name) / "hors.jsonl"
        outside.write_text(json.dumps({"type": "user", "timestamp": "2026-11-10T08:00:00Z"}) + "\n", encoding="utf-8")
        (self.base / "projects" / "-depot" / f"{OWNER}.jsonl").symlink_to(outside)
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn(f"discussion {OWNER} (titulaire) : transcript introuvable", out.stdout)
        self.assertIn(f"discussion {BORN} (née dans) : transcript introuvable", out.stdout)
        self.assertNotIn("08:00:00", out.stdout)
        self.assertIn("mission ouverte", out.stdout)

    def test_les_dates_hors_bornes_ou_illisibles_sont_ecartees(self):
        self.mission(log=[{"at": 1e400, "text": "infinie"}, {"at": "hier", "text": "texte"}, {"at": True, "text": "vrai"},
                          {"at": ms("2026-11-10T10:00:00Z"), "text": "gardée"}])
        self.transcript(OWNER, [{"type": "user", "timestamp": "1970-01-01T00:00:00Z"},
                                {"type": "user", "timestamp": "pas une date"},
                                {"type": "user", "timestamp": "2026-11-10T09:00:00Z"}, "pas un objet", ["liste"]])
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual([" ".join(line.split()) for line in self.body(out)], [
            "2026-11-10 09:00:00 discussion 81ab9a05 démarrage",
            "2026-11-10 10:00:00 mission gardée",
        ])

    def test_une_continuation_sous_un_autre_id_n_est_pas_une_reprise_et_nomme_cet_id(self):
        # Après la fin, un autre processus écrit `continued-in` puis une nouvelle `cost-state` : la discussion continue
        # sous un autre id, elle n'a pas repris sur place. Un id hors forme se cite sans entrer dans un chemin.
        self.mission(log=[])
        self.transcript(OWNER, [
            {"type": "user", "timestamp": "2026-11-10T09:00:00Z"},
            {"type": "cost-state", "totalDuration": 4512, "totalCostUSD": 0},
            {"type": "continued-in", "continuedInSessionId": BORN, "sessionId": OWNER, "timestamp": "2026-11-10T09:00:03Z"},
            {"type": "last-prompt"},
            # Forme relevée sur le Mac : après la continuation, des `cost-state` aux totaux différents, qui ne sont pas
            # des réouvertures de la fin d'avant.
            {"type": "cost-state", "totalDuration": 25335828, "totalCostUSD": 2.96},
            {"type": "cost-state", "totalDuration": 982522, "totalCostUSD": 0.0000876},
            {"type": "continued-in", "continuedInSessionId": "../x\nfaux", "timestamp": "2026-11-10T09:30:00Z"},
            {"type": "continued-in", "timestamp": "2026-11-10T09:40:00Z"},
            {"type": "continued-in", "continuedInSessionId": [[[1]]], "timestamp": "2026-11-10T09:50:00Z"},
            {"type": "user", "timestamp": "2026-11-10T10:00:00Z"},
        ])
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual([" ".join(line.split()) for line in self.body(out)], [
            "2026-11-10 09:00:00 discussion 81ab9a05 démarrage",
            "2026-11-10 09:00:00 discussion 81ab9a05 fin du processus (dernière activité)",
            f"2026-11-10 09:00:03 discussion 81ab9a05 continuée dans la discussion {BORN}",
            "2026-11-10 09:30:00 discussion 81ab9a05 continuée dans la discussion id hors forme '../x\\nfaux'",
            "2026-11-10 09:40:00 discussion 81ab9a05 continuée dans la discussion (id absent)",
            "2026-11-10 09:50:00 discussion 81ab9a05 continuée dans la discussion id hors forme <list>",
            "2026-11-10 10:00:00 discussion 81ab9a05 reprise (première entrée datée)",
        ])

    def test_des_reouvertures_refermees_sans_entree_datee_se_comptent_sur_la_ligne_de_la_fin(self):
        # Trois `cost-state` de suite aux totaux différents : une fin, puis deux réouvertures refermées sans rien de
        # daté ; une quatrième aux mêmes totaux que la précédente n'en est pas une.
        self.mission(log=[])
        self.transcript(OWNER, [
            {"type": "user", "timestamp": "2026-11-10T09:00:00Z"},
            {"type": "cost-state", "totalDuration": 10, "totalCostUSD": 1.0},
            {"type": "cost-state", "totalDuration": 20, "totalCostUSD": 1.0},
            {"type": "cost-state", "totalDuration": 30, "totalCostUSD": 1.5},
            {"type": "cost-state", "totalDuration": 30, "totalCostUSD": 1.5},
            {"type": "user", "timestamp": "2026-11-10T12:00:00Z"},
        ])
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual([" ".join(line.split()) for line in self.body(out)], [
            "2026-11-10 09:00:00 discussion 81ab9a05 démarrage",
            "2026-11-10 09:00:00 discussion 81ab9a05 fin du processus (dernière activité), puis 2 réouverture(s) "
            "refermée(s) sans entrée datée",
            "2026-11-10 12:00:00 discussion 81ab9a05 reprise (première entrée datée)",
        ])

    def test_une_date_trop_grande_ou_sans_fuseau_est_ecartee_sans_faire_tomber_le_journal(self):
        self.mission(updatedAt=10 ** 400, log=[{"at": 10 ** 400, "text": "énorme"}, {"at": -(10 ** 400), "text": "négative"},
                                               {"at": ms("2026-11-10T10:00:00Z"), "text": "gardée"}])
        self.transcript(OWNER, [{"type": "user", "timestamp": "2026-11-10T08:00:00"},
                                {"type": "user", "timestamp": "2026-11-10T09:00:00+00:00"}])
        (self.base / "projects" / "-depot" / f"{BORN}.jsonl").write_text("[" * 100000 + "\n", encoding="utf-8")
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual([" ".join(line.split()) for line in self.body(out)], [
            "2026-11-10 09:00:00 discussion 81ab9a05 démarrage",
            "2026-11-10 10:00:00 mission gardée",
        ])

    def test_le_garde_de_l_id_de_session_passe_le_corpus_hostile(self):
        # Règle « Un garde de forme passe le corpus hostile commun » (celui de flow-board, `tests/corpus.mjs`, n'est pas
        # lisible depuis Python) : chaque valeur, seule ou glissée après un id valide, est refusée, sans lever.
        # Les caractères invisibles s'écrivent par leur point de code (`chr`), jamais bruts dans la source.
        pieces = ["\n", "\x00", "\t", "\x1b", "\x7f", "\x0b", "\x0c", "\r", chr(0x80), chr(0x85), chr(0x9F), chr(0x2028),
                  chr(0x2029), chr(0x212A), chr(0xFF11), chr(0x200B), chr(0x200D), chr(0x202E), chr(0xAD), chr(0xFEFF),
                  chr(0xA0), chr(0x435), "'", chr(0x2018), chr(0x2019), chr(0x2BC), '"', "$(x)", ";", "*", " ", "/", ".."]
        hostile = [*pieces, *(OWNER + p for p in pieces), *("a" + p + "b" for p in pieces), "x" * 101, "", [], {}, 42, 4.2,
                   True]
        spec = importlib.util.spec_from_file_location("journal_mission", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for value in hostile:
            with self.subTest(value=repr(value)):
                self.assertFalse(isinstance(value, str) and module.SESSION_ID.fullmatch(value))
                (self.base / "flow-board" / "parcours" / "depot.json").unlink(missing_ok=True)
                self.mission(owner=value, bornIn=None, log=[])
                lines, code = module.journal("mwawyzj5-3nf4", base=self.base)
                self.assertEqual(code, 0)
                self.assertTrue(any(line.startswith("owner ignoré") for line in lines), lines)
                self.assertTrue(all("\n" not in line and "\r" not in line for line in lines), lines)
        self.assertTrue(module.SESSION_ID.fullmatch(OWNER))

    def test_sans_argument_l_usage_est_rendu(self):
        out = self.run_script()
        self.assertEqual(out.returncode, 2)
        self.assertIn("journal-mission.py <titre ou id", out.stderr)



    def models_transcript(self):
        return [
            {"type": "attachment", "timestamp": "2026-11-10T10:00:00Z",
             "attachment": {"type": "model", "identity": {"modelId": "claude-opus-5-5"}, "text": SECRET}},
            {"type": "user", "timestamp": "2026-11-10T10:01:00Z", "message": {"content": SECRET}},
            {"type": "api-request", "timestamp": "2026-11-10T10:01:01Z", "querySource": "repl_main_thread",
             "id": "r1", "params": {"model": "claude-opus-5-5", "output_config": {"effort": "medium"},
                                    "messages": [{"content": SECRET}]}},
            {"type": "assistant", "timestamp": "2026-11-10T10:01:05Z", "requestRef": "r1",
             "message": {"model": "claude-opus-5-5", "content": SECRET}},
            {"type": "api-request", "timestamp": "2026-11-10T10:02:00Z", "querySource": "agent:x", "id": "r2",
             "params": {"model": "claude-haiku-5-5"}},
            {"type": "assistant", "timestamp": "2026-11-10T10:02:05Z", "requestRef": "r2", "isSidechain": True,
             "message": {"model": "claude-haiku-5-5", "content": SECRET}},
            {"type": "user", "timestamp": "2026-11-10T10:03:00Z",
             "message": {"content": "<command-name>/model</command-name><command-args>fable</command-args>"}},
            {"type": "user", "timestamp": "2026-11-10T10:03:10Z",
             "message": {"content": f"<command-name>/effort</command-name><command-args>{SECRET}</command-args>"}},
            {"type": "attachment", "timestamp": "2026-11-10T10:04:00Z",
             "attachment": {"type": "remote_session_change",
                            "commit": f"Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com> {SECRET}"}},
            {"type": "api-request", "timestamp": "2026-11-10T10:05:00Z", "querySource": "repl_main_thread",
             "id": "r3", "params": {"model": "claude-fable-5-2", "output_config": {"effort": "high"}}},
            {"type": "assistant", "timestamp": "2026-11-10T10:05:09Z", "requestRef": "r3",
             "message": {"model": "claude-opus-5-5", "content": SECRET}},
            {"type": "user", "timestamp": "2026-11-10T10:06:00Z",
             "message": {"content": "<command-name>/reload-plugins</command-name><command-args></command-args>"}},
            {"type": "user", "timestamp": "2026-11-10T10:06:30Z",
             "message": {"content": "<command-name>/compact</command-name><command-args></command-args>"}},
            {"type": "api-request", "timestamp": "2026-11-10T10:07:00Z", "querySource": "repl_main_thread",
             "id": "r4", "params": {"model": "claude-opus-5-5"}},
            # Sous Claude Desktop, le fil principal écrit `sdk` ; un `sdk` sans réponse du fil principal est écarté.
            {"type": "api-request", "timestamp": "2026-11-10T10:08:00Z", "querySource": "sdk", "id": "r5",
             "params": {"model": "claude-opus-5-5", "output_config": {"effort": "xhigh"}}},
            {"type": "assistant", "timestamp": "2026-11-10T10:08:04Z", "requestRef": "r5",
             "message": {"model": "claude-opus-5-5", "content": SECRET}},
            {"type": "api-request", "timestamp": "2026-11-10T10:09:00Z", "querySource": "sdk", "id": "r6",
             "params": {"model": "claude-haiku-5-5"}},
        ]

    def test_modeles_sort_les_requetes_et_les_bascules_dans_l_ordre_sans_texte(self):
        self.mission()
        path = self.transcript(OWNER, self.models_transcript())
        before = path.read_bytes()
        out = self.run_script("--modeles", "mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.body(out), [
            "2026-11-10 10:00:00  discussion 81ab9a05  bascule : modèle annoncé claude-opus-5-5",
            "2026-11-10 10:01:01  discussion 81ab9a05  requête : envoyé claude-opus-5-5 / medium → répondu claude-opus-5-5",
            "2026-11-10 10:03:00  discussion 81ab9a05  bascule : /model fable",
            "2026-11-10 10:03:10  discussion 81ab9a05  bascule : /effort (argument masqué)",
            "2026-11-10 10:04:00  discussion 81ab9a05  bascule : remote_session_change (Fable 5.2)",
            "2026-11-10 10:05:00  discussion 81ab9a05  requête : envoyé claude-fable-5-2 / high → répondu claude-opus-5-5",
            "2026-11-10 10:06:00  discussion 81ab9a05  bascule : /reload-plugins",
            "2026-11-10 10:07:00  discussion 81ab9a05  requête : envoyé claude-opus-5-5 / sans effort → répondu ?",
            "2026-11-10 10:08:00  discussion 81ab9a05  requête : envoyé claude-opus-5-5 / xhigh → répondu claude-opus-5-5",
            "2026-11-10 10:09:00  discussion 81ab9a05  2 requête(s) hors du fil principal écartée(s) (autre source, ou "
            "sdk sans réponse du fil principal)",
        ])
        self.assertNotIn(SECRET, out.stdout + out.stderr)
        self.assertNotIn("mission ouverte", out.stdout)
        self.assertEqual(path.read_bytes(), before)

    def test_sans_modeles_la_sortie_ne_change_pas_et_ignore_les_requetes(self):
        self.mission()
        self.transcript(OWNER, self.models_transcript())
        out = self.run_script("mwawyzj5-3nf4")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertNotIn("requête", out.stdout)
        self.assertNotIn("bascule", out.stdout)
        self.assertIn("mission ouverte", out.stdout)
        self.assertNotIn(SECRET, out.stdout)

    def test_les_gardes_de_modeles_passent_le_corpus_hostile(self):
        # Règle « Un garde de forme passe le corpus hostile commun » : WORD (arguments de commande, noms de modèle et
        # d'effort) et ATTRIBUTED (le modèle d'un remote_session_change) ne laissent sortir ni contrôle, ni séparateur
        # de ligne, ni caractère invisible ou hors ASCII.
        pieces = ["\n", "\x00", "\t", "\x1b", "\x7f", "\x0b", "\x0c", "\r", chr(0x80), chr(0x85), chr(0x9F), chr(0x2028),
                  chr(0x2029), chr(0x212A), chr(0xFF11), chr(0x200B), chr(0x200D), chr(0x202E), chr(0xAD), chr(0xFEFF),
                  chr(0xA0), chr(0x435), "'", chr(0x2018), chr(0x2019), chr(0x2BC), '"', "$(x)", ";", "*", " ", "/"]
        hostile = [*pieces, *("opus" + p for p in pieces), *("a" + p + "b" for p in pieces), "x" * 41]
        spec = importlib.util.spec_from_file_location("journal_mission", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for value in hostile:
            with self.subTest(value=repr(value)):
                self.assertIsNone(module.WORD.fullmatch(value))
                command = module.typed_command(
                    {"content": f"<command-name>/model</command-name><command-args>{value}</command-args>"})
                # Les blancs de bord d'un argument se retirent (« opus\n » sort « /model opus ») ; rien d'autre ne passe.
                self.assertIn(command, ("/model", "/model opus", "/model (argument masqué)", None))
                self.assertTrue(module.model_name(value).isprintable())
                named = module.ATTRIBUTED.search(f"Co-Authored-By: Claude Opus{value}5")
                self.assertTrue(named is None or (named[1].isascii() and named[1].isprintable()))

    def test_modeles_sans_mission_ou_sans_argument(self):
        self.assertEqual(self.run_script("--modeles").returncode, 2)
        self.assertEqual(self.run_script("--modeles", "inconnue").returncode, 1)
if __name__ == "__main__":
    unittest.main()
