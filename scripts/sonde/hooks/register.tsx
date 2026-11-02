// Sonde des événements du moteur : journalise ceux qui servent à suivre une requête (prompt,
// tours, appels, agents, arrêts et leurs tâches de fond, compactions, skills chargés, commandes, fin de
// session) dans `<SONDE_JOURNAUX>/<heure d'ouverture>.jsonl` (le dossier que `scripts/sonde.py` crée hors
// du dépôt ; à défaut, `journaux/` sous le dossier de la sonde), un fichier par processus,
// chaque ligne avec l'identifiant de session du moment. Jamais livrée : chargée par `--plugin-dir`
// (scripts/sonde.py). Mode d'emploi et résultats : docs/evenements-moteur.md.
//
// Elle porte aussi un déclencheur d'envoi : `/sonde-envoi [<s>] [--commande] <texte>` envoie le texte
// au nom du mod (sans `asUser`), par `$.prompt.submit` ou, avec `--commande`, par `$.command.run`,
// tout de suite ou après <s> secondes. Et les essais du COO de flow-board : `/sonde-envoyer-a` (un message à
// une autre discussion, `$.session.send`), `/sonde-compacte` (`$.session.compact`), et, réglés par
// l'environnement, une note ajoutée au contexte de chaque message (`SONDE_CONTEXTE`) et l'effort de chaque
// requête réécrit (`SONDE_EFFORT`).
//
// La sonde fait elle-même des `await` dans ses hooks : l'ordre qu'elle note entre deux événements
// très proches (moins d'une milliseconde) peut différer de celui d'un plugin sans attente.
const lines: string[] = [];
let t0 = 0;
// Le chemin du journal, posé au premier événement en même temps que t0 : une promesse, pour qu'aucun
// `await` ne sépare le test de t0 de l'affectation (un événement voisin écrirait sinon sans chemin).
let file: Promise<string> | null = null;

async function log($: any, ev: string, data: object) {
  const now = await $.clock.now();
  if (!t0) {
    t0 = now;
    // Le dossier des journaux : celui que `scripts/sonde.py` crée hors du dépôt (SONDE_JOURNAUX) ; sans
    // lui (la sonde chargée à la main), `journaux/` sous le dossier de la sonde, ignoré par git.
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    file = $.env.get("SONDE_JOURNAUX").then((dir: string | undefined) => `${dir || `${$.plugin.root}/journaux`}/${stamp}.jsonl`);
  }
  // Le chrono de session-tools tel qu'il est à cet instant (début relatif, fin posée ou non), s'il est installé.
  let chrono: unknown = null;
  try {
    const { value } = await $.state.get({ plugin: "session-tools", key: "responseTimer" });
    chrono = value ? { s: value.startedAt - t0, e: value.endedAt === null ? null : value.endedAt - t0 } : null;
  } catch {
    // session-tools absent
  }
  // L'identifiant de la session à cet instant : il dit si `/clear` en change.
  let sid: string | null = null;
  try {
    sid = await $.session.id();
  } catch {
    // pas d'identifiant
  }
  lines.push(JSON.stringify({ t: now - t0, at: new Date(now).toISOString().slice(11, 23), ev, sid, chrono, ...data }));
  await $.fs.write(await file!, lines.join("\n") + "\n");
}

async function logClassic($: any, name: string, e: any) {
  let agents: unknown = null;
  try {
    agents = (await $.agent.list()).map((a: any) => ({ id: a.id, status: a.status, parentId: a.parentId }));
  } catch {
    // pas de liste
  }
  await log($, name, {
    agent_id: e.agent_id,
    effort: e.effort,
    hasBg: "background_tasks" in e,
    background_tasks: e.background_tasks?.map((t: any) => ({ id: t.id, type: t.type, status: t.status, d: String(t.description).slice(0, 30) })),
    crons: e.session_crons?.length,
    agents,
  });
}

const ENVOI = "sonde-envoi";
// Les minuteries d'envoi programmées (`$.clock.after` rend une minuterie, pas une promesse).
const timers: unknown[] = [];

export type Envoi = { delayS: number; viaCommand: boolean; text: string };

// `[<secondes>] [--commande] <texte>` : le délai (0 sans nombre en tête), la voie (`$.command.run` avec
// `--commande`, sinon `$.prompt.submit`) et le texte à envoyer.
export function parseEnvoi(args: string): Envoi {
  let rest = args.trim();
  let delayS = 0;
  const m = /^(\d+(?:\.\d+)?)\s+(\S[\s\S]*)$/.exec(rest);
  if (m) {
    delayS = Number(m[1]);
    rest = m[2] ?? "";
  }
  const viaCommand = /^--commande(\s|$)/.test(rest);
  if (viaCommand) rest = rest.slice("--commande".length).trim();
  return { delayS, viaCommand, text: rest };
}

