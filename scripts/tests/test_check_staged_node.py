"""Tests des tests Node d'un plugin au hook pre-commit (scripts/check.py, `staged_code`) : un commit qui
crée un module de `hooks/` avec un cycle d'imports est refusé par les tests Node du plugin, lancés sur la
copie de l'index avant la suite du moteur, même pour un commit de commentaires seuls dans `hooks/`.
python3 -m unittest discover -s scripts/tests."""

import io
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check  # noqa: E402
from test_check_staged_regles import CODE, HOOK, StagedRepo  # noqa: E402  (le dépôt d'essai du hook)

# Un test Node du plugin, comme `modules-sans-cycle.test.mjs` de flow-board : il lit les sources de hooks/
# à côté de lui, donc celles de la copie de l'index quand le hook le lance.
CYCLE_TEST = """import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const dir = new URL('../hooks/', import.meta.url)
const deps = file => [...readFileSync(new URL(file, dir), 'utf8').matchAll(/from '\\.\\/(\\w+)'/g)].map(m => `${m[1]}.ts`)

test('aucun module de hooks/ ne revient sur lui-même', () => {
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const seen = new Set()
    const todo = deps(file)
    while (todo.length) {
      const next = todo.pop()
      if (seen.has(next)) continue
      seen.add(next)
      todo.push(...deps(next))
    }
    assert.ok(!seen.has(file), `${file} revient sur lui-même`)
  }
})
"""
NODE_TEST = "plugins/flow-board/tests/modules-sans-cycle.test.mjs"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class NodeTestsStagedTest(StagedRepo):
    """La suite du moteur, `tsc` et les tests épinglés sont remplacés par un relevé des appels ; les tests
    Node tournent pour de bon, par `node --test`, sur la copie de l'index."""

    def setUp(self):
        super().setUp()
        self.write(NODE_TEST, CYCLE_TEST)
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "test des cycles")
        self.calls = []
        for name in ("typecheck", "plugin_tests", "engine_subset"):
            patcher = mock.patch.object(check, name, lambda *args, _n=name, **kw: self.calls.append((_n, args)))
            patcher.start()
            self.addCleanup(patcher.stop)
        original = check.node_tests

        def node(plugin):
            self.calls.append(("node_tests", (plugin,)))
            return original(plugin)
        for name, value in (("node_tests", node), ("EXPORT_DENYLIST", self.repo / "absente.txt")):
            patcher = mock.patch.object(check, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def ran(self):
        return [name for name, _ in self.calls]

    def staged(self):
        with redirect_stdout(io.StringIO()) as out:
            check.staged()
        return out.getvalue()

    def test_un_module_neuf_qui_cree_un_cycle_d_imports_est_refuse(self):
        self.stage("plugins/flow-board/hooks/a.ts", "import { b } from './b'\nexport const a = () => b\n")
        self.stage("plugins/flow-board/hooks/b.ts", "import { a } from './a'\nexport const b = () => a\n")
        out = io.StringIO()
        with redirect_stdout(out), self.assertRaises(check.Failed) as caught:
            check.staged()
        self.assertIn("node --test", str(caught.exception))
        self.assertIn("revient sur lui-même", out.getvalue())
        self.assertNotIn("plugin_tests", self.ran())

    def test_les_tests_node_tournent_sur_la_copie_de_l_index_avant_la_suite_du_moteur(self):
        # L'arbre de travail porte un cycle que l'index n'a pas : seul ce qui part est relu.
        self.write("plugins/flow-board/hooks/a.ts", "import { a } from './a'\n")
        self.stage(HOOK, CODE.replace("Parcours", "Mission"))
        out = self.staged()
        self.assertEqual([n for n in self.ran() if n in ("node_tests", "plugin_tests")], ["node_tests", "plugin_tests"])
        tree = self.calls[self.ran().index("node_tests")][1][0]
        self.assertNotEqual(tree, check.PLUGINS / "flow-board")
        self.assertIn("node --test plugins/flow-board/tests/modules-sans-cycle.test.mjs", out)

    def test_un_commentaire_seul_dans_hooks_lance_les_tests_node_sans_la_suite(self):
        out = self.staged_after(HOOK, "// la règle (Q3), relue\n" + CODE.split("\n", 1)[1])
        self.assertIn("node_tests", self.ran())
        self.assertNotIn("plugin_tests", self.ran())
        self.assertIn("commentaires seuls dans hooks/, suite du plugin sautée", out)

    def test_un_plugin_identique_a_un_check_sh_vert_saute_aussi_les_tests_node(self):
        with mock.patch.object(check, "passed_already", lambda plugin: True):
            self.staged_after(HOOK, CODE.replace("Parcours", "Mission"))
        self.assertNotIn("node_tests", self.ran())

    def test_les_tests_node_ne_recoivent_pas_les_variables_git_du_hook(self):
        # Le hook reçoit de git GIT_INDEX_FILE et GIT_DIR : un test Node qui fait `git add` dans un dépôt
        # jetable écrirait dans l'index du vrai commit.
        self.write("plugins/flow-board/tests/sans-git.test.mjs", "import { test } from 'node:test'\n"
                   "import assert from 'node:assert/strict'\n"
                   "test('aucune variable GIT_', () => assert.deepEqual(Object.keys(process.env).filter(k => k.startsWith('GIT_')), []))\n")
        git(self.repo, "add", ".")
        with mock.patch.dict("os.environ", {"GIT_INDEX_FILE": str(self.repo / ".git/index"), "GIT_DIR": str(self.repo / ".git")}):
            out = self.staged()
        self.assertIn("sans-git.test.mjs", out)

    def staged_after(self, rel, text):
        self.stage(rel, text)
        return self.staged()


if __name__ == "__main__":
    unittest.main()
