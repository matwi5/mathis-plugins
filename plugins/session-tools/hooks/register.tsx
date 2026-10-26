// Outils de session (session-tools), dans un seul module : le moteur suit `$` seulement dans le
// fichier où il est passé, et n'accepte qu'un hook par événement sans filtre.
//
// - Pied du prompt : la durée de la dernière réponse (chrono lancé à l'envoi d'un message,
//   arrêté quand l'agent a fini), la vitesse du modèle en tokens/s depuis ce message, le temps
//   restant avant que le cache de prompt expire, l'heure, et des boutons : Fichiers (navigateur
//   files-board) et Diff au terminal, Réécrire, Effort auto et Ultracode (on/off) partout. Sur
//   desktop, le pied est trop étroit : les valeurs passent dans un bandeau au-dessus du prompt.
// - Réécrire : le brouillon du champ de saisie, réécrit en prompt (option `model`, Opus par défaut,
//   effort low) avec la consigne de `rewrite-system.ts`, remplace le brouillon sans être envoyé.
// - Effort auto : le même modèle choisit le niveau d'effort du brouillon avec la consigne de
//   `effort-system.ts`, puis le mod le règle par `/effort` avant l'envoi.
// - `/session-tools:start` : un premier message qui démarre les mods sans solliciter le modèle.
//
// Le panneau Asana (/asana) est passé dans son propre plugin, asana-board.

import type { EngineInterface, PromptOrigin, Register } from "claude-code";
import type { GenerationSpeed, ResponseTimer } from "../types";
import { EFFORT_SYSTEM } from "./effort-system";
import { REWRITE_SYSTEM } from "./rewrite-system";

// Gardés par l'hôte : survivent au rechargement à chaud du module.
const lastRequest = { plugin: "session-tools", key: "lastRequestAt" } as const;
const ultracode = { plugin: "session-tools", key: "ultracode" } as const;
const rewriting = { plugin: "session-tools", key: "rewriting" } as const;
const choosingEffort = { plugin: "session-tools", key: "choosingEffort" } as const;
const responseTimer = { plugin: "session-tools", key: "responseTimer" } as const;
const generationSpeed = { plugin: "session-tools", key: "generationSpeed" } as const;

// Le message en route vers son tour : `at` est son heure d'envoi, null s'il ne vient pas de
// l'utilisateur (le tour qu'il démarre ne touche alors pas au chrono).
let pending: { at: number | null } | null = null;

// Les boutons dont l'appel au modèle est en cours : marqués avant tout `await`, un double clic ne
// lance qu'un appel. Une variable du module repart à vide au rechargement, où l'appel est perdu.
const busyButtons = new Set<string>();

// Le modèle des boutons Réécrire et Effort auto, toujours en effort low : l'option `model` du
// manifeste (opus par défaut), relue à chaque chargement du module.
const BUTTON_MODELS = ["opus", "sonnet", "haiku"];
let buttonModel = "opus";

