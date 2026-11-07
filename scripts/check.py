#!/usr/bin/env python3
"""Contrôles d'un plugin du dépôt, dans l'ordre, arrêtés au premier échec (sauf l'arbre « Architecture »).

    scripts/check.sh <plugin>...           tous les contrôles des plugins nommés (scripts\\check.cmd sous Windows)
    scripts/check.sh --all                 tous les plugins (et la sonde)
    scripts/check.sh sonde                 la sonde des événements du moteur (scripts/sonde/) : export, API, tsc, tests
    scripts/check.sh <plugin> --no-desktop sans le Claude Code de l'app desktop (poste sans l'app)
    scripts/check.sh --staged              le hook pre-commit : les plugins dont un fichier est indexé
    scripts/check.sh --fix <plugin>...     réécrit l'arbre « Architecture » du README et retire les blocs /** */ détachés, sans rien contrôler
    scripts/check.sh --test <fichier>... <plugin>  ces seuls fichiers de test (nom nu ou chemin), terminal seulement
    scripts/check.sh --quick <plugin>...   pré-contrôle rapide : contrôles statiques, tsc, tests Node et fichiers de test touchés face à HEAD
    scripts/check.sh --tsc <plugin>...     le seul `tsc` des plugins (types du moteur copiés dans un worktree)

Les contrôles d'un plugin, chacun seulement s'il s'applique :
1. pas de renvoi aux tickets ni aux dossiers de travail (`travail/`, absent de la version publique) ;
2. l'arbre « Architecture » du README cite chaque fichier de `hooks/` et de `tests/` (`--fix` l'écrit,
   en gardant le commentaire de chaque ligne existante) : un fichier absent est signalé sans couper
   les contrôles suivants, et la commande échoue à la fin ;
   les termes retirés du plugin (`termes-retires.txt`, une version et un terme par ligne) sont absents
   de son README, de ses consignes (`hooks/`, `skills/`, `commands/`, `reference/`, hors fichiers de
   test), de ses types (`types/*.d.ts`), de sa règle (`config/rules/<plugin>.md`) et des entrées de son
   CHANGELOG plus récentes que la version qui les a retirés, au-delà des sites gardés exprès, admis
   fichier par fichier (`scripts/termes-retires-admis.json`) ;
   un renvoi « section « X » de `<fichier>.md` » de ses fichiers (hors tests et CHANGELOG) et de sa
   règle vers les règles et les références communes (`config/rules/`, `config/reference/`, un nom nu
   lu à côté du fichier qui renvoie ou parmi elles ; depuis une règle commune, un nom nu disparu est
   introuvable) vise un fichier qui existe et un titre X qu'il a ;
   ses fichiers (tests compris) passent les termes de l'export public (`scripts/export_public.py` :
   adresses mail hors de la liste permise, dossiers personnels, termes de la liste privée), contrôle
   sans objet sans ce script ;
   le code (hors `tests/`) n'étale pas une liste dans `Math.min` ou `Math.max` (au-delà de 100 000
   éléments, l'étalement lève une erreur) et n'a pas de bloc `/** */` suivi directement d'un autre
   (le premier ne documente plus rien ; `--fix` le retire et garde le second) ; aucune source `.ts`, `.tsx` ou `.mjs` (tests compris) n'a de
   caractère invisible ou séparateur brut (U+0085, U+2028, U+2029, U+200B à U+200F, U+202A à U+202E,
   U+2060 à U+2069, U+FEFF) : seulement son échappement ; les hooks de flow-board n'insèrent pas
   dans un texte une valeur relue du parcours brute (`${run.title}`, `${run.id}`, `${g.id}`,
   `${…why}`) hors d'une fonction de neutralisation, au-delà des sites admis fichier par fichier
   (`scripts/interpolations-admises.json`) ; un module de `hooks/` n'exporte pas de valeur
   (`function`, `const`, `let`, `class`, `enum`, pas un type) qu'aucun autre fichier de code du
   plugin ne nomme, hors l'entrée `register` de `hooks/register.tsx`, au-delà des exports admis
   fichier par fichier (`scripts/exports-admis.json`) ;
   la forme du CHANGELOG : chaque entrée (`## <version> — <date>`) précédée d'une ligne `---`, versions
   uniques, de la plus récente à la plus ancienne, la première égale à la version de `plugin.json`
   (un séparateur perdu au déplacement d'une entrée n'avait été vu qu'au compte rendu) ;
   la version : une version que la branche a changée (face au point où elle part de `main`, puis
   de `origin/main`) est strictement plus grande que celle de cette référence (une autre discussion
   avait publié le même numéro) ; aucun marqueur « 0.xx.0 » du README écrit avant la dernière montée
   de version (`scripts/bump-version.py` les remplace) ;
   les appels `$.<espace>.<membre>` des hooks existent dans le Claude Code de l'app (les types qu'il
   embarque, décompressés par `zstd`) : une API qu'il ne connaît pas efface le mod dans l'app, et le
   faux moteur des tests ne la voit pas ; sauté avec un avertissement sans l'app ou sans `zstd` ;
3. types : `tsc` d'une version fixée de TypeScript, par npx (aucune installation globale). Les types
   du moteur (`.claude-plugin/types/`, ignorés par git) manquent dans un worktree : ils sont copiés
   depuis le clone principal ;
4. `node --test` des tests Node des skills et du plugin (`skills/**/*.test.mjs`, `tests/**/*.test.mjs` :
   ceux qui lisent les sources, ce que `claude plugin test` ne permet pas) ;
5. `claude plugin test` avec le Claude Code du terminal, puis avec le binaire le plus récent de
   l'app desktop, trouvé ici (Mac et Windows) ;
6. `claude plugin validate` du plugin, puis du dépôt ;
7. les versions des plugins contrôlés citées dans la liste « État » d'ETAT_DU_PROJET.md (fichier
   personnel, lu seulement ; contrôle sans objet sans lui) égales à celles de leur `plugin.json`.

--staged (hook pre-commit, décision « Hook »), tout sur une copie de l'index : d'abord les numéros de série de chaque
fichier de décisions indexé (`travail/<sujet>/DECISIONS.md`), même pour un commit de documentation seule : un titre
« ## Série N » ajouté (face à `HEAD`) avec un numéro déjà pris dans le fichier est refusé, les doublons déjà commités
passent ; puis chaque ticket indexé (`travail/<sujet>/issues/*.md`) qui dit « Zone sensible : oui » porte une
ligne « Recherche » avec une commande et son résultat (sur la ligne, ou dans le bloc de code qui la suit),
sauf un ticket que `HEAD` portait déjà sensible sans elle, et n'a aucune case mal formée hors bloc de code
(seules `- [ ] ` et `- [x] ` sont des cases : `- [x ]`, `- [ x]`, `- []` sont refusées) ;
puis, même pour un commit de documentation seule, une liste d'admis indexée (`scripts/renvois-admis.json`,
`scripts/interpolations-admises.json`, `scripts/termes-retires-admis.json`, `scripts/exports-admis.json`) qui augmente un compte face à `HEAD` (une clé nouvelle comprise) est
refusée, et chaque plugin dont la règle (`config/rules/<plugin>.md`) est indexée, ou dont une liste d'admis
indexée change un compte, passe sur la copie de l'index les contrôles statiques qui les lisent (termes
retirés, renvois admis, valeurs relues brutes, exports morts, renvois de section ; ni `tsc` ni tests) : un commit de la règle seule passait
comme de la documentation ; une règle ou une référence commune indexée (`config/rules/`, `config/reference/`)
fait relire les renvois de section de chaque plugin, son titre ayant pu changer sous eux ; une liste de termes retirés indexée (`plugins/<plugin>/termes-retires.txt`) fait
passer son plugin par ces mêmes contrôles statiques, et rien de plus (ni `validate`, ni `tsc`, ni tests)
quand le commit n'a pas d'autre fichier hors documentation ;
puis la forme du CHANGELOG, la version et
la liste « État » de chaque plugin dont le CHANGELOG ou le `plugin.json` est indexé, même
pour un commit de documentation seule ; puis rien de
plus pour un commit de documentation seule ; sinon, sur une copie de l'index (`git checkout-index`, le
contenu qui part, pas l'arbre de travail), `validate` du dépôt, puis `validate`, `tsc` (pour un plugin qui a un `tsconfig.json`) et tests
(terminal seulement) des plugins touchés : 39 erreurs de types étaient passées inaperçues sur trois
groupes quand le hook ne lançait que `validate` et les tests. Le test avec l'app desktop reste à
`check.sh <plugin>`, avant le push. Un plugin dont tous les contrôles viennent de passer garde
l'empreinte de son dossier (arbre de travail, fichiers ignorés exclus) ; le hook saute ses contrôles
quand l'index à commiter porte exactement cette empreinte (un commit juste après `check.sh`). Le hook
pre-merge-commit lance le même `--staged` à la fusion d'une branche qui crée son commit.

Une commande en échec affiche ses lignes d'échec (tests, erreurs de types) avec un peu de contexte,
puis sa fin ; sa sortie entière est écrite dans un fichier temporaire dont le chemin s'affiche.

Sans dépendance hors de la bibliothèque standard ; Python 3.9 ou plus récent.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

# Le marqueur « 0.xx.0 » d'une version pas encore connue dans un README, et les lignes dont
# `scripts/bump-version.py` le remplace : une seule règle pour les deux scripts.
from placeholders import PLACEHOLDER, git_show, replaced_lines

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

REPO = Path(__file__).resolve().parent.parent
PLUGINS = REPO / "plugins"
TYPESCRIPT = "typescript@5.9.3"
# Les modules du dépôt hors de la marketplace, contrôlés par leur nom comme un plugin (`tsc` et tests).
TOOLS = {"sonde": REPO / "scripts" / "sonde"}
# Dossiers de l'app desktop qui gardent ses Claude Code embarqués, un sous-dossier par version.
DESKTOP_DIRS = {
    "darwin": Path.home() / "Library" / "Application Support" / "Claude" / "claude-code",
    "win32": Path(os.environ.get("APPDATA", "")) / "Claude" / "claude-code",
}
# Renvois au suivi d'un parcours (tickets numérotés, questions de revue, dossiers de travail) : ils
# pointent vers `travail/`, qui ne part pas dans la version publique. Nommer la décision à la place.
TICKET_REFS = re.compile(r"\btickets?\s+(?:n°\s*)?\d{2}\b|\bQ\d+ de la revue\b|\btravail/(?!tasks/)[\w-]+/", re.I)
# Renvois aux décisions d'un parcours (« Q3 », « S15 », « série 19 ») : leur fichier de décisions est
# dans `travail/` aussi. Ceux relevés le 29/10/2026 restent admis, fichier par fichier, à leur nombre
# de ce jour (`scripts/renvois-admis.json`), jusqu'à ce qu'on les nettoie : un renvoi de plus échoue.
DECISION_REFS = re.compile(r"(?<![\w-])(?:Q\d+(?:\.\d+)?|S\d{1,3})(?![\w-])|\b[Ss]éries?\s+\d+\b")
ADMITTED_REFS = Path(__file__).resolve().parent / "renvois-admis.json"
CODE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh"}
# Les valeurs relues du parcours (titre, id, raison) insérées brutes dans un texte des hooks de
# flow-board, hors des fonctions de neutralisation : celles du 01/11/2026 restent admises, fichier par
# fichier, à leur nombre de ce jour (`scripts/interpolations-admises.json`), à nettoyer, jamais à augmenter.
INTERPOLATION_PLUGINS = {"flow-board"}
INTERPOLATION = re.compile(r"\$\{\s*([^{}]*?)\s*\}")
# Un chemin de membres (`a.b`, `a?.b`, `a!.b`, `a!`), les paires de membres qui lisent une valeur
# relue, l'appel d'une fonction de neutralisation juste avant un argument, et une condition après.
RUN_CHAIN = re.compile(r"(?<![\w$.])[A-Za-z_$][\w$]*(?:(?:\?\.|!\.|\.)[A-Za-z_$][\w$]*)*!?")
RUN_VALUES = {("run", "title"), ("run", "id"), ("g", "id")}
NEUTRAL_CALL = re.compile(r"(?<![\w$.])(?:shown\w*|neutral\w*|asciiJson)\(\s*$")
CONDITION_AFTER = re.compile(r"\s*(?:\?(?![.?])|===|!==|==|!=)")
ADMITTED_INTERPOLATIONS = Path(__file__).resolve().parent / "interpolations-admises.json"
# Une valeur exportée par un module de `hooks/` (pas un type) : son nom, en tête de ligne.
EXPORTED_VALUE = re.compile(r"^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?"
                            r"(?:function\s*\*?|const\s+enum|const|let|var|abstract\s+class|class|enum)\s+([A-Za-z_$][\w$]*)")
EXPORT_READERS = {".ts", ".tsx", ".js", ".mjs", ".cjs"}
# L'entrée du mod, que le moteur charge sans qu'aucun fichier l'importe.
MOD_ENTRY = ("hooks/register.tsx", "register")
ADMITTED_EXPORTS = Path(__file__).resolve().parent / "exports-admis.json"
# Contrôles 1 et 2 pas encore tenus par un plugin : signalés sans échec, jusqu'à leur reprise.
PENDING = {}
# Les défauts signalés sans couper les contrôles (fichiers absents de l'arbre « Architecture ») :
# ils font échouer la commande à la fin, ou s'affichent avec l'échec d'un autre contrôle.
DEFERRED = []
# Les lignes qui disent un échec dans la sortie d'une commande : `(fail)` de `claude plugin test`,
# `not ok` et `✖` de `node --test`, `error TS` de `tsc`. Une sortie coupée à sa fin les cachait :
# « 466 pass / 2 fail » sans aucun nom de test.
FAIL_LINE = re.compile(r"\(fail\)|^\s*not ok\b|✖|\berror TS\d+")
FAIL_CONTEXT = 2
# Après un `(fail)`, l'attendu et le reçu du test : le `Received:` cherché dans ces lignes, et son
# reçu (un objet sur plusieurs lignes) montré jusqu'à ce nombre de lignes.
RECEIVED_WITHIN = 30
RECEIVED_MAX = 40
RECEIVED_FIRST = 5
# Les lignes de journal d'un mod, retirées de l'extrait.
LOG_LINE = re.compile(r"^\s*\[flow-board\]")
FAIL_MAX = 40
TAIL = 60
# La liste des termes retirés d'un plugin, à sa racine.
RETIRED_FILE = "termes-retires.txt"
# Les termes retirés gardés exprès, fichier par fichier, à leur nombre : des valeurs enregistrées que
# relisent des copies plus anciennes d'un mod, une décision, des identifiants du code (jamais renommés).
# Comme les autres listes d'admis, jamais à augmenter (le pre-commit le refuse).
ADMITTED_RETIRED = Path(__file__).resolve().parent / "termes-retires-admis.json"
# Les dossiers des consignes d'un plugin (le texte que Claude lit), où un terme retiré ne revient pas.
INSTRUCTION_DIRS = ("hooks", "skills", "commands", "reference")
# Un renvoi à une section d'un fichier (« section « X » de `<fichier>.md` », ou par un lien markdown
# dont le texte est ce chemin) : le titre X doit exister dans les règles communes et les références
# (`config/rules/`, `config/reference/`) ; un titre renommé laissait des renvois vers rien.
SECTION_REF = re.compile(r"section « ([^«»]+) » de \[?`([^`\s]+\.md)`")
# Le chemin installé d'une règle ou d'une référence commune (`~/.claude/plugins/marketplaces/<nom>/config/…`) :
# il vise le même fichier que `config/…` du dépôt.
INSTALLED_CONFIG = re.compile(r".*/(config/(?:rules|reference)/[^/]+\.md)")
SECTION_HOMES = ("config/rules", "config/reference")
# La liste privée des termes que la version publique refuse (absente de celle-ci, comme le script
# d'export : le contrôle ne garde alors que les adresses et les dossiers personnels, ou se saute).
EXPORT_DENYLIST = REPO / "config" / "personal" / "public-denylist.txt"
MINMAX_CALL = re.compile(r"\bMath\.(min|max)\(")
# Les caractères invisibles et séparateurs qu'une source de plugin n'écrit jamais bruts, seulement
# échappés : un U+2028 brut, écrit par l'outil Write à la place de son échappement, avait coupé une
# ligne de JavaScript, et un invisible brut dans une classe d'expression régulière ne casse aucun test.
# Donnés par leur point de code : un échappement écrit ici deviendrait lui-même le caractère brut.
INVISIBLE_CODES = (0x85, 0x2028, 0x2029, *range(0x200B, 0x2010), *range(0x202A, 0x202F), *range(0x2060, 0x206A), 0xFEFF)
INVISIBLE = re.compile("[" + "".join(map(chr, INVISIBLE_CODES)) + "]")
INVISIBLE_SUFFIXES = {".ts", ".tsx", ".mjs"}
# Le titre d'une entrée de CHANGELOG. `-mathis.<n>` (mattpocock-skills) est un écart local sur la
# version de l'amont, rangé après elle (README de ce plugin), au contraire d'une pré-version SemVer.
CHANGELOG_ENTRY = re.compile(r"^## (\d+)\.(\d+)\.(\d+)(?:-mathis\.(\d+))?(?=\s|$)")
VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)(?:-mathis\.(\d+))?")
# Les références face auxquelles une version posée doit avancer : une autre discussion avait publié
# sur `main` la même 0.66.0 qu'un groupe, vue seulement au conflit de la fusion.
VERSION_REFS = ("main", "origin/main")
# Les plugins d'une liste « `nom` X.Y.Z » de la section « État » d'ETAT_DU_PROJET.md (fichier personnel,
# absent de la version publique : lu seulement).
STATE_FILE = "ETAT_DU_PROJET.md"
STATE_ENTRY = re.compile(r"`([\w-]+)` (\d+\.\d+\.\d+(?:-mathis\.\d+)?)(?![\w.-])")
# Les appels de l'API du moteur dans les hooks d'un mod, et le début d'un bloc zstd (les types que le
# Claude Code de l'app embarque y sont compressés).
API_CALL = re.compile(r"\$\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)")
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
ENGINE_INTERFACE = "export interface CoreEngineInterface {"
# Les fichiers de décisions d'un chantier, et leurs titres de série : deux discussions avaient pris les
# mêmes numéros (« ## Série 19 » à 21) dans un même fichier.
DECISIONS_FILE = re.compile(r"travail/[^/]+/DECISIONS\.md")
SERIES_TITLE = re.compile(r"^## Série (\d+)\b", re.M)
# Les tickets d'un chantier, et ce qui dit qu'un ticket est sensible (« Zone sensible : oui », en gras
# ou non) et qu'il cite sa recherche (une ligne « Recherche … », en gras ou non, avec une commande et
# son résultat : sur la ligne, `<commande>` suivi d'un texte ; ou dans le bloc de code qui la suit,
# au moins deux lignes) : deux tickets sensibles sans recherche citée avaient fait refaire la
# recherche à la session qui les codait.
TICKET_FILE = re.compile(r"travail/[^/]+/issues/[^/]+\.md")
SENSITIVE_LINE = re.compile(r"^\*{0,2}Zone sensible\s*:\s*\*{0,2}\s*oui\b", re.M | re.I)
SEARCH_LINE = re.compile(r"^\*{0,2}Recherche\b")
# Sur la ligne : une commande (un bout entre accents graves qui porte une espace : un nom et ses
# arguments, pas un hash seul) suivie d'un texte, son résultat, accents graves permis.
INLINE_SEARCH = re.compile(r"`[^`\n]*\S [^`\n]*\S[^`\n]*`\s*\S")
# Une case de liste d'un ticket (`- [x]`, `- [ ]`, et leurs formes mal écrites `- [x ]`, `- []`, `* [X]`…),
# et les deux seules formes bien écrites, suivies d'une espace.
CHECKBOX = re.compile(r"^\s*[-*+]\s*\[[\sxX]*\]")
CHECKBOX_OK = re.compile(r"^\s*- \[[ x]\] ")
# La règle d'un plugin et les listes d'admis : un commit qui ne touchait qu'elles passait le hook comme
# de la documentation, sans les contrôles de `check.sh <plugin>` qui les lisent.
RULE_FILE = re.compile(r"config/rules/([\w-]+)\.md")
ADMITTED_FILE = re.compile(r"scripts/[\w-]+-admi(?:s|ses)\.json")
# La liste des termes retirés d'un plugin : seuls les contrôles statiques qui la lisent la concernent ; un
# commit qui ne changeait qu'elle relançait `validate`, `tsc` et les tests du plugin.
RETIRED_LIST_FILE = re.compile(r"plugins/([\w-]+)/" + re.escape(RETIRED_FILE))


class Failed(Exception):
    pass


class DeferredFailed(Failed):
    """L'échec de fin des défauts signalés sans couper les contrôles."""