// `/nom arguments` en ce que prend `$.command.run` ; le nom sans sa barre.
export function splitCommand(text: string): { command: string; args: string } {
  const m = /^\/?(\S+)\s*([\s\S]*)$/.exec(text.trim());
  return { command: m?.[1] ?? "", args: m?.[2] ?? "" };
}

// L'envoi au nom du mod, sans `asUser`, et ce que le moteur en a fait (entré, mis en file, retiré, refusé).
async function submit($: any, envoi: Envoi) {
  await log($, "envoi", { viaCommand: envoi.viaCommand, text: short(envoi.text) });
  try {
    if (envoi.viaCommand) {
      const r = await $.command.run(splitCommand(envoi.text));
      await log($, "envoi:résultat", { text: short(r?.text), context: r?.context?.length });
    } else {
      const r = await $.prompt.submit({ text: envoi.text });
      await log($, "envoi:résultat", { drop: r?.drop, text: short(r?.text), origin: r?.origin });
    }
  } catch (err) {
    await log($, "envoi:erreur", { error: String(err).slice(0, 300) });
  }
}

function short(s: unknown) {
  return typeof s === "string" ? s.slice(0, 60) : s;
}

// Les essais du COO, réglés par l'environnement (`scripts/sonde.py --env`) : `SONDE_CONTEXTE` ajoute une
// note au contexte de chaque message (le modèle la lit-il au tour même ?), `SONDE_EFFORT` réécrit
// l'effort de chaque requête du fil principal (`turn.step`). Lus une fois par processus.
type Essais = { contexte?: string; effort?: string };
let essais: Promise<Essais> | null = null;
function essaisOf($: any): Promise<Essais> {
  if (!essais) {
    essais = Promise.all([$.env.get("SONDE_CONTEXTE"), $.env.get("SONDE_EFFORT")]).then(([contexte, effort]: (string | undefined)[]) => ({
      contexte: contexte || undefined,
      effort: effort || undefined,
    }));
  }
  return essais;
}

// Un id de session (le nom du transcript) : un UUID ; tout autre premier mot est un nom, tel que
// l'outil SendMessage l'écrit (ListAgents).
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEnvoiA(args: string): { to: string | { sessionId: string }; text: string } {
  const m = /^(\S+)\s+([\s\S]+)$/.exec(args.trim());
  if (!m) return { to: "", text: "" };
  const head = m[1] ?? "";
  return { to: SESSION_ID.test(head) ? { sessionId: head } : head, text: (m[2] ?? "").trim() };
}

const ENVOI_A = "sonde-envoyer-a";
const COMPACTE = "sonde-compacte";

// La compaction lancée par le mod (`$.session.compact`), et ce que le moteur en a fait.
async function compacte($: any, instructions: string) {
  await log($, "compacte", { instructions: short(instructions) });
  try {
    const r = await $.session.compact(instructions ? { instructions } : {});
    await log($, "compacte:résultat", { skip: r?.skip, messages: r?.messages?.length, tokensBefore: r?.tokensBefore, tokensAfter: r?.tokensAfter });
  } catch (err) {
    await log($, "compacte:erreur", { error: String(err).slice(0, 300) });
  }
}

// Le remplissage du contexte tel que le mod le lit (`$.session.usage()`).
async function logUsage($: any, ev: string) {
  try {
    const u = await $.session.usage();
    await log($, ev, { tokens: u?.context?.tokens, window: u?.context?.window, percent: u?.context?.percent });
  } catch (err) {
    await log($, `${ev}:erreur`, { error: String(err).slice(0, 300) });
  }
}