export const register: Register = (on, options) => {
  buttonModel = BUTTON_MODELS.includes(String(options.model)) ? String(options.model) : "opus";
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    // Un rechargement pendant un appel au modèle laisserait « Réécriture… » ou « Effort… » pour de bon.
    await $.state.set(rewriting, false);
    await $.state.set(choosingEffort, false);
    // Redessine le pied chaque seconde (compte à rebours, heure), tant que le module est chargé.
    $.clock.every(1000, () => $.ui.invalidate("ui.render"));
    return result;
  });

  // `/session-tools:start` (commands/start.md) : un premier message qui démarre la session, donc
  // tous les mods et leurs bandeaux, sans passer par le modèle ni ouvrir de panneau.
  on("command.run", { command: "session-tools:start" }, async () => ({ text: "Mods démarrés." }));

  // Ultracode se règle par `/effort` : le mod en déduit l'état, que la commande vienne du
  // bouton ou de la saisie. Le sélecteur d'effort de l'app lui échappe.
  on("command.run", { command: "effort" }, async ($, e, next) => {
    const result = await next(e);
    await noteUltracode($, e.args, result.text);
    return result;
  }).catch(() => undefined); // en cas de panne du mod, `/effort` passe sans lui

  // Chrono de réponse : lancé à l'envoi d'un message, arrêté à la fin du tour du fil principal.
  on("prompt.submit", async ($, e, next) => {
    // Une notification, un pair, une tâche planifiée : le chrono n'y réagit pas.
    const at = fromUser(e.origin) ? await $.clock.now() : null;
    if (at !== null && e.turnId) {
      // Envoyé pendant que l'agent répond : le message rejoint le tour en cours, le chrono repart.
      await startTimer($, at);
      return next(e);
    }
    // `next` rend la main une fois le tour démarré : `turn.start` relève `pending` entre-temps.
    pending = { at };
    try {
      return await next(e);
    } finally {
      pending = null;
    }
  }).catch(() => undefined); // en cas de panne du mod, le message passe sans lui

  on("turn.start", async ($, e, next) => {
    // Le tour d'un sous-agent (`agentId`) ne touche pas au chrono du fil principal.
    if (e.agentId !== undefined) return next(e);
    // Un message de l'utilisateur, ou une commande qui passe au modèle sans `prompt.submit` ;
    // une simple relance (texte vide, après une notification) ne touche pas au chrono.
    const at = pending ? pending.at : e.text !== "" ? await $.clock.now() : null;
    pending = null;
    if (at !== null) await startTimer($, at);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (!e.agentId) {
      const { value: timer = null } = await $.state.get(responseTimer);
      if (timer && timer.endedAt === null) {
        await $.state.set(responseTimer, { ...timer, endedAt: await $.clock.now() });
        $.ui.invalidate("ui.render");
      }
    }
    return next(e);
  });

  on("turn.step", async function* ($, e, next) {
    // Les sous-agents ont leur propre cache, et leur génération, parallèle, fausserait la vitesse.
    if (e.agentId) return yield* next(e);
    // Chaque requête du fil principal relit le cache et relance sa durée de vie.
    await $.state.set(lastRequest, await $.clock.now());
    $.ui.invalidate("ui.render");
    // Vitesse : les tokens générés sur le temps de génération seul, du premier morceau de la
    // réponse (après la lecture du prompt) au dernier. Outils, commandes et tâches de fond
    // tournent hors de ce flux : ils ne comptent pas.
    const stream = next(e);
    let firstAt: number | null = null;
    for await (const chunk of stream) {
      if (firstAt === null) firstAt = await $.clock.now();
      if (chunk.kind === "stop" && chunk.usage) await noteSpeed($, chunk.usage.output_tokens, firstAt);
      yield chunk;
    }
    return await stream.result;
  });

  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    const { value: isUltracode = false } = await $.state.get(ultracode);
    const { value: isRewriting = false } = await $.state.get(rewriting);
    const { value: isChoosingEffort = false } = await $.state.get(choosingEffort);
    const isTerminal = e.surface === "terminal";
    // L'app desktop coupe son pied, bouton compris, vers 25 caractères : il n'y garde que les
    // modes et le bouton ; les valeurs sont dans le bandeau (AbovePrompt).
    const now = await $.clock.now();
    const items: FooterItem[] = [
      ...e.props.modes.map((value) => ({ value })),
      ...(isTerminal ? [...(await metrics($, now)), { value: time(now) }] : []),
    ];
    // Le mod dessine lui-même le pied : l'app desktop ignore une liste `modes`
    // réécrite et laissée au dessin du moteur.
    const { Box, Text, Button } = $.ui.resolve(e);
    // Un clic lance `/effort ultracode on|off`, comme si la commande était tapée. L'état est
    // relu au clic : le terminal garde le premier `onPress` du bouton d'un dessin à l'autre.
    const ultracodeButton = Button({
      key: "ultracode",
      label: `Ultracode ${isUltracode ? "on" : "off"}`,
      plain: true,
      dimColor: !isUltracode,
      onPress: () => {
        $.state
          .get(ultracode)
          .then(async ({ value: isOn = false }) => {
            const args = `ultracode ${isOn ? "off" : "on"}`;
            const result = await $.command.run({ command: "effort", args });
            await noteUltracode($, args, result.text);
          })
          .catch((error) => $.ui.toast(`Ultracode : ${String(error)}`));
      },
    });
    const rewriteButton = Button({
      key: "rewrite",
      label: isRewriting ? "Réécriture…" : "Réécrire",
      plain: true,
      dimColor: true,
      onPress: () => {
        const setBusy = (isBusy: boolean) => $.state.set(rewriting, isBusy);
        onDraft($, "Réécrire", setBusy, (draft) => rewrite($, draft)).catch((error) =>
          $.ui.toast(`Réécrire : ${String(error)}`),
        );
      },
    });
    const effortButton = Button({
      key: "effort",
      label: isChoosingEffort ? "Effort…" : "Effort auto",
      plain: true,
      dimColor: true,
      onPress: () => {
        const setBusy = (isBusy: boolean) => $.state.set(choosingEffort, isBusy);
        onDraft($, "Effort auto", setBusy, (draft) => chooseEffort($, draft)).catch((error) =>
          $.ui.toast(`Effort auto : ${String(error)}`),
        );
      },
    });
    const texts = drawItems(Text, items);
    if (!isTerminal) {
      // L'app desktop place elle-même ses boutons natifs devant le texte, quel que soit l'ordre.
      return Box({ flexDirection: "row", flexShrink: 0, children: [rewriteButton, effortButton, ultracodeButton, ...texts] });
    }
    // Terminal seulement (l'app desktop a les siens) : « Fichiers » ouvre ou ferme le navigateur
    // de files-board, « Diff » le panneau de diff (`/diff` est une bascule en plein écran).
    const commandButton = (key: string, label: string, command: string, args = "") =>
      Button({
        key,
        label,
        plain: true,
        dimColor: true,
        onPress: () => {
          $.command.run({ command, args }).catch((error) => $.ui.toast(`${label} : ${String(error)}`));
        },
      });
    const sep = () => Text({ dimColor: true, children: SEPARATOR });
    const buttons = [
      commandButton("files", "Fichiers", "files-board:files", "toggle"),
      sep(),
      commandButton("diff", "Diff", "diff"),
      sep(),
      rewriteButton,
      sep(),
      effortButton,
      sep(),
      ultracodeButton,
    ];
    // Terminal : le pied calé à droite, les boutons en dernier, après l'heure.
    const children = [...texts, ...(texts.length ? [sep()] : []), ...buttons];
    return Box({ flexDirection: "row", flexGrow: 1, flexShrink: 0, justifyContent: "flex-end", children });
  });

  // Desktop seulement : chrono, tokens/s et cache sur une ligne au-dessus du prompt, en haut à
  // gauche du bloc des bandeaux, au-dessus de ceux des autres plugins (stats-board, flow-board…).
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.surface !== "desktop" || e.props.hasSurvey) return next(e);
    const items = await metrics($, await $.clock.now());
    const below = await next(e);
    if (!items.length) return below;
    const { Box, Text } = $.ui.resolve(e);
    const width = e.props.bodyColumns;
    const own = Box({
      key: "session-tools",
      flexDirection: "row",
      flexShrink: 0,
      width,
      children: drawItems(Text, items),
    });
    if (below.type === "engine") return own;
    return Box({ flexDirection: "column", width, children: [own, below] });
  });
};