def log(msg=""):
    print(msg, flush=True)


def run(args, timeout, cwd=REPO, env=None):
    """Lance une commande, rend (code, sortie) ; une commande qui ne finit pas compte comme un échec."""
    try:
        res = subprocess.run([str(a) for a in args], cwd=str(cwd), capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=timeout,
                             env={**os.environ, **env} if env else None)
    except subprocess.TimeoutExpired:
        return 124, f"pas fini en {timeout} s"
    except OSError as err:
        return 127, str(err)
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def failure_end(lines, i):
    """La dernière ligne à montrer après la ligne d'échec `i` : pour un `(fail)` de `claude plugin test`
    suivi de son `Received:` (dans les `RECEIVED_WITHIN` lignes, avant le test suivant), la fin du reçu
    (ses lignes indentées qui suivent, jusqu'à une ligne vide ou une ligne de test en colonne 0 comme
    `(pass)`, `RECEIVED_MAX` lignes au plus) ; sinon `FAIL_CONTEXT` lignes plus loin.
    La session ouvrait le journal entier pour lire l'attendu et le reçu d'un test."""
    end = min(len(lines) - 1, i + FAIL_CONTEXT)
    if "(fail)" not in lines[i]:
        return end
    for j in range(i + 1, min(len(lines), i + 1 + RECEIVED_WITHIN)):
        if FAIL_LINE.search(lines[j]) or lines[j].startswith("(pass)"):
            break
        if lines[j].lstrip().startswith("Received:"):
            k = j
            while k + 1 < len(lines) and k + 1 - j < RECEIVED_MAX and lines[k + 1].strip() and lines[k + 1][:1].isspace():
                k += 1
            return max(end, k)
    return end


def failure_excerpt(out):
    """Les lignes d'échec d'une sortie, chacune avec quelques lignes autour (l'attendu et le reçu d'un
    test en échec), puis sa fin ; sans les lignes de journal du mod (`[flow-board]`), que 21 commandes
    d'une session filtraient à la main (la sortie entière les garde)."""
    lines = [line for line in out.rstrip().splitlines() if not LOG_LINE.match(line)]
    hits = [i for i, line in enumerate(lines) if FAIL_LINE.search(line)][:FAIL_MAX]
    tail_from = max(0, len(lines) - TAIL)
    # Les lignes d'échec que la fin de la sortie montre déjà ne se répètent pas.
    # L'attendu et le reçu des `RECEIVED_FIRST` premiers échecs seulement : 40 reçus sur plusieurs
    # lignes feraient des milliers de lignes, que la sortie entière garde.
    shown = sorted({j for n, i in enumerate(hits)
                    for j in range(max(0, i - FAIL_CONTEXT), (failure_end(lines, i) if n < RECEIVED_FIRST else min(len(lines) - 1, i + FAIL_CONTEXT)) + 1)
                    if j < tail_from})
    excerpt = []
    if shown:
        excerpt.append(f"  lignes d'échec ({len(hits)}{' au moins' if len(hits) == FAIL_MAX else ''}), avant la fin de la sortie :")
        for n, j in enumerate(shown):
            if n > 0 and j > shown[n - 1] + 1:
                excerpt.append("  …")
            excerpt.append(lines[j])
        excerpt.append(f"  fin de la sortie ({len(lines) - tail_from} dernières lignes) :")
    excerpt.extend(lines[tail_from:])
    return "\n".join(excerpt)


