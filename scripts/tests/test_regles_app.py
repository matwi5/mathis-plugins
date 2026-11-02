"""Tests de scripts/regles-app.py : les règles des outils de l'app Desktop lues dans un faux `app.asar`
(une archive minimale au format d'Electron, des textes inventés à la forme du code minifié de l'app), et
les erreurs de son chemin. python3 -m unittest discover -s scripts/tests."""

import importlib.util
import io
import json
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


if __name__ == "__main__":
    unittest.main()
