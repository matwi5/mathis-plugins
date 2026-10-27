// Outils de session (session-tools), dans un seul module : le moteur suit `$` seulement dans le
// fichier où il est passé, et n'accepte qu'un hook par événement sans filtre.
//
// - Pied du prompt : la durée de la dernière requête (chrono lancé à l'envoi d'un message,
//   arrêté quand le fil principal a fini et que plus aucune tâche de fond de la requête ne tourne,
//   avec leur nombre en attendant), la vitesse du modèle en tokens/s depuis ce message, le temps
//   restant avant que le cache de prompt expire, l'heure, et des boutons : Fichiers (navigateur
//   files-board) et Diff au terminal, Réécrire et Effort auto partout. Sur
//   desktop, le pied est trop étroit : les valeurs passent dans un bandeau au-dessus du prompt.
// - Réécrire : le brouillon du champ de saisie, réécrit en prompt (option `model`, Opus par défaut,
//   effort low) avec la consigne de `rewrite-system.ts`, remplace le brouillon sans être envoyé.
// - Effort auto : le même modèle choisit le niveau d'effort du brouillon avec la consigne de
//   `effort-system.ts`, puis le mod le règle par `/effort` avant l'envoi.
// - `/session-tools:start` : un premier message qui démarre les mods sans solliciter le modèle.
//
// Le chrono applique la même filiation que le suivi des requêtes de stats-board
// (`plugins/stats-board/hooks/requests.ts` et son `register.tsx`), décrite dans
// `docs/evenements-moteur.md` (« Ordre des événements », « Filiation »), à garder alignés à la main :
// un prompt reçu au repos retrouve son `turn.start` par le texte (`prompt.submit` rend la main
// après) ; les origines d'un message de l'utilisateur (`USER_ORIGINS`, `fromUser`) ; une notification
// reconnue par son origine (`task-notification` et son `<task-id>`, `peer` et son
// `<agent-message from>`), ou par son seul texte après un rechargement ; une tâche de fond rattachée à
// sa première apparition dans `background_tasks` ; la fin quand le fil principal est au repos et que
// la dernière liste n'a plus de tâche de la requête ; sur une interruption ou une erreur (sans
// `classic.Stop`), les tâches connues plus les agents `running`, `pending` ou `waiting` ; une
// requête finie normalement jamais rouverte par une tâche inconnue. Le chrono ne suit que la dernière
// requête, stats-board toutes : une règle changée d'un côté se change de l'autre, puis dans la doc.
//
// Le panneau Asana (/asana) est passé dans son propre plugin, asana-board.

import type { EngineInterface, PromptOrigin, Register } from "claude-code";
import type { GenerationSpeed, ResponseTimer } from "../types";
import { EFFORT_SYSTEM } from "./effort-system";
import { REWRITE_SYSTEM } from "./rewrite-system";

// Gardés par l'hôte : survivent au rechargement à chaud du module.
const lastRequest = { plugin: "session-tools", key: "lastRequestAt" } as const;
const rewriting = { plugin: "session-tools", key: "rewriting" } as const;
const choosingEffort = { plugin: "session-tools", key: "choosingEffort" } as const;
const responseTimer = { plugin: "session-tools", key: "responseTimer" } as const;
const generationSpeed = { plugin: "session-tools", key: "generationSpeed" } as const;
const backgroundTasks = { plugin: "session-tools", key: "backgroundTasks" } as const;