def keep_log(title, out):
    """Écrit la sortie entière dans un fichier temporaire et rend son chemin (None si l'écriture échoue)."""
    slug = re.sub(r"[^\w.-]+", "-", title)[:40].strip("-") or "commande"
    try:
        fd, path = tempfile.mkstemp(prefix=f"check-{slug}-", suffix=".log")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(out)
        return path
    except OSError:
        return None


def step(title, args, timeout, summary=None):
    log(f"→ {title}")
    code, out = run(args, timeout)
    if code != 0:
        log(failure_excerpt(out))
        path = keep_log(title, out)
        if path:
            log(f"  sortie entière : {path}")
        raise Failed(f"{title} : échec (code {code})")
    found = re.findall(summary, out) if summary else []
    log(f"  ok{' (' + found[-1] + ')' if found else ''}")


def tool(name):
    path = shutil.which(name)
    if not path:
        raise Failed(f"{name} introuvable : voir les prérequis du README")
    return path


def version_of(text):
    m = re.search(r"\d+(?:\.\d+)+", text)
    return tuple(int(n) for n in m.group(0).split(".")) if m else None


def version_key(version):
    """La clé de tri d'une version X.Y.Z, `-mathis.<n>` rangé après X.Y.Z ; None hors de cette forme."""
    m = VERSION.fullmatch(version or "")
    return (int(m[1]), int(m[2]), int(m[3]), 0 if m[4] is None else 1, int(m[4] or 0)) if m else None


def git(args, timeout=30):
    """La sortie d'une commande git, sans blancs autour ; None en échec."""
    code, out = run(["git", *args], timeout)
    return out.strip() if code == 0 else None


def desktop_claude():
    """Le Claude Code embarqué par l'app desktop dans sa version la plus récente, et cette version
    (le nom de son dossier) ; None sans l'app."""
    root = DESKTOP_DIRS.get(sys.platform)
    if not root or not root.is_dir():
        return None
    versions = sorted((v, d) for d in root.iterdir() if d.is_dir() for v in [version_of(d.name)] if v)
    for _, folder in reversed(versions):
        if sys.platform == "win32":
            found = sorted(folder.rglob("claude.exe"))
        else:
            found = sorted(folder.glob("*/claude.app/Contents/MacOS/claude"))
        if found:
            return found[0], folder.name
    return None


# --- contrôles statiques ------------------------------------------------------


def files_of(plugin):
    for path in sorted(plugin.rglob("*")):
        rel = path.relative_to(plugin).as_posix()
        if path.is_file() and not rel.startswith(".claude-plugin/types/") and "node_modules" not in path.parts:
            yield path, rel


def comment_of(line, suffix):
    """La partie commentaire d'une ligne de code ; tout le texte d'un document."""
    if suffix not in CODE_SUFFIXES:
        return line
    m = re.search(r"(?:^|\s)(//|/\*|\*|#)", line) if suffix in {".py", ".sh"} else re.search(r"(?:^|\s)(//|/\*|\*)", line)
    return line[m.start():] if m else ""