// ─── Chrono de réponse ──────────────────────────────────────────────────────

// Les messages de l'utilisateur : tapés au terminal ou dans l'app desktop, par Remote Control
// ou Slack. `unclassified` en fait partie : l'app desktop peut envoyer sans marque d'origine.
const USER_ORIGINS = new Set(["composer", "sdk", "bridge", "slack-ping", "unclassified"]);

function fromUser(origin: PromptOrigin | undefined) {
  if (!origin) return true;
  if (origin.kind === "plugin") return origin.asUser === true;
  return USER_ORIGINS.has(origin.kind);
}

async function startTimer($: EngineInterface, at: number) {
  await $.state.set(responseTimer, { startedAt: at, endedAt: null });
  // La vitesse repart du même message que le chrono.
  await $.state.set(generationSpeed, null);
  $.ui.invalidate("ui.render");
}

// Chrono, tokens/s et cache, tels que le pied (terminal) ou le bandeau (desktop) les affichent.
async function metrics($: EngineInterface, now: number) {
  const { value: last = null } = await $.state.get(lastRequest);
  const { value: timer = null } = await $.state.get(responseTimer);
  const { value: speed = null } = await $.state.get(generationSpeed);
  return footer(now, last, timer, speed);
}

async function noteSpeed($: EngineInterface, tokens: number, firstAt: number) {
  const ms = (await $.clock.now()) - firstAt;
  const { value: speed = null } = await $.state.get(generationSpeed);
  await $.state.set(generationSpeed, { tokens: (speed?.tokens ?? 0) + tokens, ms: (speed?.ms ?? 0) + ms });
  $.ui.invalidate("ui.render");
}