export const register = (on: any) => {
  on("prompt.submit", async ($: any, e: any, next: any) => {
    await log($, "prompt.submit", { origin: e.origin, turnId: e.turnId, command: e.command, isMeta: e.isMeta, text: short(e.text), context: e.context?.length });
    // Essai 1 : une note ajoutée au contexte d'un message (pas d'une commande), que le modèle doit lire.
    const { contexte } = await essaisOf($);
    const sent = contexte && !e.command ? { ...e, context: [...(e.context ?? []), `Note de la sonde : le mot du jour est « ${contexte} ».`] } : e;
    if (sent !== e) await log($, "contexte:ajouté", { mot: contexte });
    const r = await next(sent);
    await log($, "prompt.submit:after", { turnId: e.turnId, drop: r?.drop, text: short(r?.text), context: r?.context?.length });
    return r;
  });
  on("turn.start", async ($: any, e: any, next: any) => {
    await log($, "turn.start", { turnId: e.turnId, agentId: e.agentId, text: short(e.text) });
    return next(e);
  });
  on("turn.step", async function* ($: any, e: any, next: any) {
    await log($, "turn.step", { turnId: e.turnId, agentId: e.agentId, index: e.index, model: e.model, effort: e.effort });
    // Essai 2 : l'effort de la requête du fil principal réécrit ; la réponse dit s'il a pris (réflexion, tokens).
    const { effort } = await essaisOf($);
    const asked = effort && e.agentId === undefined ? { ...e, effort } : e;
    if (asked !== e) await log($, "effort:réécrit", { de: e.effort, vers: effort, index: e.index });
    const stream = next(asked);
    let first = false;
    let thinking = 0;
    for await (const chunk of stream) {
      if (!first) {
        first = true;
        await log($, "turn.step:first", { agentId: e.agentId, index: e.index });
      }
      if (chunk.kind === "thinking") thinking += String(chunk.text ?? "").length;
      if (chunk.kind === "stop") await log($, "turn.step:stop", { agentId: e.agentId, index: e.index, out: chunk.usage?.output_tokens, model: chunk.usage?.model, thinking });
      yield chunk;
    }
    return await stream.result;
  });
  on("turn.complete", async ($: any, e: any, next: any) => {
    await log($, "turn.complete", { turnId: e.turnId, agentId: e.agentId, reason: e.reason, durationMs: e.durationMs, isAborted: e.isAborted, hasUsage: !!e.usage });
    const r = await next(e);
    // Essai 6 : le remplissage du contexte, lu par le mod à la fin de chaque tour du fil principal.
    if (e.agentId === undefined) await logUsage($, "session.usage");
    return r;
  });
  // Essai 4 : l'effort actif tel qu'un hook le lit (`effort.level`), après chaque appel d'outil
  // (`classic.PreToolUse` reçoit l'enveloppe de l'appel, sans `effort`).
  on("classic.PostToolUse", async ($: any, e: any, next: any) => {
    await log($, "classic.PostToolUse", { tool: e.tool_name, effort: e.effort });
    return next(e);
  });
  // Essai 3 : le message d'une autre discussion, tel qu'il arrive.
  on("session.receive", async ($: any, e: any, next: any) => {
    await log($, "session.receive", { origin: e.origin, agentId: e.agentId, text: short(e.text) });
    return next(e);
  });
  on("agent.spawn", async ($: any, e: any, next: any) => {
    const r = await next(e);
    await log($, "agent.spawn", { background: e.background, parentAgentId: e.parentAgentId, subagentType: e.subagentType, agentId: r?.agentId });
    return r;
  });
  on("classic.Stop", async ($: any, e: any, next: any) => {
    await logClassic($, "classic.Stop", e);
    return next(e);
  });
  on("classic.SubagentStop", async ($: any, e: any, next: any) => {
    await logClassic($, "classic.SubagentStop", e);
    return next(e);
  });
  on("classic.SubagentStart", async ($: any, e: any, next: any) => {
    await logClassic($, "classic.SubagentStart", e);
    return next(e);
  });
  // L'ordre de `session.start` et de `classic.SessionStart` (démarrage, reprise, /clear).
  on("session.start", async ($: any, e: any, next: any) => {
    await log($, "session.start", { cwd: short(e.cwd), surface: e.surface });
    await $.command.register({ name: ENVOI, description: "Sonde : envoie un texte par $.prompt.submit (par $.command.run avec --commande), après <s> secondes" });
    await $.command.register({ name: ENVOI_A, description: "Sonde : envoie un texte à une autre discussion par $.session.send (<id de session ou nom> <texte>)" });
    await $.command.register({ name: COMPACTE, description: "Sonde : compacte la discussion par $.session.compact après <s> secondes ([<s>] <consignes>)" });
    // Essai 6 : le remplissage du contexte au démarrage (avant la première réponse : absent).
    await logUsage($, "session.usage");
    return next(e);
  });
  // Essai 3 : un message à une autre discussion, par son id de session ou par un nom.
  on("command.run", { command: ENVOI_A }, async ($: any, e: any) => {
    const { to, text } = parseEnvoiA(e.args);
    if (!text) return { text: `usage : /${ENVOI_A} <id de session ou nom> <texte>` };
    await log($, "envoi-a", { to, text: short(text) });
    try {
      const r = await $.session.send({ to, text });
      await log($, "envoi-a:résultat", { isDelivered: r?.isDelivered, reason: r?.reason });
      return { text: `sonde : envoi à ${JSON.stringify(to)} : ${r?.isDelivered ? "livré" : `refusé (${r?.reason})`}` };
    } catch (err) {
      await log($, "envoi-a:erreur", { error: String(err).slice(0, 300) });
      return { text: `sonde : envoi à ${JSON.stringify(to)} en erreur : ${String(err).slice(0, 200)}` };
    }
  });
  // Essais 5 et 7 : une compaction lancée par le mod, au repos (après <s> secondes), et ce qui la suit.
  on("command.run", { command: COMPACTE }, async ($: any, e: any) => {
    const { delayS, text } = parseEnvoi(e.args);
    await log($, "compacte:programmé", { delayS, instructions: short(text) });
    timers.push($.clock.after(delayS * 1000, () => void compacte($, text)));
    return { text: `sonde : compaction par $.session.compact dans ${delayS} s` };
  });
  // `/clear` finit la session (`reason: "clear"`) : l'identifiant d'après se lit sur les lignes suivantes.
  on("session.end", async ($: any, e: any, next: any) => {
    await log($, "session.end", { reason: e.reason, sessionId: e.sessionId });
    return next(e);
  });
  // Le déclencheur d'envoi. Pour tomber en plein tour : un délai, puis un tour long lancé aussitôt.
  on("command.run", { command: ENVOI }, async ($: any, e: any) => {
    const envoi = parseEnvoi(e.args);
    if (!envoi.text) return { text: `usage : /${ENVOI} [<secondes>] [--commande] <texte>` };
    await log($, "envoi:programmé", { delayS: envoi.delayS, viaCommand: envoi.viaCommand, text: short(envoi.text) });
    timers.push($.clock.after(envoi.delayS * 1000, () => void submit($, envoi)));
    return { text: `sonde : « ${short(envoi.text)} » part dans ${envoi.delayS} s par ${envoi.viaCommand ? "$.command.run" : "$.prompt.submit"}` };
  });
  on("command.run", async ($: any, e: any, next: any) => {
    await log($, "command.run", { command: e.command, args: short(e.args), origin: e.origin });
    return next(e);
  });
  // Le skill chargé, et s'il est réservé à l'utilisateur.
  on("skill.prompt", async ($: any, e: any, next: any) => {
    await log($, "skill.prompt", {
      skill: e.skill,
      pluginName: e.pluginName,
      source: e.source,
      disableModelInvocation: e.frontmatter?.["disable-model-invocation"] ?? null,
      text: short(e.text),
    });
    return next(e);
  });
  on("classic.SessionStart", async ($: any, e: any, next: any) => {
    await log($, "classic.SessionStart", { source: e.source, session_title: short(e.session_title) });
    return titled($, "classic.SessionStart", await next(e));
  });
  // Mode titre (`sonde.py --titre`) : le titre du fichier `titre.txt` de la sonde part dans
  // `sessionTitle` du prochain message ; `session_title` du hook suivant dit s'il a pris.
  on("classic.UserPromptSubmit", async ($: any, e: any, next: any) => {
    await log($, "classic.UserPromptSubmit", { session_title: short(e.session_title) });
    return titled($, "classic.UserPromptSubmit", await next(e));
  });
  // La compaction : son déclencheur (tapée, au seuil, calculée à l'avance), et si une compaction
  // automatique qui réutilise un résumé calculé à l'avance repasse par l'événement.
  on("session.compact", async ($: any, e: any, next: any) => {
    await log($, "session.compact", { trigger: e.trigger, agentId: e.agentId, instructions: short(e.instructions), messages: e.messages?.length });
    const r = await next(e);
    await log($, "session.compact:after", { trigger: e.trigger, skip: r?.skip, messages: r?.messages?.length, tokensBefore: r?.tokensBefore, tokensAfter: r?.tokensAfter, usage: r?.usage ? true : false });
    return r;
  });
};

/** Le titre que la sonde doit renvoyer, lu une fois dans `titre.txt` (écrit par `sonde.py --titre`). */
let pendingTitle: string | null | undefined;
async function titled($: any, ev: string, result: any) {
  if (pendingTitle === undefined) {
    try {
      pendingTitle = String(await $.fs.read(`${$.plugin.root}/titre.txt`)).trim() || null;
    } catch {
      pendingTitle = null;
    }
  }
  if (!pendingTitle) return result;
  const title = pendingTitle;
  pendingTitle = null;
  await log($, `${ev}:sessionTitle`, { title });
  return { ...result, sessionTitle: title };
}