def admitted_counts(path):
    """Une liste d'admis fichier par fichier (`{"files": {"<plugin>/<chemin>": nombre}}`) ; vide sans elle."""
    if not path.is_file():
        return {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise Failed(f"{path.name} illisible : {err}")
    return admitted_from(text, path.name)


def admitted_from(text, name):
    """Les comptes d'une liste d'admis, lus dans son texte ; vide sans texte."""
    if text is None:
        return {}
    try:
        data = json.loads(text)
    except ValueError as err:
        raise Failed(f"{name} illisible : {err}")
    files = data.get("files") if isinstance(data, dict) else None
    if not isinstance(files, dict):
        raise Failed(f"{name} : pas d'objet « files »")
    return {k: v for k, v in files.items() if isinstance(v, int)}


def ticket_refs(plugin, admitted_path=None):
    """Les renvois aux tickets et aux décisions d'un plugin au-delà des admis (`renvois-admis.json`,
    ou la liste `admitted_path`, celle de la copie de l'index au hook pre-commit)."""
    problems = []
    admitted = admitted_counts(admitted_path or ADMITTED_REFS)
    for path, rel in files_of(plugin):
        if path.suffix not in CODE_SUFFIXES | {".md"}:
            continue
        found = []
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            text = comment_of(line, path.suffix)
            m = TICKET_REFS.search(text)
            if m:
                problems.append(f"{plugin.name}/{rel}:{n} : « {m.group(0)} »")
            found += [f"{n} « {d.group(0)} »" for d in DECISION_REFS.finditer(text)]
        allowed = admitted.get(f"{plugin.name}/{rel}", 0)
        if len(found) > allowed:
            problems.append(f"{plugin.name}/{rel} : {len(found)} renvois aux décisions d'un parcours (« Q3 », « S15 », « série N »), "
                            f"{allowed} admis ({ADMITTED_REFS.name}) ; nommer la décision à la place : lignes {', '.join(found[:8])}"
                            f"{' …' if len(found) > 8 else ''}")
    return problems


def architecture_tree(text):
    """L'arbre « Architecture » d'un README : (début, fin) de son contenu dans le texte, ou None."""
    section = re.search(r"^## Architecture\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    tree = re.search(r"```[^\n]*\n(.*?)```", section.group(1), re.S) if section else None
    return (section.start(1) + tree.start(1), section.start(1) + tree.end(1)) if tree else None


TREE_ENTRY = re.compile(r"^(?P<lead>(?:│   |    )*)(?P<link>├── |└── )(?P<name>\S+)(?P<rest>.*)$")


def rewrite_folder(lines, folder, names):
    """Les lignes de l'arbre où les enfants de `folder/` sont exactement `names` : les lignes existantes
    gardent leur ordre et leur commentaire, une ligne d'un fichier disparu part, un fichier nouveau
    entre à sa place alphabétique quand la liste est triée, sinon à la fin. None sans ligne `folder/`."""
    at = next((i for i, line in enumerate(lines) if (m := TREE_ENTRY.match(line)) and m["name"] == folder + "/"), None)
    if at is None:
        return None
    head = TREE_ENTRY.match(lines[at])
    inner = head["lead"] + ("│   " if head["link"] == "├── " else "    ")
    end = at + 1
    while end < len(lines) and lines[end].startswith(inner):
        end += 1
    kept = []
    for line in lines[at + 1:end]:
        m = TREE_ENTRY.match(line)
        if m and m["lead"] == inner and m["name"] in names:
            kept.append((m["name"], m["rest"]))
    known = [n for n, _ in kept]
    is_sorted = known == sorted(known)
    for name in names:
        if name in known:
            continue
        place = next((i for i, (n, _) in enumerate(kept) if n > name), len(kept)) if is_sorted else len(kept)
        kept.insert(place, (name, ""))
        known.insert(place, name)
    rows = [f"{inner}{'└── ' if i == len(kept) - 1 else '├── '}{n}{rest}" for i, (n, rest) in enumerate(kept)]
    return lines[:at + 1] + rows + lines[end:]


def fix_architecture(plugin):
    """Réécrit l'arbre « Architecture » du README pour qu'il cite chaque fichier de hooks/ et de tests/."""
    readme = plugin / "README.md"
    text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
    span = architecture_tree(text)
    if not span:
        log(f"  {plugin.name} : pas d'arbre « Architecture » dans le README, rien à réécrire")
        return
    lines = text[span[0]:span[1]].split("\n")
    for folder in ("hooks", "tests"):
        names = sorted(rel[len(folder) + 1:] for _, rel in files_of(plugin) if rel.startswith(folder + "/"))
        if names:
            lines = rewrite_folder(lines, folder, names) or lines
    new = text[:span[0]] + "\n".join(lines) + text[span[1]:]
    if new != text:
        with open(readme, "w", encoding="utf-8", newline="\n") as f:
            f.write(new)
        log(f"  {plugin.name}/README.md : arbre « Architecture » réécrit")
    else:
        log(f"  {plugin.name}/README.md : arbre déjà à jour")


def architecture_gaps(plugin):
    """Les fichiers de hooks/ et de tests/ que l'arbre « Architecture » du README ne cite pas."""
    readme = plugin / "README.md"
    text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
    span = architecture_tree(text)
    if not span:
        return None
    tree = re.match(r"(.*)", text[span[0]:span[1]], re.S)
    missing = []
    for folder in ("hooks", "tests"):
        for path, rel in files_of(plugin):
            if rel.startswith(folder + "/") and not re.search(r"(?<![\w.-])" + re.escape(path.name) + r"(?![\w.-])", tree.group(1)):
                missing.append(f"{plugin.name}/{rel}")
    return missing


def retired_list(plugin):
    """Les termes retirés d'un plugin : [(version qui l'a retiré, terme)], vide sans liste."""
    path = plugin / RETIRED_FILE
    if not path.is_file():
        return []
    terms = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        version, sep, term = line.partition("\t")
        if not sep or not version_of(version) or not term.strip():
            raise Failed(f"{plugin.name}/{RETIRED_FILE}:{n} : « <version><tabulation><terme> » attendu")
        terms.append((version_of(version), term.strip()))
    return terms


def changelog_versions(lines):
    """La version de l'entrée du CHANGELOG à laquelle appartient chaque ligne (None avant la première)."""
    current = None
    for line in lines:
        if line.startswith("## "):
            current = version_of(line) or current
        yield current


def retired_terms(plugin, admitted_path=None):
    """Les termes retirés encore présents dans le README, les consignes, ou une entrée du CHANGELOG
    plus récente que la version qui les a retirés (les entrées d'avant, et la sienne, les racontent)."""
    terms = retired_list(plugin)
    if not terms:
        return []
    problems = []
    admitted = admitted_counts(admitted_path or ADMITTED_RETIRED)
    # La règle du plugin (`config/rules/<plugin>.md`) aussi : un terme retiré du mod y était resté.
    rule = plugin.parent.parent / "config" / "rules" / f"{plugin.name}.md"
    # Un test rangé à côté de ses consignes (`skills/<skill>/<nom>.test.mjs`) reste libre, comme `tests/` :
    # il peut citer un terme retiré pour vérifier qu'il a disparu.
    sources = [(path, f"{plugin.name}/{rel}", rel == "CHANGELOG.md") for path, rel in files_of(plugin)
               if rel in ("README.md", "CHANGELOG.md")
               or (rel.split("/")[0] in INSTRUCTION_DIRS and ".test." not in path.name)
               # Les types du plugin (`types/*.d.ts`) aussi : six anciens mots y étaient restés.
               or (rel.startswith("types/") and rel.endswith(".d.ts"))]
    if rule.is_file():
        sources.append((rule, f"config/rules/{plugin.name}.md", False))
    for path, where, is_changelog in sources:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        versions = list(changelog_versions(lines)) if is_changelog else [None] * len(lines)
        found = [f"{where}:{n} : terme retiré en {'.'.join(map(str, retired_in))} « {term} »"
                 for n, (line, at) in enumerate(zip(lines, versions), 1) for retired_in, term in terms
                 if term in line and not (is_changelog and (at is None or at <= retired_in))]
        # Une valeur enregistrée ou une décision gardée exprès est admise, fichier par fichier, à son
        # compte : au-delà, chaque occurrence du fichier est montrée, l'admise comprise.
        allowed = admitted.get(where, 0)
        if len(found) > allowed:
            problems += [f"{p} ({allowed} admis dans le fichier, {ADMITTED_RETIRED.name})" if allowed else p for p in found]
    return problems


def headings(path):
    """Les titres markdown d'un fichier (`#` à `######`), sans leurs dièses ni leurs espaces de bord."""
    return {m.group(1).strip() for m in re.finditer(r"^#{1,6}\s+(.+)$", path.read_text(encoding="utf-8", errors="replace"), re.M)}


def section_target(root, source, ref):
    """Le fichier que vise un renvoi de section : depuis le dépôt, à côté du fichier qui renvoie, ou parmi
    les règles et les références communes (un nom nu, `agents.md`) ; None hors de `SECTION_HOMES`. Rend
    (chemin depuis le dépôt, chemin, existe)."""
    homes = [root / home for home in SECTION_HOMES]
    installed = INSTALLED_CONFIG.fullmatch(ref)
    if installed:
        ref = installed.group(1)
    candidates = [root / ref, source.parent / ref] + ([home / ref for home in homes] if "/" not in ref else [])
    for path in candidates:
        if path.is_file() and any(path.resolve().is_relative_to(h.resolve()) for h in homes):
            return path.resolve().relative_to(root.resolve()).as_posix(), path, True
    if ref.split("/")[0] == "config" and "/".join(ref.split("/")[:2]) in SECTION_HOMES:
        return ref, None, False
    # Un nom nu écrit depuis une règle ou une référence commune vise un fichier voisin : disparu, il est
    # introuvable, jamais hors du contrôle.
    beside = source.parent / ref
    if "/" not in ref and any(source.resolve().is_relative_to(h.resolve()) for h in homes):
        return beside.resolve().relative_to(root.resolve()).as_posix(), None, False
    return None


def section_refs(plugin):
    """Les renvois de section du plugin (hors tests et CHANGELOG, qui raconte des titres d'hier) et de sa
    règle (`config/rules/<plugin>.md`) vers un titre absent des règles et des références communes."""
    root = plugin.parent.parent
    rule = root / "config" / "rules" / f"{plugin.name}.md"
    sources = [(path, f"{plugin.name}/{rel}") for path, rel in files_of(plugin)
               if not rel.startswith("tests/") and ".test." not in path.name and rel != "CHANGELOG.md"
               and path.suffix in {".md", ".ts", ".tsx", ".js", ".mjs", ".py", ".txt"}]
    if rule.is_file():
        sources.append((rule, f"config/rules/{plugin.name}.md"))
    problems, titles = [], {}
    for path, where in sources:
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for m in SECTION_REF.finditer(line):
                found = section_target(root, path, m.group(2))
                if found is None:
                    continue
                shown, target, exists = found
                if not exists:
                    problems.append(f"{where}:{n} : renvoi à la section « {m.group(1)} » de {shown}, fichier introuvable")
                elif m.group(1).strip() not in titles.setdefault(shown, headings(target)):
                    problems.append(f"{where}:{n} : renvoi à la section « {m.group(1)} » de {shown}, qui n'a pas ce titre")
    return problems


def export_terms(plugin):
    """Ce que l'export public refuserait dans les fichiers du plugin (tests compris) : adresses mail hors
    de la liste permise, dossiers personnels, termes de la liste privée, dans le nom et le contenu de
    chaque fichier (le contenu des binaires excepté, que l'export lit aussi) ; les règles de
    `problems_in` du script d'export. Une adresse de test n'avait été vue qu'à l'export. None sans ce
    script (version publique)."""
    try:
        import export_public
    except ImportError:
        return None
    denylist = []
    if EXPORT_DENYLIST.is_file():
        try:
            denylist = export_public.load_denylist(EXPORT_DENYLIST.read_text(encoding="utf-8"))
        except SystemExit as err:
            raise Failed(str(err))
    # Ce qui partira : les fichiers suivis et les nouveaux non ignorés, pas ceux que git ignore (un
    # réglage local ou un journal de débogage, que l'export ne lit pas). La copie de l'index du hook
    # pre-commit, hors du dépôt, ne porte que des fichiers suivis : tous se lisent.
    inside = plugin.resolve().is_relative_to(REPO.resolve())
    listed = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", plugin.as_posix()], 60) if inside else None
    kept = None if listed is None else {(REPO / p).resolve() for p in listed.splitlines()}
    problems = []
    for path, rel in files_of(plugin):
        if kept is not None and path.resolve() not in kept:
            continue
        found_in = export_public.problems_in(rel, f"{label_of(plugin)}/{rel} (nom)", denylist)
        data = path.read_bytes()
        if b"\0" not in data[:8000]:
            found_in += export_public.problems_in(data.decode("utf-8", "replace"), f"{label_of(plugin)}/{rel}", denylist)
        for where, rule, found in found_in:
            problems.append(f"{where} : {rule} « {found} », refusé par l'export public (scripts/export_public.py)")
    return problems


def check_export_terms(plugin):
    log("→ termes de l'export public (adresses, dossiers personnels, termes interdits)")
    problems = export_terms(plugin)
    if problems is None:
        log("  pas de scripts/export_public.py : contrôle sans objet")
    elif problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{plugin.name} : {len(problems)} terme(s) que l'export public refuserait")
    else:
        log("  ok")


def code_of(line):
    """La partie code d'une ligne JS ou TS : sans commentaire `//`, vide pour une ligne de bloc `/* */`."""
    stripped = line.lstrip()
    if stripped.startswith(("*", "/*", "//")):
        return ""
    m = re.search(r"(?:^|\s)//", line)
    return line[:m.start()] if m else line


def spreads_into_minmax(code):
    """Vrai si un appel `Math.min(` ou `Math.max(` de la ligne étale une liste au premier niveau de ses arguments."""
    for m in MINMAX_CALL.finditer(code):
        depth = 0
        for i in range(m.end(), len(code)):
            c = code[i]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif depth == 0 and code.startswith("...", i):
                return True
    return False


def code_files(plugin):
    """Les fichiers de code du plugin hors tests, que relisent les règles du code."""
    for path, rel in files_of(plugin):
        if path.suffix in {".ts", ".tsx", ".js", ".mjs", ".cjs"} and not rel.startswith("tests/") and ".test." not in path.name:
            yield path, rel


def detached_doc_blocks(lines):
    """Les blocs `/** */` suivis directement d'un autre (des lignes vides au plus entre eux) :
    [(première ligne du bloc, sa dernière, première ligne du bloc suivant)], numérotées depuis 1."""
    found = []
    in_doc = False
    start = prev = None
    for n, line in enumerate(lines, 1):
        s = line.strip()
        if not in_doc and s.startswith("/**"):
            if prev is not None:
                found.append((prev[0], prev[1], n))
            start = n
            # Le bloc se ferme sur la ligne où paraît `*/` ; du code après lui (`/** @x */ export …`)
            # fait de la ligne une ligne de code, jamais un bloc détaché que `--fix` effacerait.
            close = s.find("*/", 2)
            in_doc = close < 0
            prev = None if in_doc or s[close + 2:].strip() else (start, n)
        elif in_doc:
            close = s.find("*/")
            if close >= 0:
                in_doc = False
                prev = None if s[close + 2:].strip() else (start, n)
        elif s:
            prev = None
    return found


def code_rules(plugin):
    """Hors tests : pas de liste étalée dans Math.min/max, pas de bloc /** */ suivi directement d'un autre."""
    problems = []
    for path, rel in code_files(plugin):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        found = [(n, "liste étalée dans Math.min/max (une boucle à la place)")
                 for n, line in enumerate(lines, 1) if spreads_into_minmax(code_of(line))]
        found += [(nxt, f"bloc /** */ suivi directement d'un autre (ligne {end}) : le premier ne documente rien (scripts/check.sh --fix le retire)")
                  for _, end, nxt in detached_doc_blocks(lines)]
        problems += [f"{plugin.name}/{rel}:{n} : {what}" for n, what in sorted(found)]
    return problems


def fix_detached_docs(plugin):
    """Retire chaque bloc `/** */` suivi directement d'un autre, et les lignes vides qui l'en séparent :
    le dernier d'une suite, qui documente le code, reste. Rend ce qui a été retiré, fichier et lignes."""
    said = []
    for path, rel in code_files(plugin):
        text = path.read_text(encoding="utf-8")
        lines = text.split("\n")
        blocks = detached_doc_blocks(lines)
        if not blocks:
            continue
        drop = {i for start, _, nxt in blocks for i in range(start, nxt)}
        kept = [line for n, line in enumerate(lines, 1) if n not in drop]
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(kept))
        said += [f"{plugin.name}/{rel}:{start} : bloc /** */ détaché retiré (lignes {start}-{end}), le bloc de la ligne {nxt} gardé"
                 for start, end, nxt in blocks]
    return said


def invisible_chars(plugin):
    """Les caractères invisibles ou séparateurs bruts des sources `.ts`, `.tsx` et `.mjs` du plugin
    (tests compris), avec le fichier, la ligne et l'échappement à écrire. Les lignes se coupent au
    seul `\\n` : `splitlines` couperait aussi à U+2028, U+2029 et U+0085, et les cacherait."""
    problems = []
    for path, rel in files_of(plugin):
        if path.suffix not in INVISIBLE_SUFFIXES:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").split("\n"), 1):
            for m in INVISIBLE.finditer(line):
                code = ord(m.group(0))
                problems.append(f"{plugin.name}/{rel}:{n} : caractère invisible brut U+{code:04X}, "
                                f"écrire l'échappement \\u{code:04x} à la place")
    return problems


def is_run_value(chain):
    """Vrai si un chemin (`a.b!.c?.d`) lit une valeur relue du parcours : il passe par `run.title`,
    `run.id`, `g.id` ou un membre en `…why` (`change.why`, `kept.withdrawnWhy`), suivi ou non d'un
    membre de plus (`state.why.replace`, la valeur reste brute)."""
    parts = [p for p in re.split(r"[?!]*\.", chain.rstrip("!")) if p]
    return any(p.lower().endswith("why") or (k > 0 and (parts[k - 1], p) in RUN_VALUES) for k, p in enumerate(parts))


def raw_values(expression):
    """Les valeurs relues du parcours qu'une expression d'interpolation insère brutes : chaque chemin
    qui en lit une (`is_run_value`), hors appel d'une fonction (`inFlightWhy(g)` calcule son texte), sauf l'argument direct d'une fonction de neutralisation (`shown*(`,
    `neutral*(`, `asciiJson(`) et une condition (suivi de `?` ou d'une comparaison, ou nié par `!`).
    Une expression composée compte aussi : `.map(g => g.id)`, `String(run.title)`, `x.why ?? '—'`."""
    found = []
    for m in RUN_CHAIN.finditer(expression):
        before, after = expression[:m.start()], expression[m.end():]
        chain = m.group(0)
        if re.match(r"\s*\(", after):
            # Un appel : la fonction (`inFlightWhy(g)`) calcule son texte ; une méthode de la valeur
            # (`state.why.replace(…)`) la garde brute.
            chain = re.sub(r"[?!]*\.[^.?!]+!?$", "", chain) if re.search(r"\.[^.?!]+!?$", chain) else ""
        if not chain or not is_run_value(chain) or NEUTRAL_CALL.search(before) or CONDITION_AFTER.match(after) or re.search(r"!\s*$", before):
            continue
        found.append(m.group(0))
    return found


def raw_interpolations(plugin, admitted_path=None):
    """Les fichiers des hooks de flow-board qui insèrent dans un texte plus de valeurs relues brutes
    (`run.title`, `run.id`, `g.id`, `…why` dans un `${…}`, `raw_values`) que n'en admet
    `interpolations-admises.json` : une valeur s'y insère comme argument direct d'une fonction de
    neutralisation (`shown*`, `neutral*`, `asciiJson`) ; des sites bruts ressortaient à chaque tour de
    revue d'un groupe (9 constats à la passe « bogues »). Une interpolation qui contient un gabarit
    imbriqué n'est lue que par ses `${…}` intérieurs. `admitted_path` : une autre liste (celle de la
    copie de l'index au hook pre-commit)."""
    if plugin.name not in INTERPOLATION_PLUGINS:
        return []
    admitted = admitted_counts(admitted_path or ADMITTED_INTERPOLATIONS)
    problems = []
    for path, rel in files_of(plugin):
        if not rel.startswith("hooks/") or path.suffix not in {".ts", ".tsx"} or ".test." in path.name:
            continue
        found = [f"{n} « {value} »"
                 for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1)
                 for m in INTERPOLATION.finditer(code_of(line)) for value in raw_values(m.group(1))]
        allowed = admitted.get(f"{plugin.name}/{rel}", 0)
        if len(found) > allowed:
            problems.append(f"{plugin.name}/{rel} : {len(found)} valeur(s) relue(s) insérée(s) brute(s) dans un texte, "
                            f"{allowed} admis ({ADMITTED_INTERPOLATIONS.name}) ; la passer par une fonction de "
                            f"neutralisation (shown*, neutral*, asciiJson) : lignes {', '.join(found[:8])}{' …' if len(found) > 8 else ''}")
    return problems


