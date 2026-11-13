"""Tests de scripts/regles-app.py : les règles des outils de l'app Desktop lues dans un faux `app.asar`
(une archive minimale au format d'Electron, des textes inventés à la forme du code minifié de l'app), et
les erreurs de son chemin. python3 -m unittest discover -s scripts/tests."""

import importlib.util
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "regles-app.py"
spec = importlib.util.spec_from_file_location("regles_app", SCRIPT)
regles_app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regles_app)

# Du code à la forme de celui de l'app : noms d'outils derrière des alias, descriptions dans des
# variables, refus dans des gabarits imbriqués. Les textes sont inventés.
BUNDLE = r'''var aB="start_session",cD="archive_session",eF="set_session_title";
var pS=`Start a separate session. \`initiation\` says who wants it.\nAt least ${dS} characters — really.`;
var Gf=`Archive a session. Only call it after the user has explicitly agreed to archive a specific session.`,qf=`\n\nArchiving can be undone.`;
var Yf="Rename a session; unattended, it declines.",Ef="title must be 1 to 50 characters.",jf="title must be plain text. The title was left unchanged; resend it.";
function h(e){return[{name:aB,description:pS,inputSchema:x},{name:cD,description:Gf+(e?qf:""),inputSchema:y},{name:eF,description:Yf,inputSchema:z}]}
function g(r){if(!ok)throw Error(r.k?"other":`Start sessions only on the user's own words to you here; an automated turn. ${r.n?"Start it":'Propose it ("own_initiative")'} later.`)}
function k(t,e){return`Session ${t} was not archived: ${e.reason==="running"?`${t} is still working`:"kept"}`}
'''


def asar(files):
    """Une archive asar : l'en-tête (taille, puis le JSON des fichiers dans un pickle aligné sur 4
    octets), puis les contenus bout à bout, chaque fichier avec son décalage (une chaîne) et sa taille."""
    tree, offset, blobs = {"files": {}}, 0, b""
    for path, data in files.items():
        node = tree
        *folders, name = path.strip("/").split("/")
        for folder in folders:
            node = node["files"].setdefault(folder, {"files": {}})
        node["files"][name] = {"size": len(data), "offset": str(offset)}
        offset += len(data)
        blobs += data
    header = json.dumps(tree).encode()
    payload = struct.pack("<I", len(header)) + header + b"\0" * ((-len(header)) % 4)
    return struct.pack("<I", 4) + struct.pack("<I", 4 + len(payload)) + struct.pack("<I", len(payload)) + payload + blobs


class ReglesAppTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def archive(self, bundle=BUNDLE):
        path = Path(self.dir.name) / "app.asar"
        path.write_bytes(asar({"/package.json": json.dumps({"version": "9.8.7"}).encode(),
                               "/.vite/build/index.chunk-a.js": bundle.encode()}))
        return path

    def test_la_version_et_les_descriptions_des_trois_outils(self):
        rules = regles_app.app_rules(regles_app.read_asar(self.archive()))
        self.assertEqual(rules["version"], "9.8.7")
        tools = rules["tools"]
        self.assertEqual(tools["start_session"]["description"],
                         ["Start a separate session. `initiation` says who wants it.\nAt least ${dS} characters — really."])
        self.assertEqual(tools["archive_session"]["description"],
                         ["Archive a session. Only call it after the user has explicitly agreed to archive a specific session.",
                          "\n\nArchiving can be undone."])
        self.assertEqual(tools["set_session_title"]["description"], ["Rename a session; unattended, it declines."])
        self.assertEqual(tools["archive_session"]["conditional"], [False, True])
        self.assertEqual(tools["start_session"]["conditional"], [False])

    def test_une_description_ecrite_en_litteral_se_lit_seule(self):
        # Ni un mot du littéral (« the ») qui serait aussi une variable, ni une apostrophe ne s'y lisent.
        bundle = BUNDLE.replace("description:Yf,", "description:\"Rename the user's session; it declines.\",") + 'var the="PARASITE";\n'
        tools = regles_app.app_rules(regles_app.read_asar(self.archive(bundle)))["tools"]
        self.assertEqual(tools["set_session_title"]["description"], ["Rename the user's session; it declines."])
        self.assertEqual(tools["set_session_title"]["conditional"], [False])

    def test_un_alias_exporte_par_un_autre_morceau_se_suit_jusqu_a_sa_declaration(self):
        # La forme de l'app 4.23118.0 (extrait réduit) : l'alias dans une chaîne `var` d'un morceau, qui
        # l'exporte sous un autre nom ; l'outil déclaré dans un autre morceau, par ce nom exporté, sur le
        # module requis (`t.y_`), sa description dans une variable de ce second morceau. Un autre morceau
        # qui exporte aussi un `y_`, sans être celui que requiert la déclaration, ne compte pas.
        alias = ('var rga="ccd_session",iga="move_to_cloud",aga="start_session",sga=`mcp__${rga}__${aga}`;\n'
                 'Object.defineProperty(exports,"y_",{enumerable:!0,get:function(){return aga}});\n')
        other = ('var zz="start_session";\n'
                 'Object.defineProperty(exports,"y_",{enumerable:!0,get:function(){return zz}});\n')
        user = ('const e=require("./index.chunk-autre.js"),t=require("./index.chunk-alias.js");\n'
                'var Ax=`Start a separate Claude Code session. \\`initiation\\` says who wants it.`,Bx="PARASITE";\n'
                'function h(e,n){return[...e?[{name:e.y_,description:Bx,inputSchema:q},{name:t.y_,description:Ax,inputSchema:jx,...n?{}:{alwaysLoad:!0}}]:[]]}\n')
        path = Path(self.dir.name) / "app.asar"
        path.write_bytes(asar({"/package.json": json.dumps({"version": "4.23118.0"}).encode(),
                               "/.vite/build/index.chunk-alias.js": alias.encode(),
                               "/.vite/build/index.chunk-autre.js": other.encode(),
                               "/.vite/build/index.chunk-user.js": user.encode()}))
        tools = regles_app.app_rules(regles_app.read_asar(path))["tools"]
        self.assertEqual(tools["start_session"]["description"],
                         ["Start a separate Claude Code session. `initiation` says who wants it."])
        self.assertEqual(tools["start_session"]["conditional"], [False])

    def test_les_refus_sont_lus_en_entier(self):
        tools = regles_app.app_rules(regles_app.read_asar(self.archive()))["tools"]
        self.assertEqual(tools["start_session"]["refusals"],
                         ["Start sessions only on the user's own words to you here; an automated turn. "
                          "${r.n?\"Start it\":'Propose it (\"own_initiative\")'} later."])
        self.assertEqual(tools["archive_session"]["refusals"],
                         ['Session ${t} was not archived: ${e.reason==="running"?`${t} is still working`:"kept"}'])
        self.assertEqual(tools["set_session_title"]["refusals"],
                         ["title must be 1 to 50 characters.", "title must be plain text. The title was left unchanged; resend it."])
        self.assertEqual([tools[t]["missing"] for t in tools], [[], [], []])

    def test_un_repere_introuvable_est_dit(self):
        path = self.archive(BUNDLE.replace("was not archived", "stays"))
        tools = regles_app.app_rules(regles_app.read_asar(path))["tools"]
        self.assertEqual(tools["archive_session"]["refusals"], [])
        self.assertEqual(tools["archive_session"]["missing"], ["was not archived"])
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(regles_app.main(["--asar", str(path)]), 0)
        self.assertIn("introuvable", out.getvalue())

    def test_le_script_lance_par_python_isole_imprime_les_regles(self):
        done = subprocess.run([sys.executable, "-I", str(SCRIPT), "--asar", str(self.archive())],
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("9.8.7", done.stdout)
        self.assertIn("own words to you here", done.stdout)
        self.assertIn("explicitly agreed to archive a specific session", done.stdout)

    def test_un_chemin_qui_n_existe_pas_est_dit(self):
        missing = Path(self.dir.name) / "absent.asar"
        done = subprocess.run([sys.executable, "-I", str(SCRIPT), "--asar", str(missing)],
                              capture_output=True, text=True, timeout=60)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(str(missing), done.stderr)
        self.assertIn("n'existe pas", done.stderr)

    def test_sans_app_trouvee_le_script_demande_le_chemin(self):
        err = io.StringIO()
        with mock.patch.object(regles_app, "DEFAULT_ASAR", Path(self.dir.name) / "Claude.app" / "app.asar"), redirect_stderr(err):
            self.assertNotEqual(regles_app.main([]), 0)
        self.assertIn("--asar <chemin>", err.getvalue())


class GarderTest(unittest.TestCase):
    """`--garder <dossier>` : la sortie imprimée, gardée telle quelle dans `<dossier>/<version>.txt`, jamais
    écrite hors du dossier donné ni sur le fichier d'une version déjà gardée dont le contenu diffère."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.root = Path(self.dir.name)
        self.keep = self.root / "sorties"

    def archive(self, version="9.8.7", bundle=BUNDLE, package=None):
        path = self.root / "app.asar"
        if package is None:
            package = json.dumps({} if version is None else {"version": version}).encode()
        path.write_bytes(asar({"/package.json": package, "/.vite/build/index.chunk-a.js": bundle.encode()}))
        return path

    def run_main(self, *args, version="9.8.7", bundle=BUNDLE, package=None, without_dir_fd=False):
        """Un lancement de main() dans le processus ; un test qui garde une sortie est sauté là où --garder
        est refusé (sans dir_fd, Windows), sauf `without_dir_fd` : le cas où ce refus, ou ce qui le précède,
        est ce qu'il éprouve."""
        if "--garder" in args and not regles_app.USE_DIR_FD and not without_dir_fd:
            self.skipTest("sans dir_fd, --garder est refusé (test_sans_dir_fd_garder_est_refuse_sans_rien_ecrire)")
        out, err = io.StringIO(), io.StringIO()
        asar_path = self.archive(version, bundle, package)
        with redirect_stdout(out), redirect_stderr(err):
            code = regles_app.main(["--asar", str(asar_path), *args])
        return code, out.getvalue(), err.getvalue()

    def entries(self, folder=None):
        return sorted(p.name for p in (folder or self.keep).iterdir())

    def test_une_version_en_forme_garde_la_sortie_telle_quelle_et_dit_le_chemin(self):
        code, out, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 0, err)
        kept = self.keep / "9.8.7.txt"
        self.assertEqual(kept.read_bytes(), out.encode("utf-8"))
        self.assertIn(str(kept), err)
        self.assertEqual(self.entries(), ["9.8.7.txt"])
        self.assertEqual(self.run_main()[1], out)  # sans --garder, la même sortie, rien de plus
        self.assertTrue(out.startswith("App Claude 9.8.7"))

    @unittest.skipUnless(regles_app.USE_DIR_FD, "sans dir_fd, --garder est refusé")
    def test_le_script_lance_par_python_isole_garde_la_sortie(self):
        done = subprocess.run([sys.executable, "-I", str(SCRIPT), "--asar", str(self.archive()), "--garder",
                               str(self.keep)], capture_output=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual((self.keep / "9.8.7.txt").read_bytes(), done.stdout.replace(b"\r\n", b"\n"))

    def test_une_version_hors_forme_n_ecrit_rien_et_sort_en_erreur(self):
        arabic = chr(0x664) + "." + chr(0x661)  # chiffres arabes-indiens, que `\d` accepterait
        for version in ("4.1\n", arabic, "1", "1.2.3.4.5", "../1.2", "1.2/3", "1.2 ", "", None, 42, "1" * 11 + ".2"):
            with self.subTest(version=repr(version)):
                code, out, err = self.run_main("--garder", str(self.keep), version=version, without_dir_fd=True)
                self.assertEqual(code, 1)
                self.assertIn("rien n'est gardé", err)
                self.assertFalse(self.keep.exists())
                self.assertIn("App Claude", out)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["app.asar"])

    def test_un_package_json_qui_n_est_pas_un_objet_donne_une_version_introuvable(self):
        for package in (b"[1, 2]", b'"texte"', b"{"):
            with self.subTest(package=package):
                code, out, err = self.run_main(package=package)
                self.assertEqual(code, 0, err)
                self.assertIn("(version introuvable)", out)

    def test_un_contenu_identique_n_est_pas_reecrit(self):
        self.assertEqual(self.run_main("--garder", str(self.keep))[0], 0)
        kept = self.keep / "9.8.7.txt"
        before = kept.stat()
        code, _, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 0, err)
        self.assertIn("identique", err)
        self.assertEqual((kept.stat().st_ino, kept.stat().st_mtime_ns), (before.st_ino, before.st_mtime_ns))
        self.assertEqual(self.entries(), ["9.8.7.txt"])

    def test_un_contenu_different_ne_l_ecrase_pas_et_ecrit_la_nouvelle_sortie_a_cote(self):
        self.keep.mkdir()
        kept = self.keep / "9.8.7.txt"
        kept.write_bytes(b"ancienne sortie\n")
        code, out, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 1)
        self.assertEqual(kept.read_bytes(), b"ancienne sortie\n")
        fresh = self.keep / "9.8.7.nouveau.txt"
        self.assertEqual(fresh.read_bytes(), out.encode("utf-8"))
        self.assertIn(str(kept), err)
        self.assertIn(str(fresh), err)
        # Le fichier `.nouveau.txt` se réécrit, le fichier gardé jamais.
        code, out, err = self.run_main("--garder", str(self.keep), bundle=BUNDLE + "\n// autre\n")
        self.assertEqual(code, 1)
        self.assertEqual(kept.read_bytes(), b"ancienne sortie\n")
        self.assertEqual(fresh.read_bytes(), out.encode("utf-8"))
        self.assertEqual(self.entries(), ["9.8.7.nouveau.txt", "9.8.7.txt"])

    def test_un_nouveau_fichier_en_lien_dur_vers_l_exterieur_ne_change_pas_l_exterieur(self):
        self.keep.mkdir()
        (self.keep / "9.8.7.txt").write_bytes(b"ancienne sortie\n")
        outside = self.root / "dehors.txt"
        outside.write_bytes(b"dehors\n")
        os.link(outside, self.keep / "9.8.7.nouveau.txt")
        self.assertEqual(self.run_main("--garder", str(self.keep))[0], 1)
        self.assertEqual(outside.read_bytes(), b"dehors\n")
        self.assertNotEqual((self.keep / "9.8.7.nouveau.txt").read_bytes(), b"dehors\n")

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_un_lien_symbolique_est_refuse_sans_rien_ecrire(self):
        outside = self.root / "dehors"
        outside.mkdir()
        target = outside / "cible.txt"
        target.write_bytes(b"dehors\n")
        cases = {}
        # Le dossier donné est un lien (avec ou sans barre finale).
        (self.root / "lien").symlink_to(outside, target_is_directory=True)
        cases["dossier"] = (str(self.root / "lien"), outside)
        cases["dossier/"] = (str(self.root / "lien") + "/", outside)
        # Le fichier de la version est un lien.
        one = self.root / "un"
        one.mkdir()
        (one / "9.8.7.txt").symlink_to(target)
        cases["version"] = (str(one), one)
        # Le fichier `.nouveau.txt` est un lien (contenu gardé différent).
        two = self.root / "deux"
        two.mkdir()
        (two / "9.8.7.txt").write_bytes(b"ancienne sortie\n")
        (two / "9.8.7.nouveau.txt").symlink_to(target)
        cases["nouveau"] = (str(two), two)
        for label, (folder, watched) in cases.items():
            with self.subTest(cas=label):
                before = sorted(p.name for p in watched.iterdir())
                code, _, err = self.run_main("--garder", folder)
                self.assertEqual(code, 1, err)
                self.assertIn("lien", err)
                self.assertEqual(target.read_bytes(), b"dehors\n")
                self.assertEqual(sorted(p.name for p in watched.iterdir()), before)
        self.assertEqual((two / "9.8.7.txt").read_bytes(), b"ancienne sortie\n")

    def test_une_cible_qui_n_est_pas_un_fichier_ordinaire_est_refusee(self):
        (self.keep / "9.8.7.txt").mkdir(parents=True)
        code, _, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 1)
        self.assertIn("pas un fichier ordinaire", err)
        self.assertEqual(self.entries(), ["9.8.7.txt"])

    def test_un_dossier_vide_un_parent_absent_ou_un_fichier_sont_refuses(self):
        plain = self.root / "fichier"
        plain.write_bytes(b"x")
        for folder in ("", str(self.root / "absent" / "sorties"), str(plain)):
            with self.subTest(folder=folder):
                code, _, err = self.run_main("--garder", folder)
                self.assertEqual(code, 1)
                self.assertIn("rien n'est gardé", err)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["app.asar", "fichier"])

    def test_un_lien_dur_impossible_ne_garde_rien(self):
        with mock.patch.object(regles_app.os, "link", side_effect=OSError(1, "Operation not permitted")):
            code, _, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 1)
        self.assertIn("Operation not permitted", err)
        self.assertNotIn("Traceback", err)
        self.assertEqual(self.entries(), [])

    def test_un_temporaire_impossible_a_retirer_ne_dit_pas_rien_garde_d_une_sortie_gardee(self):
        real_unlink = os.unlink

        def refuse(path, *args, **kwargs):
            if str(path).startswith(".9.8.7.tmp-"):
                raise PermissionError(13, "Permission denied")
            return real_unlink(path, *args, **kwargs)

        with mock.patch.object(regles_app.os, "unlink", side_effect=refuse):
            code, out, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 0, err)
        self.assertIn("sortie gardée", err)
        self.assertIn("temporaire", err)
        self.assertNotIn("rien n'est gardé", err)
        self.assertEqual((self.keep / "9.8.7.txt").read_bytes(), out.encode("utf-8"))

    def test_un_nom_pris_pendant_l_ecriture_se_compare_sans_rien_ecraser(self):
        # Un autre lancement garde la même version entre le contrôle et le lien dur : FileExistsError, puis
        # la comparaison ; son fichier n'est jamais écrasé.
        real_link = os.link

        def other_run_first(src, dst, *args, **kwargs):
            (self.keep / dst).write_bytes(b"sortie d'un autre lancement\n")
            return real_link(src, dst, *args, **kwargs)

        with mock.patch.object(regles_app.os, "link", side_effect=other_run_first):
            code, out, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 1)
        self.assertEqual((self.keep / "9.8.7.txt").read_bytes(), b"sortie d'un autre lancement\n")
        self.assertEqual((self.keep / "9.8.7.nouveau.txt").read_bytes(), out.encode("utf-8"))
        self.assertEqual(self.entries(), ["9.8.7.nouveau.txt", "9.8.7.txt"])

    def test_la_commande_de_comparaison_cite_ses_chemins(self):
        spaced = self.root / "mes sorties"
        spaced.mkdir()
        (spaced / "9.8.7.txt").write_bytes(b"ancienne sortie\n")
        code, _, err = self.run_main("--garder", str(spaced))
        self.assertEqual(code, 1)
        self.assertIn(f"diff '{spaced / '9.8.7.txt'}' '{spaced / '9.8.7.nouveau.txt'}'", err)

    def test_une_version_identique_signale_un_ancien_fichier_nouveau(self):
        self.assertEqual(self.run_main("--garder", str(self.keep))[0], 0)
        (self.keep / "9.8.7.nouveau.txt").write_bytes(b"ancienne autre sortie\n")
        code, _, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 0)
        self.assertIn("identique", err)
        self.assertIn("9.8.7.nouveau.txt existe aussi", err)
        self.assertEqual((self.keep / "9.8.7.nouveau.txt").read_bytes(), b"ancienne autre sortie\n")

    def test_le_garde_de_la_version_passe_le_corpus_hostile_commun(self):
        # Règle « Un garde de forme passe le corpus hostile commun » : le corpus de flow-board (`tests/corpus.mjs`),
        # lu par le lecteur de test_check_snapshot.py ; chaque entrée, seule ou glissée dans une version valide,
        # est refusée.
        spec = importlib.util.spec_from_file_location("corpus_lecteur", Path(__file__).with_name("test_check_snapshot.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        entries = module.SnapshotTicketFormTest.corpus()
        self.assertGreater(len(entries), 60)
        self.assertIsNotNone(regles_app.VERSION.fullmatch("5.1231.2"))
        passing = [name for name, token in entries.items()
                   if any(regles_app.VERSION.fullmatch(form) for form in (token, f"5.{token}2", f"5{token}.2", f"5.2{token}"))]
        self.assertEqual(passing, [])
        self.assertIsNone(regles_app.VERSION.fullmatch("1." + "2" * 11))


    def test_sans_dir_fd_garder_est_refuse_sans_rien_ecrire(self):
        # Sans `dir_fd` (Windows), écrire par des chemins laisserait un dossier remplacé par un lien déplacer
        # les écritures : --garder est refusé.
        with mock.patch.object(regles_app, "USE_DIR_FD", False):
            code, out, err = self.run_main("--garder", str(self.keep), without_dir_fd=True)
        self.assertEqual(code, 1)
        self.assertIn("dir_fd", err)
        self.assertIn("App Claude 9.8.7", out)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["app.asar"])

    def test_une_interruption_apres_le_temporaire_le_retire(self):
        with mock.patch.object(regles_app.os, "link", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_main("--garder", str(self.keep))
        self.assertEqual(self.entries(), [])

    def test_un_disque_plein_pendant_le_temporaire_le_retire_et_ne_touche_pas_au_fichier_garde(self):
        self.keep.mkdir()
        (self.keep / "9.8.7.txt").write_bytes(b"ancienne sortie\n")
        with mock.patch.object(regles_app.os, "fsync", side_effect=OSError(28, "No space left on device")):
            code, _, err = self.run_main("--garder", str(self.keep))
        self.assertEqual(code, 1)
        self.assertIn("No space left on device", err)
        self.assertIn("n'est pas modifié", err)
        self.assertEqual(self.entries(), ["9.8.7.txt"])
        self.assertEqual((self.keep / "9.8.7.txt").read_bytes(), b"ancienne sortie\n")


if __name__ == "__main__":
    unittest.main()