// ─── Réécrire le brouillon ──────────────────────────────────────────────────

// Effort low : sur 7 brouillons réels (qualité, puis temps, puis coût), Opus low devant Opus
// medium (même qualité, deux fois plus lent), Sonnet et Haiku ; le modèle est l'option `model`.
// Un prompt réécrit dépasse souvent les 1024 tokens de réponse par défaut.
const REWRITE_REQUEST = { effort: "low", maxTokens: 4000, timeoutMs: 120_000 } as const;

// Lit le brouillon et le passe à `work`, le bouton `name` marqué occupé (`setBusy`, qui écrit son
// état : le moteur veut chaque référence d'état écrite en clair) le temps de l'appel.
async function onDraft(
  $: EngineInterface,
  name: string,
  setBusy: (isBusy: boolean) => Promise<unknown>,
  work: (draft: string) => Promise<void>,
) {
  if (busyButtons.has(name)) return;
  busyButtons.add(name);
  try {
    const draft = (await $.prompt.read()).text;
    if (!draft.trim()) {
      await $.ui.toast(`${name} : le champ de saisie est vide.`);
      return;
    }
    await setBusy(true);
    $.ui.invalidate("ui.render");
    await work(draft);
  } finally {
    busyButtons.delete(name);
    await setBusy(false);
    $.ui.invalidate("ui.render");
  }
}

async function rewrite($: EngineInterface, draft: string) {
  const reply = await $.model.complete({
    ...REWRITE_REQUEST,
    model: buttonModel,
    // Marquée pour le cache : des clics rapprochés relisent la consigne au lieu de la repayer.
    system: [{ text: REWRITE_SYSTEM, cache: true }],
    prompt: `<brouillon>\n${draft}\n</brouillon>`,
  });
  if (!reply.isAnswered) {
    await $.ui.toast(`Réécrire : pas de réponse (${reply.reason}).`);
    return;
  }
  const text = reply.text.trim();
  if (!text) {
    await $.ui.toast("Réécrire : réponse vide, le brouillon est laissé tel quel.");
    return;
  }
  // Ce qui a été tapé pendant la réécriture n'est pas écrasé (relu juste avant d'écrire).
  if ((await $.prompt.read()).text !== draft) {
    await $.ui.toast("Réécrire : le brouillon a changé pendant la réécriture, il est laissé tel quel.");
    return;
  }
  const filled = await $.prompt.fill({ text, mode: "replace" });
  if (!filled.isFilled) await $.ui.toast(`Réécrire : le champ de saisie a refusé le texte (${filled.refusal ?? "refus d'un autre plugin"}).`);
}

// ─── Effort auto ────────────────────────────────────────────────────────────

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
// Le même modèle que Réécrire ; la réponse est une ligne de JSON.
const EFFORT_REQUEST = { effort: "low", maxTokens: 1000, timeoutMs: 60_000 } as const;