def dead_exports(plugin, admitted_path=None):
    """Les modules de `hooks/` qui exportent plus de valeurs mortes (`export function`, `const`, `let`,
    `class`, `enum` dont le nom ne paraît dans aucun autre fichier de code du plugin, hooks, tests et
    scripts compris, `.claude-plugin/` exclu) que n'en admet `exports-admis.json` ; l'entrée du mod
    (`register` de `hooks/register.tsx`) ne compte pas. 14 fonctions avaient été exportées sans
    qu'aucun fichier les importe pendant un seul lot. `admitted_path` : une autre liste (celle de la
    copie de l'index au hook pre-commit)."""
    readers = {rel: path.read_text(encoding="utf-8", errors="replace") for path, rel in files_of(plugin)
               if path.suffix in EXPORT_READERS and not rel.startswith(".claude-plugin/")}
    names = {rel: set(re.findall(r"[A-Za-z_$][\w$]*", text)) for rel, text in readers.items()}
    admitted = admitted_counts(admitted_path or ADMITTED_EXPORTS)
    problems = []
    for rel, text in readers.items():
        if not rel.startswith("hooks/") or Path(rel).suffix not in {".ts", ".tsx"} or ".test." in rel:
            continue
        found = []
        for n, line in enumerate(text.splitlines(), 1):
            m = EXPORTED_VALUE.match(line)
            if not m or (rel, m.group(1)) == MOD_ENTRY:
                continue
            if not any(m.group(1) in words for other, words in names.items() if other != rel):
                found.append(f"{n} « {m.group(1)} »")
        allowed = admitted.get(f"{plugin.name}/{rel}", 0)
        if len(found) > allowed:
            problems.append(f"{plugin.name}/{rel} : {len(found)} valeur(s) exportée(s) qu'aucun autre fichier du plugin ne nomme, "
                            f"{allowed} admis ({ADMITTED_EXPORTS.name}) ; retirer le mot « export » ou l'importer là où elle sert : "
                            f"lignes {', '.join(found)}")
    return problems


def changelog_shape(plugin):
    """Les défauts de forme du CHANGELOG d'un plugin (fichier, ligne, défaut) ; None sans CHANGELOG."""
    path = plugin / "CHANGELOG.md"
    if not path.is_file():
        return None
    rel = f"plugins/{plugin.name}/CHANGELOG.md"
    try:
        manifest = json.loads((plugin / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        manifest = None
    problems = []
    seen = {}
    previous = None
    is_separated = False
    in_fence = False
    for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if line.startswith("```"):
            in_fence = not in_fence
        if in_fence:
            continue
        if re.fullmatch(r"---\s*", line):
            is_separated = True
            continue
        if not line.startswith("## "):
            continue
        m = CHANGELOG_ENTRY.match(line)
        if not m:
            problems.append(f"{rel}:{n} : titre d'entrée sans version X.Y.Z en tête : « {line.strip()} »")
            is_separated = False
            continue
        version = line[3:m.end()]
        key = version_key(version)
        if not is_separated:
            problems.append(f"{rel}:{n} : pas de ligne « --- » avant l'entrée {version}")
        if previous is None and manifest is not None and version != manifest:
            problems.append(f"{rel}:{n} : première entrée {version}, mais plugin.json dit {manifest}")
        if key in seen:
            problems.append(f"{rel}:{n} : version {version} en double (déjà ligne {seen[key]})")
        elif previous is not None and key > previous[0]:
            problems.append(f"{rel}:{n} : {version} après {previous[1]} : les versions vont de la plus récente à la plus ancienne")
        seen.setdefault(key, n)
        previous = (key, version)
        is_separated = False
    if previous is None:
        problems.append(f"{rel} : aucune entrée « ## <version> — <date> »")
    return problems


def check_changelog(plugin):
    log("→ forme du CHANGELOG")
    problems = changelog_shape(plugin)
    if problems is None:
        log("  pas de CHANGELOG : contrôle sans objet")
    elif problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{plugin.name} : {len(problems)} défaut(s) de forme du CHANGELOG")
    else:
        log("  ok")


def static_checks(plugin):
    """Les contrôles statiques ; rend les fichiers absents de l'arbre « Architecture », qui ne coupent
    pas les contrôles suivants (un fichier de test nouveau arrêtait toute la suite) mais échouent à la
    fin (`fail_deferred`)."""
    pending = PENDING.get(plugin.name)
    log("→ renvois aux tickets et aux dossiers de travail")
    refs = ticket_refs(plugin)
    if refs and pending:
        log(f"  {len(refs)} à reprendre, signalés sans échec ({pending}) :")
        for p in refs:
            log(f"    {p}")
    elif refs:
        log("\n".join(f"  {p}" for p in refs))
        raise Failed(f"{plugin.name} : {len(refs)} renvoi(s) aux tickets ou aux dossiers de travail")
    else:
        log("  ok")
    log("→ arbre « Architecture » du README")
    gaps = architecture_gaps(plugin)
    deferred = [f"{g} : absent de l'arbre « Architecture » du README (scripts/check.sh --fix {plugin.name} l'écrit)" for g in gaps or []]
    if gaps is None:
        log("  pas d'arbre « Architecture » : contrôle sans objet")
    elif deferred and pending:
        log(f"  {len(deferred)} à reprendre, signalés sans échec ({pending}) :")
        for p in deferred:
            log(f"    {p}")
        deferred = []
    elif deferred:
        log("\n".join(f"  {p}" for p in deferred))
        log("  signalé, en échec à la fin : les autres contrôles continuent")
    else:
        log("  ok")
    log("→ termes retirés")
    retired = retired_terms(plugin)
    log("→ renvois de section vers les règles et les références communes")
    sections = section_refs(plugin)
    log("→ règles du code (Math.min/max étalé, doc détachée, caractères invisibles bruts, valeurs relues brutes, exports morts)")
    rules = retired + sections + code_rules(plugin) + invisible_chars(plugin) + raw_interpolations(plugin) + dead_exports(plugin)
    if rules:
        log("\n".join(f"  {p}" for p in rules))
        raise Failed(f"{plugin.name} : {len(rules)} terme(s) retiré(s) ou entorse(s) aux règles du code")
    log("  ok")
    check_export_terms(plugin)
    check_changelog(plugin)
    check_versions(plugin)
    return deferred


def fail_deferred(deferred):
    """L'échec, en fin de contrôles, des défauts signalés sans couper la suite."""
    if deferred:
        log("\nSignalés plus haut, sans arrêter les contrôles :")
        log("\n".join(f"  {p}" for p in deferred))
        raise DeferredFailed(f"{len(deferred)} fichier(s) absent(s) de l'arbre « Architecture »")


# --- versions -----------------------------------------------------------------


def manifest_rel(plugin):
    return f"plugins/{plugin.name}/.claude-plugin/plugin.json"


def manifest_version(plugin, rev=None):
    """La version de `plugin.json` : dans l'arbre de travail (`rev` None), dans l'index (`rev` vide)
    ou à une révision ; None si le fichier y manque ou ne se lit pas."""
    try:
        if rev is None:
            text = (plugin / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        else:
            text = git(["show", f"{rev}:{manifest_rel(plugin)}"])
            if text is None:
                return None
        version = json.loads(text).get("version")
    except (OSError, ValueError):
        return None
    return version if isinstance(version, str) else None


def version_advance(plugin, rev=None):
    """Une version posée par la branche (différente de celle du point où elle part de la référence)
    doit être strictement plus grande que celle de `main` et de `origin/main` : sinon une autre
    discussion a publié ce numéro, ou un plus grand, entre-temps. Une branche qui n'a pas touché
    à la version ne demande rien, même en retard sur la référence ; pendant une fusion, une version
    qui est celle de la branche fusionnée (`MERGE_HEAD`) vient d'elle, pas de cette branche."""
    current = manifest_version(plugin, rev)
    if current is None:
        return []
    if git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]) is not None and manifest_version(plugin, "MERGE_HEAD") == current:
        return []
    problems = []
    for ref in VERSION_REFS:
        if git(["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"]) is None:
            continue
        base = git(["merge-base", "HEAD", ref])
        before = manifest_version(plugin, base) if base else None
        there = manifest_version(plugin, ref)
        if before is None or there is None or before == current:
            continue
        if version_key(current) is None or version_key(there) is None or version_key(current) <= version_key(there):
            problems.append(f"{manifest_rel(plugin)} : version {current}, qui n'avance pas sur {ref} ({there}) : "
                            "une autre discussion l'a publiée entre-temps ; prendre la suivante (/project:version)")
    return problems


def leftover_placeholders(plugin, rev=None):
    """Les marqueurs « 0.xx.0 » du README restés après la dernière montée de version : une ligne écrite
    avant elle (git blame), ou toute ligne quand la version change dans l'arbre ou l'index (`rev`).
    Un marqueur écrit après la dernière montée attend la prochaine : il passe. Avec `rev` vide (le hook),
    le README lu est celui de l'index, numéros de ligne compris : le marqueur non commité d'une autre
    discussion, que `scripts/bump-version.py` laisse, ne bloque le commit de version que s'il est indexé,
    ce que fait un commit par chemin (`git commit -- <chemin>` reprend le fichier entier du disque) ;
    le message dit alors de retirer cette ligne de l'index, jamais d'y écrire la version."""
    rel = f"plugins/{plugin.name}/README.md"
    if rev == "":
        text = git_show(REPO, f":{rel}")
        if text is None:
            return []
    else:
        readme = plugin / "README.md"
        if not readme.is_file():
            return []
        text = readme.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    marked = [n for n, line in enumerate(lines, 1) if PLACEHOLDER in line]
    if not marked:
        return []
    current = manifest_version(plugin, rev)
    # Les marqueurs que `bump-version.py` remplace : la même règle que lui, celle de `placeholders.py`.
    replaced = replaced_lines(git_show(REPO, f"HEAD:{rel}"), lines)

    def fix(n):
        if n in replaced:
            return f"scripts/bump-version.py {plugin.name} {current} le remplace"
        return ("ligne pas encore commitée, sans doute d'une autre discussion : la retirer de l'index (n'indexer que ses "
                "propres morceaux, piège « Plusieurs discussions commitent… » de CLAUDE.md), sans y écrire la version")

    if current != manifest_version(plugin, "HEAD"):
        return [f"{rel}:{n} : marqueur « {PLACEHOLDER} » alors que la version passe à {current} : {fix(n)}" for n in marked]
    last = git(["log", "-1", "--format=%H", "-G", '"version"[[:space:]]*:', "--", manifest_rel(plugin)], 60)
    if not last:
        return []
    contents = []
    if rev == "":
        # Le blame porte sur les lignes de l'index : leur texte, passé par un fichier temporaire.
        handle, copy = tempfile.mkstemp(prefix="check-readme-", suffix=".md")
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        contents = ["--contents", copy]
    try:
        problems = []
        for n in marked:
            blame = git(["blame", "--porcelain", "-L", f"{n},{n}", *contents, "--", rel], 60)
            sha = blame.split(" ", 1)[0] if blame else ""
            if sha and set(sha) != {"0"} and git(["merge-base", "--is-ancestor", sha, last]) is not None:
                problems.append(f"{rel}:{n} : marqueur « {PLACEHOLDER} » resté après la montée en {current} : {fix(n)}")
        return problems
    finally:
        if contents:
            os.unlink(contents[1])


def check_versions(plugin, rev=None):
    log("→ version face à main et origin/main, marqueurs « 0.xx.0 »")
    problems = version_advance(plugin, rev) + leftover_placeholders(plugin, rev)
    if problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{plugin.name} : {len(problems)} défaut(s) de version")
    log("  ok")


def state_mismatches(names, root=REPO):
    """Les versions de la liste « État » d'ETAT_DU_PROJET.md qui diffèrent de celle de `plugin.json`,
    pour les plugins nommés, dans le dépôt ou dans une copie de son index (`root`) ; rien sans ce
    fichier (version publique)."""
    path = root / STATE_FILE
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    section = re.search(r"^## État\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    problems = []
    for m in STATE_ENTRY.finditer(section.group(1) if section else ""):
        name, cited = m.group(1), m.group(2)
        if name not in names:
            continue
        actual = manifest_version(root / "plugins" / name)
        if actual is not None and actual != cited:
            problems.append(f"{STATE_FILE}, section « État » : `{name}` {cited}, mais plugin.json dit {actual}")
    return problems


def check_state(names, root=REPO):
    log(f"→ versions de la liste « État » de {STATE_FILE}")
    problems = state_mismatches(names, root)
    if problems is None:
        log(f"  pas de {STATE_FILE} : contrôle sans objet")
    elif problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{len(problems)} version(s) de la liste « État » à mettre à jour")
    else:
        log("  ok")


# --- API du moteur dans le Claude Code de l'app -------------------------------


def engine_declarations(binary):
    """Les types de l'API des mods que le Claude Code de l'app embarque (compressés en zstd dans son
    binaire), gardés en cache par binaire ; (texte, None), ou (None, raison) s'ils ne se lisent pas."""
    try:
        stat = binary.stat()
    except OSError as err:
        return None, str(err)
    tag = hashlib.sha256(f"{binary}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")).hexdigest()[:16]
    cache = Path(tempfile.gettempdir()) / f"check-engine-{tag}.d.ts"
    if cache.is_file():
        return cache.read_text(encoding="utf-8"), None
    zstd = shutil.which("zstd")
    if not zstd:
        return None, "zstd introuvable (il décompresse les types embarqués)"
    data = binary.read_bytes()
    marker = ENGINE_INTERFACE.encode("utf-8")
    at = data.find(ZSTD_MAGIC)
    while at >= 0:
        try:
            res = subprocess.run([zstd, "-dc", "-q"], input=data[at:at + 8_000_000], capture_output=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            res = None
        if res is not None and marker in res.stdout:
            text = res.stdout.decode("utf-8", errors="replace")
            try:
                cache.write_text(text, encoding="utf-8")
            except OSError:
                pass
            return text, None
        at = data.find(ZSTD_MAGIC, at + 1)
    return None, "types de l'API absents du binaire"


def engine_api(text):
    """{espace: membres} de l'interface du moteur (`$.<espace>.<membre>`), lus à l'indentation des
    types que le moteur écrit : un espace à 6 espaces, ses membres à 10."""
    api = {}
    space = None
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.strip() == ENGINE_INTERFACE), None)
    for line in lines[start + 1:] if start is not None else []:
        if line.startswith("  }"):
            break
        top = re.match(r"^      (?:readonly )?(\w+)\??:\s*(\{)?", line)
        if top:
            space = top.group(1)
            api.setdefault(space, set())
            continue
        member = re.match(r"^          (?:readonly )?(\w+)\??\s*[:(<]", line)
        if member and space is not None:
            api[space].add(member.group(1))
    return api


