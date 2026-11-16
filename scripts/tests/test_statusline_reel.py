"""La barre d'état (config/statusline.py) montre le modèle et l'effort de la dernière requête du fil principal
tels que flow-board les a envoyés, relevés dans le registre de la session (main.sent), tant que le réglage de la
session est encore celui sous lequel elle est partie ; sinon le réglage de la session.

Cas de départ : la session est en Opus 5.5 high et le mod envoie le cadrage en Fable 5.2 medium ; la barre
affichait « Opus 5.5 (high) ».
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

STATUSLINE = Path(__file__).resolve().parents[2] / 'config' / 'statusline.py'
SESSION = '00000000-1111-4222-8333-444444444444'
SENT = {'model': 'claude-fable-5-2', 'effort': 'medium', 'session': {'model': 'claude-opus-5-5', 'effort': 'high'}, 'at': 1}


def run(payload: dict, home: Path) -> str:
    env = {**os.environ, 'HOME': str(home), 'USERPROFILE': str(home)}
    out = subprocess.run([sys.executable, '-I', str(STATUSLINE)], input=json.dumps(payload), capture_output=True, text=True, env=env, timeout=20)
    return out.stdout


def payload() -> dict:
    return {
        'session_id': SESSION,
        'workspace': {'current_dir': '/x/projet'},
        'model': {'id': 'claude-opus-5-5', 'display_name': 'Opus 5.5'},
        'effort': {'level': 'high'},
    }


class BarreReelle(unittest.TestCase):
    def line_with(self, registry) -> str:
        """La barre, avec ce registre de la session (un texte tel quel, ou un objet écrit en JSON)."""
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            agents = home / '.claude' / 'flow-board' / 'agents'
            agents.mkdir(parents=True)
            text = registry if isinstance(registry, str) else json.dumps(registry)
            (agents / f'{SESSION}.json').write_text(text, encoding='utf-8')
            return run(payload(), home)

    def test_requete_reecrite_par_le_mod(self):
        line = self.line_with({'v': 1, 'session': SESSION, 'main': {'effort': 'high', 'models': ['claude-fable-5-2'], 'sent': SENT}})
        self.assertIn('Fable 5.2 (medium)', line)
        self.assertNotIn('Opus 5.5 (high)', line)

    def test_requete_ramenee_sur_opus_pendant_qu_elle_tourne(self):
        # Session sur Fable, requête ramenée sur Opus par le mod (alias « opus », relevé avant la réponse) :
        # la barre dit Opus 5.5, pas le réglage Fable (retour sur Opus hors du cadrage, 14/11/2026).
        sent = {'model': 'opus', 'effort': 'medium', 'session': {'model': 'claude-fable-5-2', 'effort': 'high'}, 'at': 1}
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            agents = home / '.claude' / 'flow-board' / 'agents'
            agents.mkdir(parents=True)
            (agents / f'{SESSION}.json').write_text(json.dumps({'v': 1, 'session': SESSION, 'main': {'sent': sent}}), encoding='utf-8')
            line = run({**payload(), 'model': {'id': 'claude-fable-5-2', 'display_name': 'Fable 5.2'}}, home)
        self.assertIn('Opus 5.5 (medium)', line)
        self.assertNotIn('Fable 5.2 (high)', line)

    def test_releve_fait_sous_un_autre_reglage(self):
        # Un /model ou un /effort tapé depuis la dernière requête : le relevé ne vaut plus, la barre montre le réglage.
        for session in ({'model': 'claude-sonnet-5-5', 'effort': 'low'}, {'model': 'claude-opus-5-5', 'effort': 'low'}, {'model': 'claude-sonnet-5-5', 'effort': 'high'}):
            sent = {**SENT, 'session': session}
            self.assertIn('Opus 5.5 (high)', self.line_with({'v': 1, 'session': SESSION, 'main': {'sent': sent}}))

    def test_releve_du_reglage_change_sans_effort(self):
        # Le relevé que le mod écrit après un /model ou un /effort : sans effort, la barre montre le réglage.
        sent = {'model': 'claude-opus-5-5', 'session': {'model': 'claude-opus-5-5'}, 'at': 1}
        self.assertIn('Opus 5.5 (high)', self.line_with({'v': 1, 'session': SESSION, 'main': {'sent': sent}}))

    def test_releve_d_une_autre_session(self):
        self.assertIn('Opus 5.5 (high)', self.line_with({'v': 1, 'session': 'autre-session', 'main': {'sent': SENT}}))

    def test_registre_illisible_ou_releve_hors_forme(self):
        self.assertIn('Opus 5.5 (high)', self.line_with('{pas du json'))
        self.assertIn('Opus 5.5 (high)', self.line_with({'v': 1, 'session': SESSION, 'main': {'sent': {**SENT, 'model': 'opus; rm -rf ~'}}}))
        self.assertIn('Opus 5.5 (high)', self.line_with({'v': 1, 'session': SESSION, 'main': {'sent': {**SENT, 'effort': 'medium\n\x1b[31m'}}}))

    def line_1m(self, sent_effort: str) -> str:
        """La barre d'une session 1M en Opus 5.5 high, sa requête partie sur Opus 5.5 à cet effort."""
        sent = {'model': 'claude-opus-5-5', 'effort': sent_effort, 'session': {'model': 'claude-opus-5-5[1m]', 'effort': 'high'}, 'at': 1}
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            agents = home / '.claude' / 'flow-board' / 'agents'
            agents.mkdir(parents=True)
            (agents / f'{SESSION}.json').write_text(json.dumps({'v': 1, 'session': SESSION, 'main': {'sent': sent}}), encoding='utf-8')
            data = {**payload(), 'model': {'id': 'claude-opus-5-5[1m]', 'display_name': 'Opus 5.5 (1M context)'}}
            return run(data, home)

    def test_requete_non_reecrite_garde_le_nom_affiche(self):
        # Session 1M sans réécriture : la requête partie est le réglage, la barre garde « (1M context) ».
        self.assertIn('Opus 5.5 (1M context) (high)', self.line_1m('high'))

    def test_effort_seul_reecrit_garde_le_nom_affiche(self):
        # Session 1M dont seul l'effort est réécrit (un ticket de jugement en xhigh) : le nom reste, l'effort change.
        self.assertIn('Opus 5.5 (1M context) (xhigh)', self.line_1m('xhigh'))

    def test_sans_nom_affiche_le_nom_releve(self):
        # Une donnée de Claude Code sans display_name : la barre garde le nom tiré du relevé, comme avant.
        sent = {**SENT, 'model': 'claude-opus-5-5', 'effort': 'xhigh'}
        with tempfile.TemporaryDirectory() as d:
            home = Path(d)
            agents = home / '.claude' / 'flow-board' / 'agents'
            agents.mkdir(parents=True)
            (agents / f'{SESSION}.json').write_text(json.dumps({'v': 1, 'session': SESSION, 'main': {'sent': sent}}), encoding='utf-8')
            line = run({**payload(), 'model': {'id': 'claude-opus-5-5'}}, home)
        self.assertIn('Opus 5.5 (xhigh)', line)

    def test_sans_registre_la_session(self):
        with tempfile.TemporaryDirectory() as d:
            line = run(payload(), Path(d))
        self.assertIn('Opus 5.5 (high)', line)


if __name__ == '__main__':
    unittest.main()