// Les prompts reçus au repos, en attente du `turn.start` de leur tour, et les messages envoyés
// pendant un tour, que le moteur peut livrer au tour suivant (un message livré dans le tour en
// cours n'a pas de `turn.start` : il sort de la liste avec les plus anciens). Le moteur rend la main de
// `prompt.submit` avant ce tour (essai du 26/10/2026, Claude Code 2.1.310 et 2.1.308), donc
// `turn.start` retrouve le sien par le texte, le même dans les deux événements. Une variable du
// module, vide après un rechargement : un texte non vide compte alors comme un message. Les dix
// derniers suffisent : un prompt attend son tour quelques millisecondes (essai), et la liste ne
// grossit pas si un tour ne démarre jamais.
let submitted: Submitted[] = [];
// `isStarted` : un message envoyé pendant un tour, dont la requête est déjà partie à son envoi.
type Submitted = { text: string; at: number; isUser: boolean; origin: PromptOrigin | undefined; isStarted?: boolean };

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

  // Chrono de la requête : lancé à l'envoi d'un message, arrêté quand le fil principal a fini et
  // qu'aucune tâche de fond de la requête ne tourne plus (`classic.Stop` en donne la liste).
  on("prompt.submit", async ($, e, next) => {
    const isUser = fromUser(e.origin);
    const at = await $.clock.now();
    if (e.turnId) {
      // Envoyé pendant que l'agent répond : le message rejoint le tour en cours et ouvre une
      // nouvelle requête. Une notification livrée dans ce tour ne touche pas au chrono, mais sa
      // tâche, finie, quitte la requête à cet instant (docs/evenements-moteur.md, « Filiation »).
      // Le moteur peut aussi le livrer au tour suivant : noté comme déjà parti, son `turn.start`
      // ne relance pas le chrono.
      if (isUser) {
        await startTimer($, at);
        submitted = [...submitted.slice(-9), { text: e.text, at, isUser, origin: e.origin, isStarted: true }];
      } else await dropTask($, notifiedTask(e));
      return next(e);
    }
    submitted = [...submitted.slice(-9), { text: e.text, at, isUser, origin: e.origin }];
    return next(e);
  }).catch(() => undefined); // en cas de panne du mod, le message passe sans lui

  on("turn.start", async ($, e, next) => {
    // Le tour d'un sous-agent (`agentId`) ne touche pas au chrono du fil principal.
    if (e.agentId !== undefined) return next(e);
    // Le plus récent : un prompt resté sans tour (refusé, consommé par un hook) ne prête pas son
    // heure à un message identique envoyé plus tard ; ses doublons partent avec.
    const noted = submitted[submitted.findLastIndex((p) => p.text === e.text)] ?? null;
    if (noted) submitted = submitted.filter((p) => p.text !== e.text);
    // Sans prompt reçu (module rechargé entre les deux), une notification se reconnaît encore à
    // son texte.
    const prompt = noted ?? (await notificationOf($, e.text));
    // Un message de l'utilisateur ouvre une requête ; une notification peut prolonger la sienne.
    // Sans prompt reçu : une commande qui passe au modèle compte comme un message ; une simple
    // relance (texte vide) ne touche pas au chrono.
    if (prompt?.isStarted) await resumeTimer($);
    else if (prompt ? prompt.isUser : e.text !== "") await startTimer($, prompt?.at ?? (await $.clock.now()));
    else if (prompt) await noteRelaunch($, prompt);
    return next(e);
  });

  on("classic.Stop", async ($, e, next) => {
    // Le fil principal s'arrête : la liste des tâches de fond est à jour (`turn.complete` suit).
    await noteBackground($, e.background_tasks ? e.background_tasks.map((t) => t.id) : await activeAgents($));
    return next(e);
  }).catch(() => undefined); // en cas de panne du mod, l'arrêt passe sans lui

  on("classic.SubagentStop", async ($, e, next) => {
    // Un agent s'arrête, ceux de Claude Code compris (titre, suggestion) : sa liste est à jour
    // aussi, et peut dire que la dernière tâche de la requête a fini sans relancer de tour.
    if (e.background_tasks) await noteBackground($, e.background_tasks.map((t) => t.id), true);
    return next(e);
  }).catch(() => undefined); // en cas de panne du mod, l'arrêt passe sans lui

  on("turn.complete", async ($, e, next) => {
    if (!e.agentId) {
      const { value: timer = null } = await $.state.get(responseTimer);
      if (timer && timer.endedAt === null) {
        const { others, tasks: known } = listsOf(timer);
        let tasks = known;
        // Hors d'une fin normale, pas de `classic.Stop` pour mettre la liste à jour (interruption :
        // docs/evenements-moteur.md ; erreur d'API ou refus : `StopFailure` à la place d'après les types du moteur,
        // à confirmer) : restent les tâches déjà connues de la requête et ses agents encore actifs.
        if (e.reason !== "answer") tasks = [...new Set([...tasks, ...(await activeAgents($)).filter((id) => !others.includes(id))])];
        const endedAt = tasks.length ? null : await $.clock.now();
        // Finie sans liste à jour, la requête peut avoir lancé une tâche que personne n'a vue :
        // seule une requête finie ainsi se laisse rouvrir par une tâche inconnue.
        await $.state.set(responseTimer, { ...timer, tasks, endedAt, isIdle: true, isInterrupted: e.reason !== "answer" });
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
      return Box({ flexDirection: "row", flexShrink: 0, children: [rewriteButton, effortButton, ...texts] });
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

// ─── Chrono de la requête ──────────────────────────────────────────────────────

// Les messages de l'utilisateur : tapés au terminal ou dans l'app desktop, par Remote Control
// ou Slack. `unclassified` en fait partie : l'app desktop peut envoyer sans marque d'origine.
const USER_ORIGINS = new Set(["composer", "sdk", "bridge", "slack-ping", "unclassified"]);

function fromUser(origin: PromptOrigin | undefined) {
  if (!origin) return true;
  if (origin.kind === "plugin") return origin.asUser === true;
  return USER_ORIGINS.has(origin.kind);
}

async function startTimer($: EngineInterface, at: number) {
  // Les tâches de fond déjà là appartiennent aux requêtes d'avant : elles ne retiennent pas celle-ci.
  const { value: seen = [] } = await $.state.get(backgroundTasks);
  await $.state.set(responseTimer, { startedAt: at, endedAt: null, tasks: [], others: seen, own: [], isIdle: false });
  // La vitesse repart du même message que le chrono.
  await $.state.set(generationSpeed, null);
  $.ui.invalidate("ui.render");
}

// Le tour d'un message envoyé pendant le tour d'avant et livré après lui : sa requête est partie à
// l'envoi. La requête affichée (la sienne, ou celle d'un message plus récent, qui attend ce tour)
// continue sans repartir de zéro, puisque le fil principal travaille.
async function resumeTimer($: EngineInterface) {
  const { value: timer = null } = await $.state.get(responseTimer);
  if (!timer) return;
  await $.state.set(responseTimer, { ...timer, endedAt: null, isIdle: false });
  $.ui.invalidate("ui.render");
}

// Un tour relancé sans message de l'utilisateur. La notification d'une tâche de la requête, ou
// d'une tâche inconnue (lancée dans un tour interrompu), la prolonge : le chrono reprend sans
// repartir de zéro. Celle d'une requête d'avant, un pair, une tâche planifiée n'y touchent pas.
async function noteRelaunch($: EngineInterface, prompt: Submitted) {
  const { value: timer = null } = await $.state.get(responseTimer);
  const id = notifiedTask(prompt);
  if (!timer || id === null) return;
  const { tasks, own, others } = listsOf(timer);
  if (others.includes(id)) return;
  // Une requête finie normalement ne se rouvre que pour une tâche qu'elle a eue : une tâche apparue
  // après sa fin (lancée par une tâche planifiée, par exemple) n'est pas à elle.
  if (timer.endedAt !== null && !timer.isInterrupted && !own.includes(id)) return;
  // Un message de pair vient d'une autre session, sauf s'il est le retour d'un agent connu : une
  // tâche que la requête a eue, même finie depuis (un agent annonce sa fin, puis envoie son
  // message de retour), ou un agent encore actif.
  if (prompt.origin?.kind === "peer" && !own.includes(id) && !(await activeAgents($)).includes(id)) return;
  // La tâche notifiée a fini : elle ne retient plus la requête, même si ce tour est interrompu.
  await $.state.set(responseTimer, { ...timer, tasks: tasks.filter((t) => t !== id), own, endedAt: null, isIdle: false });
  $.ui.invalidate("ui.render");
}

// La tâche d'une notification livrée pendant un tour a fini : elle ne retient plus la requête,
// même si ce tour est interrompu ensuite (pas de `classic.Stop` pour mettre la liste à jour).
async function dropTask($: EngineInterface, id: string | null) {
  const { value: timer = null } = await $.state.get(responseTimer);
  if (!timer || id === null || timer.endedAt !== null) return;
  const { tasks, own } = listsOf(timer);
  if (!tasks.includes(id)) return;
  await $.state.set(responseTimer, { ...timer, tasks: tasks.filter((t) => t !== id), own });
  $.ui.invalidate("ui.render");
}

// La tâche qu'annonce une notification : `<task-id>` d'une commande de fond, ou l'agent d'un
// message de retour (`<agent-message from="…">`) ; null pour tout autre prompt.
function notifiedTask(prompt: { text: string; origin?: PromptOrigin }) {
  const kind = prompt.origin?.kind;
  const match =
    kind === "task-notification"
      ? /<task-id>([^<]+)<\/task-id>/.exec(prompt.text)
      : kind === "peer"
        ? /^<agent-message from="([^"]+)"/.exec(prompt.text)
        : null;
  return match?.[1] ?? null;
}

// La liste des tâches de fond vue à un arrêt : gardée pour la requête suivante, et, pour la
// requête en cours, réduite à ses propres tâches. `isAgentStop` : l'arrêt d'un agent, qui ne
// clôt la requête que si le fil principal a déjà fini.
async function noteBackground($: EngineInterface, ids: string[], isAgentStop = false) {
  await $.state.set(backgroundTasks, ids);
  const { value: timer = null } = await $.state.get(responseTimer);
  if (!timer || timer.endedAt !== null) return;
  const { others, own } = listsOf(timer);
  const tasks = ids.filter((id) => !others.includes(id));
  const endedAt = isAgentStop && timer.isIdle && !tasks.length ? await $.clock.now() : null;
  await $.state.set(responseTimer, { ...timer, tasks, own: [...new Set([...own, ...tasks])], endedAt });
  $.ui.invalidate("ui.render");
}

// Le prompt d'une notification reconnue à son seul texte, sans `prompt.submit` gardé : la
// `task-notification` d'une tâche, ou le message de retour d'un agent (origine `peer`).
async function notificationOf($: EngineInterface, text: string): Promise<Submitted | null> {
  const kind = text.startsWith("<task-notification>") ? "task-notification" : text.startsWith("<agent-message from=") ? "peer" : null;
  if (!kind) return null;
  return { text, at: await $.clock.now(), isUser: false, origin: { kind } as PromptOrigin };
}

// Les listes d'un chrono, vides quand une version d'avant la 0.21.0 l'a écrit sans elles.
function listsOf(timer: NonNullable<ResponseTimer>) {
  return { tasks: timer.tasks ?? [], others: timer.others ?? [], own: timer.own ?? timer.tasks ?? [] };
}

// Repli sans liste des tâches de fond (version de Claude Code qui ne la donne pas) : les agents
// encore actifs ; aucun si la liste des agents manque aussi.
async function activeAgents($: EngineInterface) {
  try {
    const agents = await $.agent.list();
    return agents.filter((a) => a.status === "running" || a.status === "pending" || a.status === "waiting").map((a) => a.id);
  } catch {
    return [];
  }
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
  // La commande, comme si elle était tapée. Claude Code garde ce niveau comme défaut des nouvelles
  // sessions (sauf max), et peut demander de confirmer un changement en cours de discussion : la
  // notification dit « demandé », pas « réglé ».
  await $.command.run({ command: "effort", args: choice.effort });
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

// Durée de vie du cache de prompt : 1 h pour Claude Code (5 min en dépassement d'usage).
// Passé ce délai, le tour suivant repaie l'écriture de tout le contexte.
const TTL_MS = 60 * 60 * 1000;
// Par exemple « Réponse 1:23 ✓ · 48 tok/s · Cache 59:49 · 18:05 » au terminal,
// « Réponse 1:23 ✓ · 48 tok/s · Cache 59:49 » dans le bandeau desktop : libellés estompés,
// valeurs claires ; la coche dit que la requête est finie, « 2 en fond » qu'elle attend encore
// ses tâches de fond.

type FooterItem = { label?: string; value: string };

const SEPARATOR = " · ";

function footer(now: number, last: number | null, timer: ResponseTimer, speed: GenerationSpeed) {
  const items: FooterItem[] = [];
  if (timer) {
    const elapsed = duration((timer.endedAt ?? now) - timer.startedAt);
    items.push({ label: "Réponse", value: timer.endedAt === null ? elapsed : `${elapsed} ✓` });
    const waiting = timer.endedAt === null ? listsOf(timer).tasks.length : 0;
    if (waiting) items.push({ value: `${waiting} en fond` });
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
