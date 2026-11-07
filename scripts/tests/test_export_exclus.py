"""Tests de ce que l'export public laisse de côté (scripts/export_public.py, liste EXCLUDED) :
python3 -m unittest discover -s scripts/tests.

Le hook du dépôt qui refuse un `cd` dans un sous-dossier ne vaut que pour ce dépôt, dont le CLAUDE.md
porte le piège : ni son réglage, ni son script, ni ses tests ne partent dans la version publique. De même
le détail de check.sh (docs/check-sh.md) et les pièges des mods (.claude/rules/), sortis du CLAUDE.md privé.
Sans scripts/export_public.py (la version publique), ces tests sont sans objet."""

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
HAS_EXPORT = (SCRIPTS / "export_public.py").is_file()
sys.path.insert(0, str(SCRIPTS))


@unittest.skipUnless(HAS_EXPORT, "sans scripts/export_public.py (version publique)")
class ExportExclusTest(unittest.TestCase):
    def test_le_hook_du_cd_son_reglage_et_ses_tests_ne_partent_pas_dans_l_instantane_public(self):
        import export_public
        with tempfile.TemporaryDirectory() as tmp:
            staging = Path(tmp) / "public"
            staging.mkdir()
            export_public.build_snapshot("HEAD", staging)
            self.assertFalse((staging / ".claude" / "settings.json").exists())
            self.assertFalse((staging / "scripts" / "hooks" / "refuse-cd.py").exists())
            self.assertFalse((staging / "scripts" / "tests" / "test_refuse_cd.py").exists())
            # Les hooks git du dépôt, eux, partent toujours.
            self.assertTrue((staging / "scripts" / "hooks" / "pre-commit").is_file())

    def test_le_detail_de_check_sh_et_les_pieges_des_mods_ne_partent_pas(self):
        # Sortis du CLAUDE.md privé, ils le prolongent : le CLAUDE.md public a son propre texte.
        import export_public
        with tempfile.TemporaryDirectory() as tmp:
            staging = Path(tmp) / "public"
            staging.mkdir()
            export_public.build_snapshot("HEAD", staging)
            self.assertFalse((staging / "docs" / "check-sh.md").exists())
            self.assertFalse((staging / ".claude" / "rules" / "pieges-des-mods.md").exists())
            self.assertTrue((staging / "docs" / "evenements-moteur.md").is_file())


if __name__ == "__main__":
    unittest.main()