def engine_calls(plugin):
    """Les appels `$.<espace>.<membre>` du code des hooks : [(fichier:ligne, espace, membre)]."""
    calls = []
    for path, rel in files_of(plugin):
        if not rel.startswith("hooks/") or path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".cjs"}:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for m in API_CALL.finditer(code_of(line)):
                calls.append((f"{label_of(plugin)}/{rel}:{n}", m.group(1), m.group(2)))
    return calls


def check_engine_api(plugin, desktop):
    """Chaque appel de l'API du moteur existe dans le Claude Code de l'app : une API qu'il ne connaît
    pas encore efface le mod dans l'app, alors que le faux moteur des tests ne la voit pas."""
    calls = engine_calls(plugin)
    if not calls:
        return
    log("→ API du moteur dans le Claude Code de l'app")
    if desktop is None:
        log("  avertissement : contrôle sauté, sans le Claude Code de l'app")
        return
    binary, version = desktop
    text, reason = engine_declarations(Path(binary))
    if text is None:
        log(f"  avertissement : contrôle sauté, {reason}")
        return
    api = engine_api(text)
    missing = [f"{where} : $.{space}.{member} inconnu du Claude Code de l'app {version}"
               for where, space, member in calls if member not in api.get(space, ())]
    if missing:
        log("\n".join(f"  {p}" for p in missing))
        raise Failed(f"{plugin.name} : {len(missing)} appel(s) d'une API que l'app ne connaît pas encore")
    log(f"  ok ({len({(s, m) for _, s, m in calls})} appels, app {version})")


# --- types --------------------------------------------------------------------


def main_clone():
    """Le clone principal du dépôt : celui dont un worktree partage le dossier .git."""
    code, out = run(["git", "rev-parse", "--git-common-dir"], 30)
    return (REPO / out.strip()).resolve().parent if code == 0 and out.strip() else REPO


def types_written_by(types):
    head = (types / "claude-code" / "index.d.ts")
    if not head.is_file():
        return None
    with open(head, encoding="utf-8", errors="replace") as f:
        m = re.search(r"Written by Claude Code (\S+?)\.?$", f.readline().strip())
    return m.group(1) if m else None


def ensure_types(plugin):
    """Les types du moteur du plugin ; copiés au besoin depuis le clone principal (le même plugin,
    sinon le plus récent d'un autre : ce sont les types du moteur, pas ceux du plugin)."""
    types = plugin / ".claude-plugin" / "types"
    if (types / "tsconfig.json").is_file():
        return types_written_by(types)
    clone = main_clone()
    # Le même dossier dans le clone principal : `plugins/<nom>`, ou `scripts/sonde` pour la sonde.
    same = clone / shown_dir(plugin) / ".claude-plugin" / "types"
    candidates = [same] if (same / "tsconfig.json").is_file() and same != types else []
    if not candidates:
        others = [d for root in {clone, REPO} for d in (root / "plugins").glob("*/.claude-plugin/types")
                  if (d / "tsconfig.json").is_file() and d != types]
        others.sort(key=lambda d: version_of(types_written_by(d) or "") or (), reverse=True)
        candidates = others[:1]
    if not candidates:
        raise Failed(f"types du moteur absents de {plugin.name} et du clone principal : lancer une fois "
                     f"`claude --plugin-dir {shown_dir(plugin)}` en session interactive, puis quitter")
    shutil.copytree(candidates[0], types)
    log(f"  types du moteur copiés depuis {candidates[0]}")
    return types_written_by(types)


def typecheck(plugin):
    if not (plugin / "tsconfig.json").is_file():
        return
    log(f"→ types ({TYPESCRIPT} par npx)")
    written = ensure_types(plugin)
    log(f"  types écrits par Claude Code {written or '(version inconnue)'}")
    step(f"tsc -p {shown_dir(plugin)}", [tool("npx"), "--yes", "-p", TYPESCRIPT, "tsc", "-p", plugin], 600)


# --- tests et validation ------------------------------------------------------


def node_tests(plugin):
    tests = sorted(t for folder in ("skills", "tests") if (plugin / folder).is_dir() for t in (plugin / folder).rglob("*.test.mjs"))
    if tests:
        step("node --test " + " ".join(t.relative_to(REPO).as_posix() for t in tests),
             [tool("node"), "--test", *tests], 600, r"pass \d+")


def plugin_tests(plugin, claude, label):
    if (plugin / "tests").is_dir():
        step(f"claude plugin test {shown_dir(plugin)} ({label})", [claude, "plugin", "test", plugin], 900, r"\d+ pass")


def test_file(plugin, name):
    """Le fichier de test que nomme `name` : un chemin depuis le dépôt ou le plugin, ou un nom nu
    cherché dans `tests/` et `skills/` du plugin."""
    for candidate in (REPO / name, plugin / name):
        if candidate.is_file() and ".test." in candidate.name:
            return candidate.resolve()
    found = sorted(t for folder in ("tests", "skills") if (plugin / folder).is_dir()
                   for t in (plugin / folder).rglob(Path(name).name) if t.is_file() and ".test." in t.name)
    if len(found) != 1:
        where = ", ".join(t.relative_to(REPO).as_posix() for t in found) or "aucun"
        raise Failed(f"fichier de test « {name} » dans {shown_dir(plugin)} : {len(found)} trouvé(s) ({where})")
    return found[0]


def single_test(plugin, names):
    """Les fichiers de test nommés, avec le Claude Code du terminal : les `.test.mjs` par `node --test`
    en place ; les `.test.ts`/`.test.tsx` par `claude plugin test` sur une copie temporaire du plugin
    qui n'a que ces fichiers de test (les aides de `tests/` sans `.test.` restent), faute de filtre."""
    paths = [test_file(plugin, name) for name in names]
    node = [p for p in paths if p.name.endswith(".test.mjs")]
    if node:
        step("node --test " + " ".join(p.relative_to(REPO).as_posix() for p in node), [tool("node"), "--test", *node], 600, r"pass \d+")
    engine = [p for p in paths if not p.name.endswith(".test.mjs")]
    if not engine:
        return
    rel = " ".join(p.relative_to(REPO).as_posix() for p in engine)
    claude = tool("claude")
    targets = {p.relative_to(plugin) for p in engine}
    tmp = Path(tempfile.mkdtemp(prefix="check-test-"))
    try:
        copy = tmp / plugin.name
        # Les types du moteur (`.claude-plugin/types/`) ne servent qu'à `tsc` ; le `types/` du plugin reste.
        engine_types = (plugin / ".claude-plugin").resolve()
        shutil.copytree(plugin, copy, ignore=lambda folder, names: [
            n for n in names if n == "node_modules" or (n == "types" and Path(folder).resolve() == engine_types)])
        for other in copy.rglob("*.test.*"):
            if other.relative_to(copy) not in targets:
                other.unlink()
        code, out = run([claude, "--version"], 60)
        version = out.strip().split(" ")[0] if code == 0 else "?"
        step(f"claude plugin test {rel} (terminal {version})", [claude, "plugin", "test", copy], 900, r"\d+ pass")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def split_tests(tests, plugins, known):
    """Les fichiers de `--test` et les plugins : `--test <fichier>… <plugin>` met le plugin au bout de
    la liste des fichiers ; il en sort quand aucun plugin n'est nommé à part et qu'il en nomme un."""
    tests, plugins = list(tests), list(plugins)
    if not plugins and len(tests) > 1 and tests[-1] in known:
        plugins.append(tests.pop())
    return tests, plugins


def touched_tests(plugin):
    """Les fichiers de test du plugin modifiés face à `HEAD` (arbre de travail ou index) ou nouveaux
    (non suivis, fichiers ignorés exclus), en chemins depuis le plugin, triés."""
    rel = plugin.relative_to(REPO).as_posix()
    found = set()
    for args in (["diff", "--name-only", "--diff-filter=d", "HEAD", "--", rel],
                 ["ls-files", "--others", "--exclude-standard", "--", rel]):
        out = git(args, 60)
        if out is None:
            raise Failed(f"git {' '.join(args[:2])} : échec")
        found |= {p for p in out.splitlines() if ".test." in Path(p).name}
    return sorted(Path(p).relative_to(rel).as_posix() for p in found)