async function chooseEffort($: EngineInterface, draft: string) {
  const reply = await $.model.complete({
    ...EFFORT_REQUEST,
    model: buttonModel,
    system: [{ text: EFFORT_SYSTEM, cache: true }],
    prompt: `<brouillon>\n${draft}\n</brouillon>`,
  });
  if (!reply.isAnswered) {
    await $.ui.toast(`Effort auto : pas de réponse (${reply.reason}).`);
    return;
  }
  const choice = effortChoice(reply.text);
  if (!choice) {
    await $.ui.toast("Effort auto : réponse illisible, l'effort est laissé tel quel.");
    return;
  }
  // Brouillon envoyé ou changé pendant l'appel : le niveau ne vaudrait plus pour lui.
  if ((await $.prompt.read()).text !== draft) {
    await $.ui.toast("Effort auto : le brouillon a changé pendant le choix, l'effort est laissé tel quel.");
    return;
  }
  // Comme le bouton Ultracode : la commande tapée, dont l'état d'Ultracode se déduit. Claude Code
  // garde ce niveau comme défaut des nouvelles sessions (sauf max), et peut demander de confirmer
  // un changement en cours de discussion : la notification dit « demandé », pas « réglé ».
  const result = await $.command.run({ command: "effort", args: choice.effort });
  await noteUltracode($, choice.effort, result.text);
  await $.ui.toast(`Effort demandé : ${choice.effort}${choice.reason ? ` (${choice.reason})` : ""}`);
}

// `{"effort": "high", "raison": "…"}`, au besoin entouré d'autre texte ; undefined sans niveau valide.
function effortChoice(text: string) {
  try {
    const { effort, raison } = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (EFFORT_LEVELS.includes(effort)) return { effort: effort as string, reason: typeof raison === "string" ? raison.trim() : "" };
  } catch {
    // réponse sans JSON valide
  }
  return undefined;
}

// ─── Pied du prompt ─────────────────────────────────────────────────────────

// En interactif, `/effort` est une commande à interface : sa ligne s'affiche mais ne revient
// pas au mod (`text` absent). L'état se déduit alors des arguments ; quand le texte revient
// (« Ultracode on (this session only)… », « Ultracode off… », un refus), il fait foi.
async function noteUltracode($: EngineInterface, args: string, text: string | undefined) {
  const isOn = ultracodeFrom(text ?? "") ?? ultracodeFrom(args);
  if (isOn !== undefined) await $.state.set(ultracode, isOn);
}

function ultracodeFrom(text: string) {
  if (/Ultracode isn't available|Ultracode needs/.test(text)) return false;
  if (/Ultracode on/i.test(text)) return true;
  if (/Ultracode off/i.test(text)) return false;
  return undefined;
}

// Durée de vie du cache de prompt : 1 h pour Claude Code (5 min en dépassement d'usage).
// Passé ce délai, le tour suivant repaie l'écriture de tout le contexte.
const TTL_MS = 60 * 60 * 1000;
// Par exemple « Réponse 1:23 ✓ · 48 tok/s · Cache 59:49 · 18:05 · Ultracode off » au terminal,
// « Réponse 1:23 ✓ · 48 tok/s · Cache 59:49 » dans le bandeau desktop : libellés estompés,
// valeurs claires ; la coche dit que l'agent a fini.

type FooterItem = { label?: string; value: string };

const SEPARATOR = " · ";

function footer(now: number, last: number | null, timer: ResponseTimer, speed: GenerationSpeed) {
  const items: FooterItem[] = [];
  if (timer) {
    const elapsed = duration((timer.endedAt ?? now) - timer.startedAt);
    items.push({ label: "Réponse", value: timer.endedAt === null ? elapsed : `${elapsed} ✓` });
  }
  if (speed && speed.ms > 0) items.push({ value: `${Math.round((speed.tokens * 1000) / speed.ms)} tok/s` });
  if (last !== null) {
    const remaining = TTL_MS - (now - last);
    items.push({ label: "Cache", value: remaining > 0 ? countdown(remaining) : "expiré" });
  }
  return items;
}

// L'app desktop ignore `columnGap` et fond les espaces ordinaires : les écarts
// sont des espaces insécables, et un point estompé sépare les groupes.
function drawItems(Text: (props: { dimColor?: boolean; children: string }) => any, items: FooterItem[]) {
  return items.flatMap((item, i) => [
    ...(i > 0 ? [Text({ dimColor: true, children: SEPARATOR })] : []),
    ...(item.label ? [Text({ dimColor: true, children: `${item.label} ` })] : []),
    Text({ children: item.value }),
  ]);
}

function countdown(ms: number) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

function duration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

function time(ms: number) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
