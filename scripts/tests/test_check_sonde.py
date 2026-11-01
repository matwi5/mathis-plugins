"""Tests des contrôles de la sonde avant `tsc` (scripts/check.py, `tool_static_checks`) : termes de
l'export public et API du moteur dans le Claude Code de l'app. python3 -m unittest discover -s scripts/tests."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

# Une valeur que l'export refuse, écrite par morceaux : ce fichier part dans la version publique.
MAIL = "git" + "@" + "example.com"
HAS_EXPORT = (Path(check.__file__).resolve().parent / "export_public.py").is_file()
# Les types du moteur de l'app, réduits à ce que lit `engine_api` : l'espace `env` et son `get`.
ENGINE = "\n".join([
    "  " + check.ENGINE_INTERFACE,
    "      env: {",
    "          get: (name: string) => Promise<string | undefined>;",
    "      };",
    "  }",
])


class SondeStaticChecksTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.module = Path(self.dir.name) / "sonde"
        (self.module / "hooks").mkdir(parents=True)
        (self.module / "tests").mkdir()
        (self.module / "hooks" / "register.tsx").write_text("const d = await $.env.get('X')\n", encoding="utf-8")
        self.desktop = (Path(self.dir.name) / "claude", "9.9.9")
        for name, value in (("EXPORT_DENYLIST", Path(self.dir.name) / "aucune.txt"),
                            ("engine_declarations", lambda binary: (ENGINE, None))):
            patcher = mock.patch.object(check, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def tearDown(self):
        self.dir.cleanup()

    def test_check_sonde_lance_l_export_et_l_api_avant_tsc(self):
        # Le branchement dans check_tool : un appel inconnu de l'app arrête la cible avant tsc et les tests.
        (self.module / "hooks" / "register.tsx").write_text("await $.env.list()\n", encoding="utf-8")
        ran = []
        with mock.patch.object(check, "tool", lambda name: name), \
                mock.patch.object(check, "typecheck", lambda m: ran.append("tsc")), \
                mock.patch.object(check, "plugin_tests", lambda *a: ran.append("tests")), \
                mock.patch.object(check, "run", lambda *a, **k: (0, "9.9.9 (Claude Code)")), \
                mock.patch.object(check, "REPO", Path(self.dir.name)):
            with self.assertRaisesRegex(check.Failed, "API que l'app ne connaît pas"):
                check.check_tool(self.module, self.desktop)
        self.assertEqual(ran, [])

    def test_les_messages_citent_le_chemin_de_la_sonde_depuis_le_depot(self):
        sonde = check.TOOLS["sonde"]
        self.assertTrue(all(where.startswith("scripts/sonde/hooks/") for where, _, _ in check.engine_calls(sonde)))

    def test_une_sonde_propre_passe(self):
        check.tool_static_checks(self.module, self.desktop)

    @unittest.skipUnless(HAS_EXPORT, "sans scripts/export_public.py (version publique)")
    def test_une_adresse_dans_un_test_de_la_sonde_est_refusee(self):
        (self.module / "tests" / "a.test.ts").write_text(f"const m = '{MAIL}'\n", encoding="utf-8")
        with self.assertRaisesRegex(check.Failed, "export public"):
            check.tool_static_checks(self.module, self.desktop)

    def test_un_appel_que_l_app_ne_connait_pas_est_refuse(self):
        (self.module / "hooks" / "register.tsx").write_text("await $.env.list()\n", encoding="utf-8")
        with self.assertRaisesRegex(check.Failed, "API que l'app ne connaît pas"):
            check.tool_static_checks(self.module, self.desktop)


if __name__ == "__main__":
    unittest.main()