def quick_check(plugin):
    """Le pré-contrôle rapide d'un plugin : ses contrôles statiques (l'arbre « Architecture » signalé
    dans `DEFERRED`, en échec à la fin), `tsc`, tous ses tests Node (`*.test.mjs`, qui relisent les
    sources), puis ses seuls fichiers de test du moteur touchés (terminal). Un module hors de la
    marketplace (la sonde) passe par ses propres contrôles statiques, les termes de l'export public.
    Plus de 20 suites complètes avaient échoué sur un contrôle statique que ce pré-contrôle ne voyait pas."""
    log(f"\n=== {label_of(plugin)} (pré-contrôle rapide)")
    if plugin in TOOLS.values():
        check_export_terms(plugin)
    else:
        DEFERRED.extend(static_checks(plugin))
    typecheck(plugin)
    node_tests(plugin)
    tests = [t for t in touched_tests(plugin) if not t.endswith(".test.mjs")]
    if tests:
        single_test(plugin, tests)
    else:
        log("→ aucun fichier de test du moteur touché face à HEAD")


def validate(target, claude, label=None):
    name = label or ("." if target == REPO else f"plugins/{target.name}")
    step(f"claude plugin validate {name}", [claude, "plugin", "validate", target], 300)


def check_plugin(plugin, desktop):
    log(f"\n=== {plugin.name}")
    claude = tool("claude")
    deferred = static_checks(plugin)
    DEFERRED.extend(deferred)
    check_engine_api(plugin, desktop)
    typecheck(plugin)
    node_tests(plugin)
    code, out = run([claude, "--version"], 60)
    plugin_tests(plugin, claude, f"terminal {out.strip().split(' ')[0] if code == 0 else '?'}")
    if desktop is not None:
        binary, version = desktop
        plugin_tests(plugin, binary, f"desktop {version}")
    validate(plugin, claude)
    # Un défaut signalé sans couper la suite fait échouer le contrôle : pas d'empreinte « vert ».
    if not deferred:
        remember_passed(plugin)


def shown_dir(plugin):
    """Le dossier d'un plugin ou d'un module tel qu'un message le cite : son chemin depuis le dépôt
    (`plugins/<nom>`, `scripts/sonde`) ; `plugins/<nom>` pour la copie de l'index du hook."""
    return plugin.relative_to(REPO).as_posix() if plugin.is_relative_to(REPO) else f"plugins/{plugin.name}"


def label_of(plugin):
    """Le préfixe des fichiers d'un plugin dans un message : son nom (`flow-board/hooks/…`), ou le
    chemin d'un module hors de la marketplace (`scripts/sonde/hooks/…`)."""
    return shown_dir(plugin) if plugin in TOOLS.values() else plugin.name


def target(name):
    """Le dossier que nomme un nom de la ligne de commande : un plugin de `plugins/`, ou un module du
    dépôt hors de la marketplace (`TOOLS`)."""
    return TOOLS.get(name, PLUGINS / name)


def tool_static_checks(module, desktop):
    """Les contrôles d'un module hors de la marketplace avant `tsc` : les termes de l'export public (il
    part dans la version publique) et les appels de l'API du moteur, que le Claude Code de l'app doit
    connaître (la sonde se lance aussi avec lui, et `$: any` cache ses appels à `tsc`)."""
    check_export_terms(module)
    check_engine_api(module, desktop)


def check_tool(module, desktop):
    """Les contrôles d'un module du dépôt hors de la marketplace (la sonde) : les termes de l'export et
    l'API du moteur dans l'app (`tool_static_checks`), `tsc`, puis ses tests avec
    le Claude Code du terminal et celui de l'app ; une erreur de types de la sonde n'avait été vue que
    par un `tsc` lancé à la main."""
    log(f"\n=== {module.relative_to(REPO).as_posix()}")
    claude = tool("claude")
    tool_static_checks(module, desktop)
    typecheck(module)
    code, out = run([claude, "--version"], 60)
    plugin_tests(module, claude, f"terminal {out.strip().split(' ')[0] if code == 0 else '?'}")
    if desktop is not None:
        binary, version = desktop
        plugin_tests(module, binary, f"desktop {version}")


# --- empreinte d'un plugin contrôlé -------------------------------------------


def passed_path(plugin):
    """Le fichier où ce worktree garde l'empreinte du dernier `check.sh` vert d'un plugin (dans son
    dossier git, propre à chaque worktree)."""
    code, out = run(["git", "rev-parse", "--git-path", f"check-ok/{plugin.name}"], 30)
    return (REPO / out.strip()) if code == 0 and out.strip() else None


def fingerprint(plugin, env=None):
    """L'empreinte des fichiers du plugin hors documentation, telle que l'index les porte (l'index
    nommé par `env`, sinon celui du commit en cours) : chemin, mode et contenu de chacun."""
    code, out = run(["git", "ls-files", "-s", "--", f"plugins/{plugin.name}"], 60, env=env)
    if code != 0:
        return None
    rows = [line for line in out.splitlines() if "\t" in line and not is_doc(line.split("\t", 1)[1])]
    return hashlib.sha256("\n".join(sorted(rows)).encode("utf-8")).hexdigest() if rows else None


def remember_passed(plugin):
    """Après un `check.sh` vert : l'empreinte de l'arbre de travail du plugin (fichiers ignorés exclus),
    calculée dans un index temporaire, sans toucher à l'index du dépôt."""
    path = passed_path(plugin)
    if path is None:
        return
    fd, index = tempfile.mkstemp(prefix="check-index-")
    os.close(fd)
    os.unlink(index)
    env = {"GIT_INDEX_FILE": index}
    try:
        code, _ = run(["git", "add", "-A", "--", f"plugins/{plugin.name}"], 120, env=env)
        mark = fingerprint(plugin, env) if code == 0 else None
    finally:
        if os.path.exists(index):
            os.unlink(index)
    if mark:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(mark + "\n", encoding="utf-8")


def passed_already(plugin):
    """Vrai si l'index à commiter porte exactement les fichiers (hors documentation) du dernier
    `check.sh` vert du plugin."""
    path = passed_path(plugin)
    if path is None or not path.is_file():
        return False
    mark = fingerprint(plugin)
    return mark is not None and path.read_text(encoding="utf-8").strip() == mark


# --- hook pre-commit ----------------------------------------------------------


def is_doc(path):
    """Un fichier de documentation : un .md hors des composants d'un plugin (skills, commandes,
    agents), que `validate` relit."""
    parts = path.split("/")
    component = len(parts) > 3 and parts[0] == "plugins" and parts[2] in {"skills", "commands", "agents"}
    return path.endswith(".md") and not component


def export_index():
    """Le contenu de l'index, ce que le commit enregistrera, écrit dans un dossier temporaire : le hook
    contrôle ce qui part, pas l'arbre de travail, où le test inachevé d'une autre discussion avait
    bloqué un commit, et où un fichier indexé cassé passait si sa version de l'arbre était bonne."""
    tmp = Path(tempfile.mkdtemp(prefix="check-staged-"))
    code, out = run(["git", "checkout-index", "--all", f"--prefix={tmp.as_posix()}/"], 300)
    if code != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise Failed(f"git checkout-index : {out.strip()}")
    return tmp


def staged_types(plugin, copy):
    """Les types du moteur de la copie d'un plugin (ignorés par git, donc absents de l'index) : ceux
    du plugin dans l'arbre de travail ; à défaut, `typecheck` les cherche dans le clone principal."""
    own = plugin / ".claude-plugin" / "types"
    if (own / "tsconfig.json").is_file():
        shutil.copytree(own, copy / ".claude-plugin" / "types")


def series_numbers(text):
    """Les numéros des titres « ## Série N » d'un fichier de décisions, avec leur nombre d'occurrences."""
    return Counter(int(n) for n in SERIES_TITLE.findall(text or ""))


def staged_sources():
    """Les fichiers indexés renommés ou copiés (`git mv`), avec leur chemin d'origine dans `HEAD`."""
    code, out = run(["git", "diff", "--cached", "--name-status", "-M", "-C", "-z"], 60)
    if code != 0:
        raise Failed(f"git diff --cached : {out.strip()}")
    fields, sources, i = out.split("\0"), {}, 0
    while i < len(fields) and fields[i]:
        if fields[i][0] in "RC":
            sources[fields[i + 2]] = fields[i + 1]
            i += 3
        else:
            i += 2
    return sources


def duplicate_series(path, source=None):
    """Les titres « ## Série N » qu'un fichier de décisions indexé ajoute (face à `HEAD`, au chemin
    `source` pour un fichier renommé ou copié) avec un numéro déjà pris dans ce fichier : deux
    discussions avaient pris les mêmes numéros, et les renvois devenaient ambigus. Les doublons déjà
    commités ne comptent pas, même après un `git mv`."""
    staged = series_numbers(git_show(REPO, f":{path}"))
    committed = series_numbers(git_show(REPO, f"HEAD:{source or path}"))
    doubled = sorted(n for n, count in staged.items() if count > committed[n] and count > 1)
    if not doubled:
        return []
    free = next(n for n in range(1, len(staged) + 2) if n not in staged)
    return [f"{path} : titre « ## Série {n} » ajouté alors que ce numéro existe déjà ; premier numéro libre : {free}" for n in doubled]


def check_decisions(paths):
    log("→ numéros de série des fichiers de décisions")
    sources = staged_sources()
    problems = [p for path in paths for p in duplicate_series(path, sources.get(path))]
    if problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{len(problems)} numéro(s) de série en double")
    log("  ok")


def cites_search(text):
    """Vrai si le ticket a une ligne « Recherche … » avec une commande et son résultat : sur la ligne
    même (`<commande>` suivi d'un texte), ou dans un bloc de code qui la suit (deux lignes au moins)."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if not SEARCH_LINE.match(line):
            continue
        if INLINE_SEARCH.search(line):
            return True
        if i + 1 < len(lines) and lines[i + 1].startswith("```"):
            body = []
            for inner in lines[i + 2:]:
                if inner.startswith("```"):
                    break
                body.append(inner)
            if len([b for b in body if b.strip()]) >= 2:
                return True
    return False


def lacks_search(text):
    """Vrai pour un ticket « Zone sensible : oui » sans sa recherche citée."""
    return bool(text and SENSITIVE_LINE.search(text) and not cites_search(text))


def tickets_without_search(paths, sources=None):
    """Les tickets indexés sensibles sans leur recherche citée ; un ticket que `HEAD` portait déjà
    sensible et sans elle passe (cocher un critère d'un ancien ticket ne bloque pas le commit), de même,
    pendant une fusion, qu'un ticket que la branche fusionnée (`MERGE_HEAD`) portait ainsi."""
    sources = sources or {}
    merging = git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]) is not None
    problems = []
    for path in paths:
        before = sources.get(path, path)
        # Pendant une fusion (hook pre-merge-commit), un ticket que la branche fusionnée portait déjà
        # sensible sans recherche passe aussi : il a été commité avant le contrôle.
        if lacks_search(git_show(REPO, f":{path}")) and not lacks_search(git_show(REPO, f"HEAD:{before}")) \
                and not (merging and lacks_search(git_show(REPO, f"MERGE_HEAD:{before}"))):
            problems.append(f"{path} : « Zone sensible : oui » sans ligne « Recherche … : `<commande>` — <résultat> » (ou la ligne « Recherche » suivie d'un bloc de code : la commande, puis son résultat) "
                            "(la recherche des chemins qui écrivent, fusionnent ou effacent ses données, citée avec son résultat)")
    return problems


def malformed_checkboxes(paths):
    """Les cases mal écrites des tickets indexés (`- [x ]`, `- [ x]`, `- []`, `- [X]`…), hors blocs de
    code, avec le fichier et la ligne : seules `- [ ] ` et `- [x] ` sont des cases. Une case `- [x ]`
    était passée inaperçue au cochage d'un ticket."""
    problems = []
    for path in paths:
        in_fence = False
        for n, line in enumerate((git_show(REPO, f":{path}") or "").split("\n"), 1):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
            elif not in_fence and CHECKBOX.match(line) and not CHECKBOX_OK.match(line):
                problems.append(f"{path}:{n} : case mal formée « {line.strip()[:40]} » ; écrire « - [ ] » ou « - [x] », suivi d'une espace")
    return problems


def check_tickets(paths):
    log("→ recherche citée des tickets sensibles")
    problems = tickets_without_search(paths, staged_sources())
    if problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{len(problems)} ticket(s) sensible(s) sans recherche citée")
    log("  ok")
    log("→ cases des tickets")
    problems = malformed_checkboxes(paths)
    if problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{len(problems)} case(s) mal formée(s) : " + " ; ".join(problems))
    log("  ok")


def admitted_changes(path):
    """Une liste d'admis indexée face à `HEAD` : (ses augmentations, les plugins dont un compte change).
    Une clé nouvelle compte comme une augmentation ; une liste que `HEAD` n'a pas encore n'en a pas (elle
    se relève une fois, avec le contrôle qui la lit)."""
    committed_text = git_show(REPO, f"HEAD:{path}")
    staged_counts = admitted_from(git_show(REPO, f":{path}"), path)
    committed = admitted_from(committed_text, path)
    increases = [] if committed_text is None else [
        f"{path} : « {key} » passe de {committed.get(key, 0)} à {n} admis ; une liste d'admis se nettoie, jamais n'augmente"
        for key, n in sorted(staged_counts.items()) if n > committed.get(key, 0)]
    changed = {key.split("/")[0] for key in set(staged_counts) | set(committed) if staged_counts.get(key) != committed.get(key)}
    return increases, {name for name in changed if is_plugin(name)}


def is_plugin(name):
    """Vrai pour le nom d'un plugin du dépôt (un nom simple, jamais « .. ») : la règle d'un autre sujet
    (`config/rules/general.md`) ou une clé d'admis hors des plugins ne fait copier ni contrôler rien."""
    return bool(re.fullmatch(r"[\w-]+", name)) and (REPO / "plugins" / name / ".claude-plugin" / "plugin.json").is_file()


def ruled_problems(copy, tree):
    """Les défauts que relèvent les contrôles statiques qui lisent la règle d'un plugin et les listes
    d'admis (termes retirés, renvois admis, valeurs relues brutes, exports morts, renvois de section), sur la copie de l'index `tree`."""
    return retired_terms(copy, tree / "scripts" / ADMITTED_RETIRED.name) + ticket_refs(copy, tree / "scripts" / ADMITTED_REFS.name) \
        + raw_interpolations(copy, tree / "scripts" / ADMITTED_INTERPOLATIONS.name) + dead_exports(copy, tree / "scripts" / ADMITTED_EXPORTS.name) \
        + section_refs(copy)


def refuse(name, problems):
    """L'échec du hook sur les défauts d'un plugin, chacun avec son fichier et sa ligne ; « ok » sans défaut."""
    if problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{name} : {len(problems)} défaut(s) : " + " ; ".join(problems))
    log("  ok")


def check_rules(names, tree):
    """Les contrôles statiques qui lisent la règle d'un plugin et les listes d'admis, sur la copie de
    l'index, avec ses listes d'admis."""
    for name in names:
        copy = tree / "plugins" / name
        if not (copy / ".claude-plugin" / "plugin.json").is_file():
            continue
        log(f"→ plugins/{name} : termes retirés, renvois admis, valeurs relues brutes, exports morts, renvois de section (règle ou liste indexée)")
        refuse(name, ruled_problems(copy, tree))


def check_sections(names, tree):
    """Les renvois de section de chaque plugin nommé, sur la copie de l'index : une règle ou une référence
    commune indexée a pu renommer le titre qu'ils visent."""
    log("→ renvois de section de chaque plugin (règle ou référence commune indexée)")
    problems = [p for name in names for p in section_refs(tree / "plugins" / name)]
    refuse("renvois de section", problems)


def check_code(name, tree, ruled):
    """Des contrôles statiques de check.sh sur la copie de l'index d'un plugin dont un fichier de code
    est indexé : ceux de la règle et des listes d'admis (sauf s'ils viennent de tourner, `ruled`), les
    termes de l'export public, les règles du code ; ni l'arbre « Architecture » ni les appels du moteur,
    qui restent à `check.sh`. Quatre commits de code étaient entrés dans `main` avec ce que seul
    `check.sh` relevait."""
    copy = tree / "plugins" / name
    log(f"→ plugins/{name} : renvois, termes retirés, valeurs relues brutes, exports morts, termes de l'export public, règles du code")
    problems = [] if name in ruled else ruled_problems(copy, tree)
    problems += (export_terms(copy) or []) + code_rules(copy) + invisible_chars(copy)
    refuse(name, problems)


def staged():
    code, out = run(["git", "diff", "--cached", "--name-only", "-z"], 60)
    if code != 0:
        raise Failed(f"git diff --cached : {out.strip()}")
    paths = [p for p in out.split("\0") if p]
    decisions = [p for p in paths if DECISIONS_FILE.fullmatch(p)]
    if decisions:
        check_decisions(decisions)
    tickets = [p for p in paths if TICKET_FILE.fullmatch(p)]
    if tickets:
        check_tickets(tickets)
    # La règle d'un plugin et les listes d'admis : leurs contrôles statiques, même en documentation seule,
    # et une liste d'admis qui augmente face à HEAD refusée.
    ruled = {m.group(1) for p in paths if (m := RULE_FILE.fullmatch(p) or RETIRED_LIST_FILE.fullmatch(p)) and is_plugin(m.group(1))}
    lists = [p for p in paths if ADMITTED_FILE.fullmatch(p)]
    if lists:
        log("→ listes d'admis indexées (jamais plus qu'à HEAD)")
        increases = []
        for path in lists:
            more, changed = admitted_changes(path)
            increases += more
            ruled |= changed
        if increases:
            log("\n".join(f"  {p}" for p in increases))
            raise Failed(f"{len(increases)} augmentation(s) d'une liste d'admis : " + " ; ".join(increases))
        log("  ok")
    # Une édition du CHANGELOG seul est de la documentation : sa forme se contrôle quand même.
    shaped = sorted({p.split("/")[1] for p in paths if re.fullmatch(r"plugins/[^/]+/(?:CHANGELOG\.md|\.claude-plugin/plugin\.json)", p)})
    code_paths = [p for p in paths if not is_doc(p) and not RETIRED_LIST_FILE.fullmatch(p)]
    # Une règle ou une référence commune indexée : son titre a pu changer sous les renvois des autres plugins.
    homes_changed = any(p.startswith(home + "/") for p in paths for home in SECTION_HOMES)
    if not shaped and not code_paths and not ruled and not homes_changed:
        log("pre-commit : documentation seule, pas d'autre contrôle" if decisions or tickets else "pre-commit : documentation seule, pas de contrôle")
        return
    # Tous les contrôles lisent la copie de l'index : ce qui part, jamais l'arbre de travail.
    tree = export_index()
    try:
        check_rules(sorted(ruled), tree)
        if homes_changed:
            check_sections(sorted(p.parent.parent.name for p in (tree / "plugins").glob("*/.claude-plugin/plugin.json")
                                  if p.parent.parent.name not in ruled), tree)
        for name in shaped:
            if (tree / "plugins" / name / ".claude-plugin" / "plugin.json").is_file():
                log(f"pre-commit : plugins/{name}")
                check_changelog(tree / "plugins" / name)
                check_versions(PLUGINS / name, rev="")
        if shaped:
            check_state(shaped, tree)
        if not code_paths:
            log("pre-commit : documentation seule, pas d'autre contrôle")
            return
        claude = tool("claude")
        log("pre-commit : contrôles du contenu indexé, sur une copie de l'index (Claude Code du terminal)")
        validate(tree, claude, ".")
        touched = sorted({p.split("/")[1] for p in code_paths if p.startswith("plugins/") and p.count("/") >= 2})
        for name in touched:
            plugin, copy = PLUGINS / name, tree / "plugins" / name
            if not (copy / ".claude-plugin" / "plugin.json").is_file():
                continue
            if passed_already(plugin):
                log(f"→ plugins/{name} : identique au dernier check.sh vert, contrôles sautés")
            else:
                check_code(name, tree, ruled)
                staged_types(plugin, copy)
                validate(copy, claude)
                typecheck(copy)
                plugin_tests(copy, claude, "terminal")
    finally:
        shutil.rmtree(tree, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plugins", nargs="*", help="plugins à contrôler (noms des dossiers de plugins/, ou « sonde » pour scripts/sonde)")
    parser.add_argument("--all", action="store_true", help="tous les plugins, et la sonde")
    parser.add_argument("--no-desktop", action="store_true", help="sans le Claude Code de l'app desktop")
    parser.add_argument("--staged", action="store_true", help="hook pre-commit : les plugins dont un fichier est indexé")
    parser.add_argument("--fix", action="store_true",
                        help="réécrit l'arbre « Architecture » du README des plugins et retire les blocs /** */ détachés, sans rien contrôler")
    parser.add_argument("--test", metavar="FICHIER", nargs="+", action="extend",
                        help="lance ces seuls fichiers de test du plugin nommé (terminal), sans les autres contrôles")
    parser.add_argument("--quick", action="store_true",
                        help="pré-contrôle rapide : contrôles statiques, tsc, tests Node et seuls fichiers de test du moteur touchés face à HEAD (terminal)")
    parser.add_argument("--tsc", action="store_true", help="le seul tsc des plugins nommés")
    args = parser.parse_args()
    known = {p.parent.parent.name for p in PLUGINS.glob("*/.claude-plugin/plugin.json")} | set(TOOLS)
    if args.test:
        args.test, args.plugins = split_tests(args.test, args.plugins, known)
    try:
        if args.staged:
            staged()
            return
        names = sorted(known) if args.all else args.plugins
        if not names:
            parser.error("nommer au moins un plugin, ou --all")
        unknown = [n for n in names if n not in known]
        if unknown:
            raise Failed(f"plugin inconnu : {', '.join(unknown)} (connus : {', '.join(sorted(known))})")
        if args.test:
            if len(names) != 1:
                parser.error("--test : nommer un seul plugin")
            single_test(target(names[0]), args.test)
            log(f"\n{'Les tests sont passés' if len(args.test) > 1 else 'Le test est passé'}.")
            return
        if args.tsc:
            for name in names:
                log(f"\n=== {name} (tsc seul)")
                typecheck(target(name))
            log("\nLes types sont bons.")
            return
        if args.quick:
            for name in names:
                quick_check(target(name))
            fail_deferred(DEFERRED)
            log(f"\nPré-contrôle passé ; la suite complète reste à lancer (scripts/check.sh {' '.join(names)}).")
            return
        if args.fix:
            for name in names:
                if name not in TOOLS:
                    fix_architecture(PLUGINS / name)
                    for said in fix_detached_docs(PLUGINS / name):
                        log(f"  {said}")
            log(f"\nRelancer scripts/check.sh {' '.join(names)} pour les contrôles.")
            return
        desktop = None
        if not args.no_desktop:
            desktop = desktop_claude()
            if desktop is None:
                raise Failed("Claude Code de l'app desktop introuvable : installer l'app, ou relancer avec --no-desktop")
        for name in names:
            if name in TOOLS:
                check_tool(TOOLS[name], desktop)
            else:
                check_plugin(PLUGINS / name, desktop)
        validate(REPO, tool("claude"))
        check_state(names)
        fail_deferred(DEFERRED)
    except Failed as err:
        if DEFERRED and not isinstance(err, DeferredFailed):
            log("\nSignalés plus haut, sans arrêter les contrôles :")
            log("\n".join(f"  {p}" for p in DEFERRED))
        log(f"\nÉCHEC : {err}")
        sys.exit(1)
    log("\nTous les contrôles sont passés.")


if __name__ == "__main__":
    main()
