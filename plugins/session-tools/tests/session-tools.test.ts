import { describe, expect, mock, test } from "claude-code/testing";

// Les minuteries de l'hôte des tests, que les types du moteur (sans `dom` ni `node`) ne déclarent pas.
declare const setTimeout: (callback: (value?: unknown) => void, ms: number) => unknown;

// Sous le plugin : le moteur dessine les libellés du pied et laisse le bandeau vide (le mod
// dessine les siens lui-même).
const engineDraws = (on: any) =>
  on("ui.render", ($: any, e: any) => {
    if (e.component === "AbovePrompt") return { type: "engine", ref: 0 };
    const { Text } = $.ui.resolve(e);
    return Text({ children: e.props.modes.join(" & ") });
  });

// Chrono, tokens/s et cache : dans le pied au terminal, dans le bandeau au-dessus du prompt sur desktop.
const mountValues = ($: any, surface: "terminal" | "desktop") =>
  $.ui.mount(
    surface === "desktop"
      ? {
          plugin: "session-tools",
          surface,
          component: "AbovePrompt",
          props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
        }
      : { plugin: "session-tools", surface, component: "SessionMode", props: { modes: [] } },
  );

describe("session-tools", () => {
  for (const surface of ["terminal", "desktop"] as const) {
    test(`cache et heure dans le pied du prompt (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      on("session.usage", () => ({
        value: {
          startedAt: 0,
          context: { tokens: 0, window: 200_000, percent: 0 },
          rateLimits: [{ kind: "five_hour", percentUsed: 42 }],
        },
      }));
      on("turn.step", async function* ($, e) {
        return { turnId: e.turnId, index: e.index, answer: "ok", toolUses: [], stopReason: "end_turn", usage: null } as any;
      });
      engineDraws(on);
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);

      const ui = await mountValues($, surface);
      // Avant la première requête : l'heure seule ; l'usage n'est jamais affiché.
      expect(await ui.find({ type: "Text", text: /42%/ })).toBeUndefined();
      // L'heure s'affiche au terminal ; sur desktop, la place manque.
      if (surface === "terminal") expect(await ui.find({ type: "Text", text: /^\d\d:\d\d$/ })).toBeDefined();
      else expect(await ui.find({ type: "Text", text: /^\d\d:\d\d$/ })).toBeUndefined();
      expect(await ui.find({ type: "Text", text: /^Cache/ })).toBeUndefined();

      for await (const _ of $.turn.step({ turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 } as any)) {
        // la réponse du modèle, sans intérêt ici
      }
      await clock.advance(11_000);
      expect(await ui.find({ type: "Text", text: /^Cache/ })).toBeDefined();
      expect(await ui.find({ type: "Text", text: "59:49" })).toBeDefined();

      await clock.advance(60 * 60 * 1000);
      expect(await ui.find({ type: "Text", text: "expiré" })).toBeDefined();
      if (surface === "desktop") {
        // Le pied desktop, trop étroit, ne garde que les boutons : les valeurs sont dans le bandeau.
        const footer = await $.ui.mount({ plugin: "session-tools", surface, component: "SessionMode", props: { modes: [] } } as any);
        expect(await footer.find({ type: "Text", text: /^Cache/ })).toBeUndefined();
        expect(await footer.find({ key: "effort" })).toBeDefined();
      }
    });
  }

  for (const surface of ["terminal", "desktop"] as const) {
    test(`les boutons Fichiers et Diff, au terminal seulement (${surface})`, async ($, on) => {
      const runs: string[] = [];
      const toasts: string[] = [];
      mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      engineDraws(on);
      on("ui.toast", ($, e: any) => {
        toasts.push(e.text);
        return { value: undefined } as any;
      });
      // Sous le plugin : /diff (intégrée) et /files-board:files (du mod files-board).
      on("command.run", { command: "diff" }, ($, e) => {
        runs.push(`/diff ${e.args}`.trim());
        return {};
      });
      on("command.run", { command: "files-board:files" }, ($, e) => {
        runs.push(`/files-board:files ${e.args}`);
        return {};
      });
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
      const ui = await $.ui.mount({ plugin: "session-tools", surface, component: "SessionMode", props: { modes: [] } } as any);
      if (surface === "desktop") {
        expect(await ui.find({ key: "files" })).toBeUndefined();
        expect(await ui.find({ key: "diff" })).toBeUndefined();
        return;
      }
      expect((await ui.find({ key: "files" }))?.text).toBe("Fichiers");
      expect((await ui.find({ key: "diff" }))?.text).toBe("Diff");
      await ui.press({ key: "files" });
      await ui.press({ key: "diff" });
      await ui.press({ key: "diff" });
      expect(runs).toEqual(["/files-board:files toggle", "/diff", "/diff"]);
      expect(toasts).toEqual([]);
    });
  }

  // Sous le plugin : le champ de saisie (`drafts` : ce que chaque lecture y trouve, la dernière
  // se répète), le modèle et les notifications.
  const rewriteSetup = (on: any, drafts: string[], reply = "  Prompt réécrit.\n", during = async () => {}) => {
    const calls = { requests: [] as any[], fills: [] as any[], toasts: [] as string[] };
    let reads = 0;
    on("prompt.read", () => ({ value: { text: drafts[Math.min(reads++, drafts.length - 1)], cursor: 0 } }));
    on("prompt.fill", ($: any, e: any) => {
      calls.fills.push({ text: e.text, mode: e.mode });
      return { isFilled: true };
    });
    on("ui.toast", ($: any, e: any) => {
      calls.toasts.push(e.text);
      return { value: undefined };
    });
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    on("model.complete", async ($: any, e: any) => {
      calls.requests.push(e);
      await during();
      return { value: { isAnswered: true, text: reply, usage } };
    });
    return calls;
  };

  for (const surface of ["terminal", "desktop"] as const) {
    test(`Réécrire : le brouillon réécrit par Opus low remplace le champ, sans envoi (${surface})`, async ($, on) => {
      mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      engineDraws(on);
      const calls = rewriteSetup(on, ["fais un logo plus moderne"]);
      let submitted = false;
      on("prompt.submit", () => {
        submitted = true;
        return { text: "" };
      });
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
      const ui = await $.ui.mount({ plugin: "session-tools", surface, component: "SessionMode", props: { modes: [] } } as any);
      expect((await ui.find({ key: "rewrite" }))?.text).toBe("Réécrire");

      await ui.press({ key: "rewrite" });
      expect(calls.requests).toHaveLength(1);
      const [request] = calls.requests;
      expect(request.model).toBe("opus");
      expect(request.effort).toBe("low");
      expect(request.maxTokens).toBe(4000);
      expect(request.system).toMatch(/^# Réécrire un brouillon de prompt/);
      expect(request.prompt).toBe("<brouillon>\nfais un logo plus moderne\n</brouillon>");
      expect(calls.fills).toEqual([{ text: "Prompt réécrit.", mode: "replace" }]);
      expect(calls.toasts).toEqual([]);
      expect(submitted).toBe(false);
      expect((await ui.find({ key: "rewrite" }))?.text).toBe("Réécrire");
    });
  }

  test("Réécrire : le bouton dit « Réécriture… » pendant l'appel au modèle", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    // Le modèle répond quand le test le décide : le bouton est relu pendant l'attente.
    let answer = () => {};
    const replied = new Promise<void>((resolve) => (answer = resolve));
    const calls = rewriteSetup(on, ["brouillon"], "ok", () => replied);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    // L'attente ne vient pas du moteur : l'appui rend la main sans attendre la réponse.
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    };
    await ui.press({ key: "rewrite" });
    await until(() => calls.requests.length > 0);
    expect((await ui.find({ key: "rewrite" }))?.text).toBe("Réécriture…");
    answer();
    await until(() => calls.fills.length > 0);
    expect(calls.fills).toEqual([{ text: "ok", mode: "replace" }]);
    expect((await ui.find({ key: "rewrite" }))?.text).toBe("Réécrire");
  });

  test("Réécrire : un double clic ne lance qu'un appel au modèle", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    let answer = () => {};
    const replied = new Promise<void>((resolve) => (answer = resolve));
    const calls = rewriteSetup(on, ["brouillon"], "ok", () => replied);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
    };
    await Promise.all([ui.press({ key: "rewrite" }), ui.press({ key: "rewrite" })]);
    await until(() => calls.requests.length > 0);
    await ui.press({ key: "rewrite" });
    answer();
    await until(() => calls.fills.length > 0);
    expect(calls.requests).toHaveLength(1);
    expect(calls.fills).toEqual([{ text: "ok", mode: "replace" }]);
    expect(calls.toasts).toEqual([]);
  });

  test("Réécrire : une réponse vide laisse le brouillon", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["brouillon"], " \n ");
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    expect(calls.fills).toEqual([]);
    expect(calls.toasts).toEqual(["Réécrire : réponse vide, le brouillon est laissé tel quel."]);
  });

  test("Réécrire : un brouillon modifié pendant la réécriture n'est pas écrasé", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["brouillon", "brouillon complété entre-temps"]);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    expect(calls.requests).toHaveLength(1);
    expect(calls.fills).toEqual([]);
    expect(calls.toasts).toEqual(["Réécrire : le brouillon a changé pendant la réécriture, il est laissé tel quel."]);
  });

  test("Réécrire : un champ vide ne lance pas le modèle", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["   "]);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    expect(calls.requests).toEqual([]);
    expect(calls.fills).toEqual([]);
    expect(calls.toasts).toEqual(["Réécrire : le champ de saisie est vide."]);
  });

  test("Réécrire : une commande slash reste en tête, seul le texte qui la suit est réécrit", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["/mattpocock-skills:grilling sur les notif\nhors ligne surtout"], "Les notifications, hors ligne surtout.");
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    expect(calls.requests[0].prompt).toBe(
      "<commande>/mattpocock-skills:grilling</commande>\n<brouillon>\nsur les notif\nhors ligne surtout\n</brouillon>",
    );
    expect(calls.fills).toEqual([{ text: "/mattpocock-skills:grilling Les notifications, hors ligne surtout.", mode: "replace" }]);
  });

  test("Réécrire : une réponse qui recopie la commande ne la double pas", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["/implement le groupe A stp"], "/implement Le groupe A.");
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    expect(calls.fills).toEqual([{ text: "/implement Le groupe A.", mode: "replace" }]);
  });

  test("Réécrire : une commande seule ne lance pas le modèle", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["  /flow-board:compte-rendu  "]);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    expect(calls.requests).toEqual([]);
    expect(calls.fills).toEqual([]);
    expect(calls.toasts).toEqual(["Réécrire : une commande seule, laissée telle quelle."]);
  });

  test("Réécrire : un chemin en tête n'est pas une commande", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["/Users/moi/notes.md explique ce fichier"]);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    expect(calls.requests[0].prompt).toBe("<brouillon>\n/Users/moi/notes.md explique ce fichier\n</brouillon>");
    expect(calls.fills).toEqual([{ text: "Prompt réécrit.", mode: "replace" }]);
  });

  // Sous le plugin : la commande /effort intégrée, qui ne renvoie aucun texte en interactif.
  const effortRuns = (on: any) => {
    const runs: string[] = [];
    on("command.run", { command: "effort" }, ($: any, e: any) => {
      runs.push(e.args);
      return {};
    });
    return runs;
  };

  for (const surface of ["terminal", "desktop"] as const) {
    test(`Effort auto : Opus low choisit le niveau du brouillon, réglé par /effort (${surface})`, async ($, on) => {
      mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      engineDraws(on);
      const calls = rewriteSetup(on, ["corrige le bug de reconnexion en prod"], 'Voici : {"effort": "high", "raison": "Bug en production, cas limites."}');
      const runs = effortRuns(on);
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
      const ui = await $.ui.mount({ plugin: "session-tools", surface, component: "SessionMode", props: { modes: [] } } as any);
      expect((await ui.find({ key: "effort" }))?.text).toBe("Effort auto");

      await ui.press({ key: "effort" });
      const [request] = calls.requests;
      expect(request.model).toBe("opus");
      expect(request.effort).toBe("low");
      expect(request.system).toMatch(/^# Choisir le niveau d'effort d'un brouillon/);
      expect(request.prompt).toBe("<brouillon>\ncorrige le bug de reconnexion en prod\n</brouillon>");
      expect(runs).toEqual(["high"]);
      expect(calls.toasts).toEqual(["Effort demandé : high (Bug en production, cas limites.)"]);
      // Le brouillon reste tel quel.
      expect(calls.fills).toEqual([]);
      expect((await ui.find({ key: "effort" }))?.text).toBe("Effort auto");
    });
  }

  test("l'option model choisit le modèle des deux boutons, toujours en effort low", { options: { model: "haiku" } }, async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["brouillon"], '{"effort": "medium", "raison": "Simple."}');
    effortRuns(on);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "rewrite" });
    await ui.press({ key: "effort" });
    expect(calls.requests.map((r: any) => [r.model, r.effort])).toEqual([
      ["haiku", "low"],
      ["haiku", "low"],
    ]);
  });

  test("Effort auto : une réponse illisible laisse l'effort tel quel", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["brouillon"], '{"effort": "énorme", "raison": "?"}');
    const runs = effortRuns(on);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "effort" });
    expect(runs).toEqual([]);
    expect(calls.toasts).toEqual(["Effort auto : réponse illisible, l'effort est laissé tel quel."]);
  });

  test("Effort auto : un brouillon envoyé ou changé pendant le choix garde l'effort", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["brouillon", ""], '{"effort": "xhigh", "raison": "Long."}');
    const runs = effortRuns(on);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "effort" });
    expect(runs).toEqual([]);
    expect(calls.toasts).toEqual(["Effort auto : le brouillon a changé pendant le choix, l'effort est laissé tel quel."]);
  });

  test("Effort auto : un niveau sans raison est quand même réglé", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, ["brouillon"], '{"effort": "low"}');
    const runs = effortRuns(on);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "effort" });
    expect(runs).toEqual(["low"]);
    expect(calls.toasts).toEqual(["Effort demandé : low"]);
  });

  test("Effort auto : un champ vide ne lance pas le modèle", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    engineDraws(on);
    const calls = rewriteSetup(on, [""]);
    const runs = effortRuns(on);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({ plugin: "session-tools", surface: "terminal", component: "SessionMode", props: { modes: [] } } as any);
    await ui.press({ key: "effort" });
    expect(calls.requests).toEqual([]);
    expect(runs).toEqual([]);
    expect(calls.toasts).toEqual(["Effort auto : le champ de saisie est vide."]);
  });

  for (const surface of ["terminal", "desktop"] as const) {
    test(`chrono de réponse : de l'envoi du message à la fin du tour (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      engineDraws(on);
      on("prompt.submit", (_, e: any) => ({ text: e.text }));
      on("turn.start", ($, e: any) => ({ turnId: e.turnId }));
      on("turn.complete", () => ({ text: "" }));
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
      const ui = await mountValues($, surface);
      // Le moteur tel qu'observé (docs/evenements-moteur.md) : un prompt reçu au repos rend la main,
      // puis son tour démarre avec le même texte ; envoyé pendant un tour (`turnId`), il le rejoint.
      let turns = 0;
      const submit = async (text: string, origin: object, extra: { turnId?: string } = {}) => {
        await $.prompt.submit({ text, wait: false, origin, ...extra } as any);
        if (!extra.turnId) await $.turn.start({ text, turnId: `t${++turns}` } as any);
      };
      const send = (text: string, extra: { turnId?: string } = {}) => submit(text, { kind: surface === "terminal" ? "composer" : "sdk" }, extra);
      const complete = (turnId: string, extra: object = {}) =>
        $.turn.complete({ answer: "", durationMs: 1, turnId, reason: "answer", ...extra } as any);

      // Rien avant le premier message.
      expect(await ui.find({ type: "Text", text: /^Réponse/ })).toBeUndefined();

      await send("bonjour");
      await clock.advance(5_000);
      expect(await ui.find({ type: "Text", text: "0:05" })).toBeDefined();
      // Le début du tour d'un sous-agent ne remet pas le chrono à zéro.
      await $.turn.start({ text: "explore le code", turnId: "t1", agentId: "a1" } as any);
      await clock.advance(1_000);
      expect(await ui.find({ type: "Text", text: "0:06" })).toBeDefined();
      // La fin du tour d'un sous-agent n'arrête pas le chrono.
      await complete("t1", { agentId: "a1" });
      await clock.advance(79_000);
      expect(await ui.find({ type: "Text", text: "1:25" })).toBeDefined();
      await complete("t1");
      await clock.advance(30_000);
      expect(await ui.find({ type: "Text", text: "1:25 ✓" })).toBeDefined();

      // Un tour lancé par une notification sans tâche reconnue (pas de `<task-id>`) ne touche pas au
      // chrono ; la reprise par la notification d'une tâche de la requête est testée plus bas.
      await submit("tâche finie", { kind: "task-notification" });
      await clock.advance(2_000);
      expect(await ui.find({ type: "Text", text: "1:25 ✓" })).toBeDefined();
      // Un sous-agent de fond qui démarre au repos non plus.
      await $.turn.start({ text: "vérifie les tests", turnId: "t2", agentId: "a2" } as any);
      await clock.advance(2_000);
      expect(await ui.find({ type: "Text", text: "1:25 ✓" })).toBeDefined();
      await complete("t2");

      // Un nouveau message remet le chrono à zéro.
      await send("encore");
      await clock.advance(3_000);
      expect(await ui.find({ type: "Text", text: "0:03" })).toBeDefined();
      // Un message envoyé pendant la réponse rejoint le tour en cours et relance le chrono.
      await send("précision", { turnId: "t3" });
      await clock.advance(1_000);
      expect(await ui.find({ type: "Text", text: "0:01" })).toBeDefined();
      // Une interruption arrête aussi le chrono.
      await complete("t3", { reason: "aborted" });
      await clock.advance(3_600_000);
      expect(await ui.find({ type: "Text", text: "0:01 ✓" })).toBeDefined();
    });
  }

  // Le moteur tel que docs/evenements-moteur.md le décrit (essai du 26/10/2026, 2.1.310 et 2.1.308) : `prompt.submit` rend la
  // main avant le `turn.start` de son tour, `classic.Stop` précède `turn.complete` avec la liste à jour
  // des tâches de fond, et une interruption n'a pas de `classic.Stop`.
  const realEngine = async ($: any, on: any, surface: "terminal" | "desktop") => {
    const clock = mock.clock(on, { now: 1_000_000 });
    let agents: any[] = [];
    on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
    engineDraws(on);
    on("prompt.submit", (_: any, e: any) => ({ text: e.text }));
    on("turn.start", (_: any, e: any) => ({ turnId: e.turnId }));
    on("turn.complete", () => ({ text: "" }));
    on("classic.Stop", () => ({}));
    on("classic.SubagentStop", () => ({}));
    on("agent.list", () => ({ value: agents }));
    await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
    const ui = await mountValues($, surface);
    let turns = 0;
    // Un prompt reçu au repos, puis le tour qu'il démarre (même texte).
    const relaunch = async (text: string, origin: object) => {
      await $.prompt.submit({ text, wait: false, origin } as any);
      const turnId = `t${++turns}`;
      await $.turn.start({ text, turnId } as any);
      return turnId;
    };
    const engine = {
      clock,
      ui,
      shows: async (text: string | RegExp) => (await ui.find({ type: "Text", text })) !== undefined,
      send: (text: string) => relaunch(text, { kind: surface === "terminal" ? "composer" : "sdk" }),
      // La notification de fin d'une commande shell de fond, et le message de retour d'un sous-agent.
      shellDone: (id: string) => relaunch(`<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>`, { kind: "task-notification" }),
      agentDone: (id: string) => relaunch(`<agent-message from="${id}">\n[Subagent hand-back] OK`, { kind: "peer" }),
      // Fin normale d'un tour du fil principal : la liste des tâches de fond, puis la fin du tour.
      finish: async (turnId: string, tasks: { id: string; type: string }[]) => {
        await $.classic.Stop({ stop_hook_active: false, background_tasks: tasks.map((t) => ({ ...t, status: "running", description: t.id })) } as any);
        await $.turn.complete({ answer: "", durationMs: 1, turnId, reason: "answer" } as any);
      },
      setAgents: (list: any[]) => {
        agents = list;
      },
    };
    return engine;
  };

  for (const surface of ["terminal", "desktop"] as const) {
    test(`chrono : le retour d'une tâche de fond ne le remet pas à zéro (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un shell de fond");
      await engine.clock.advance(6_000);
      await engine.finish(t1, [{ id: "b1", type: "shell" }]);
      await engine.clock.advance(14_000);
      const t2 = await engine.shellDone("b1");
      await engine.clock.advance(2_000);
      expect(await engine.shows(/^0:0/)).toBe(false);
      expect(await engine.shows("0:22")).toBe(true);
      await engine.finish(t2, []);
      await engine.clock.advance(30_000);
      expect(await engine.shows("0:22 ✓")).toBe(true);
    });
  }

  for (const surface of ["terminal", "desktop"] as const) {
    test(`chrono : il attend les tâches de fond de la requête et les compte (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un sous-agent et un shell de fond");
      await engine.clock.advance(5_000);
      await engine.finish(t1, [
        { id: "a1", type: "subagent" },
        { id: "b1", type: "shell" },
      ]);
      await engine.clock.advance(10_000);
      // Le fil principal a fini : le chrono court, avec ses deux tâches.
      expect(await engine.shows("0:15")).toBe(true);
      expect(await engine.shows("2 en fond")).toBe(true);
      const t2 = await engine.agentDone("a1");
      await engine.clock.advance(2_000);
      await engine.finish(t2, [{ id: "b1", type: "shell" }]);
      expect(await engine.shows("1 en fond")).toBe(true);
      await engine.clock.advance(8_000);
      const t3 = await engine.shellDone("b1");
      await engine.clock.advance(2_000);
      await engine.finish(t3, []);
      await engine.clock.advance(60_000);
      expect(await engine.shows("0:27 ✓")).toBe(true);
      expect(await engine.shows(/en fond/)).toBe(false);
    });

    test(`chrono : un sous-agent peut aussi revenir par une task-notification (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un sous-agent de fond");
      await engine.clock.advance(3_000);
      await engine.finish(t1, [{ id: "a1", type: "subagent" }]);
      await engine.clock.advance(20_000);
      // Essai du 26/10/2026 : `<task-id>` porte alors l'identifiant de l'agent.
      const t2 = await engine.shellDone("a1");
      await engine.clock.advance(2_000);
      await engine.finish(t2, []);
      expect(await engine.shows("0:25 ✓")).toBe(true);
    });

    test(`chrono : le retour d'un sous-agent déjà sorti de la liste prolonge sa requête (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un sous-agent de fond");
      await engine.clock.advance(2_000);
      await engine.finish(t1, [{ id: "a1", type: "subagent" }]);
      await engine.clock.advance(10_000);
      // Essai du 26/10/2026 : le même agent annonce sa fin, puis envoie son message de retour.
      const t2 = await engine.shellDone("a1");
      await engine.clock.advance(1_000);
      await engine.finish(t2, []);
      expect(await engine.shows("0:13 ✓")).toBe(true);
      await engine.clock.advance(2_000);
      const t3 = await engine.agentDone("a1");
      await engine.clock.advance(1_000);
      expect(await engine.shows("0:16")).toBe(true);
      await engine.finish(t3, []);
      expect(await engine.shows("0:16 ✓")).toBe(true);
    });

    test(`chrono : il part à l'heure d'envoi, pas au début du tour (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      await $.prompt.submit({ text: "bonjour", wait: false, origin: { kind: surface === "terminal" ? "composer" : "sdk" } } as any);
      await engine.clock.advance(2_000);
      await $.turn.start({ text: "bonjour", turnId: "t1" } as any);
      await engine.clock.advance(1_000);
      expect(await engine.shows("0:03")).toBe(true);
    });

    test(`chrono : une tâche apparue après la fin d'une requête ne la rouvre pas (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("bonjour");
      await engine.clock.advance(2_000);
      await engine.finish(t1, []);
      // Une tâche planifiée lance un shell de fond, après la fin de la requête.
      await $.prompt.submit({ text: "tâche planifiée", wait: false, origin: { kind: "scheduled-trigger" } } as any);
      await $.turn.start({ text: "tâche planifiée", turnId: "t8" } as any);
      await engine.clock.advance(1_000);
      await engine.finish("t8", [{ id: "b7", type: "shell" }]);
      await engine.clock.advance(20_000);
      const t2 = await engine.shellDone("b7");
      await engine.clock.advance(2_000);
      await engine.finish(t2, []);
      expect(await engine.shows("0:02 ✓")).toBe(true);
    });

    test(`chrono : après un rechargement, une notification reste une notification (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un shell de fond");
      await engine.clock.advance(3_000);
      await engine.finish(t1, [{ id: "b1", type: "shell" }]);
      await engine.clock.advance(10_000);
      // Le module rechargé a perdu les prompts en attente : le tour démarre sans eux.
      await $.turn.start({ text: "<task-notification>\n<task-id>b1</task-id>", turnId: "t5" } as any);
      await engine.clock.advance(2_000);
      expect(await engine.shows("0:15")).toBe(true);
      await engine.finish("t5", []);
      expect(await engine.shows("0:15 ✓")).toBe(true);
    });

    test(`chrono : un message tapé pendant un tour et livré au tour suivant ne le relance pas (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("bonjour");
      await engine.clock.advance(3_000);
      // Tapé pendant la réponse : sa requête part à son envoi…
      await $.prompt.submit({ text: "précision", wait: false, turnId: t1, origin: { kind: surface === "terminal" ? "composer" : "sdk" } } as any);
      await engine.clock.advance(2_000);
      await engine.finish(t1, []);
      // … puis le moteur le livre au tour suivant, au lieu du tour en cours : pas de second départ.
      await engine.clock.advance(1_000);
      await $.turn.start({ text: "précision", turnId: "t2" } as any);
      await engine.clock.advance(4_000);
      expect(await engine.shows("0:07")).toBe(true);
      await engine.finish("t2", []);
      expect(await engine.shows("0:07 ✓")).toBe(true);
    });

    test(`chrono : deux messages tapés pendant un tour, le premier livré seul au tour suivant (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const origin = { kind: surface === "terminal" ? "composer" : "sdk" };
      const t1 = await engine.send("bonjour");
      await engine.clock.advance(3_000);
      await $.prompt.submit({ text: "A", wait: false, turnId: t1, origin } as any);
      await engine.clock.advance(1_000);
      await $.prompt.submit({ text: "B", wait: false, turnId: t1, origin } as any);
      await engine.clock.advance(1_000);
      await engine.finish(t1, []);
      // Le tour de A : le fil principal travaille, le chrono (celui de B, le plus récent) n'est pas fini.
      await $.turn.start({ text: "A", turnId: "t2" } as any);
      await engine.clock.advance(2_000);
      expect(await engine.shows("0:03")).toBe(true);
      expect(await engine.shows(/✓/)).toBe(false);
    });

    test(`chrono : un nouveau message repart à zéro, sans les tâches de la requête d'avant (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un serveur de fond");
      await engine.clock.advance(4_000);
      await engine.finish(t1, [{ id: "srv", type: "shell" }]);
      await engine.clock.advance(60_000);
      // Un serveur garde la requête ouverte jusqu'au message suivant.
      expect(await engine.shows("1:04")).toBe(true);
      const t2 = await engine.send("dis bonjour");
      await engine.clock.advance(3_000);
      await engine.finish(t2, [{ id: "srv", type: "shell" }]);
      await engine.clock.advance(1_000);
      expect(await engine.shows("0:03 ✓")).toBe(true);
      expect(await engine.shows(/en fond/)).toBe(false);
      // La notification d'une tâche de la requête d'avant ne touche pas au chrono affiché.
      const t3 = await engine.shellDone("srv");
      await engine.clock.advance(2_000);
      await engine.finish(t3, []);
      expect(await engine.shows("0:03 ✓")).toBe(true);
    });

    test(`chrono : une interruption l'arrête, la notification d'une tâche inconnue le reprend (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un shell de fond puis attends au premier plan");
      await engine.clock.advance(3_000);
      // Échap : `turn.complete` interrompu, sans `classic.Stop`.
      await $.turn.complete({ answer: "", durationMs: 1, turnId: t1, reason: "aborted", isAborted: true } as any);
      await engine.clock.advance(1_000);
      expect(await engine.shows("0:03 ✓")).toBe(true);
      // Le shell lancé dans le tour interrompu finit : sa requête reprend, sans repartir de zéro.
      await engine.clock.advance(36_000);
      const t2 = await engine.shellDone("b9");
      await engine.clock.advance(2_000);
      expect(await engine.shows("0:42")).toBe(true);
      await engine.finish(t2, []);
      expect(await engine.shows("0:42 ✓")).toBe(true);
    });

    test(`chrono : un agent encore actif retient une requête interrompue (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un sous-agent de fond");
      await engine.clock.advance(2_000);
      engine.setAgents([{ id: "a1", status: "running", type: "general-purpose", description: "x" }]);
      await $.turn.complete({ answer: "", durationMs: 1, turnId: t1, reason: "aborted", isAborted: true } as any);
      await engine.clock.advance(5_000);
      expect(await engine.shows("0:07")).toBe(true);
      expect(await engine.shows("1 en fond")).toBe(true);
    });

    test(`chrono : la dernière tâche finie sans tour relancé le clôt à l'arrêt d'un agent (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un shell de fond");
      await engine.clock.advance(2_000);
      await engine.finish(t1, [{ id: "b1", type: "shell" }]);
      await engine.clock.advance(10_000);
      // Un agent de Claude Code (titre, suggestion) s'arrête : sa liste dit que le shell a fini.
      await $.classic.SubagentStop({ stop_hook_active: false, agent_id: "interne", agent_type: "x", agent_transcript_path: "", background_tasks: [] } as any);
      await engine.clock.advance(5_000);
      expect(await engine.shows("0:12 ✓")).toBe(true);
    });

    test(`chrono : ni un pair d'une autre session ni une tâche planifiée ne le relancent (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("bonjour");
      await engine.clock.advance(2_000);
      await engine.finish(t1, []);
      await engine.clock.advance(10_000);
      const t2 = await engine.agentDone("autre-session");
      await engine.clock.advance(3_000);
      await engine.finish(t2, []);
      await $.prompt.submit({ text: "tâche planifiée", wait: false, origin: { kind: "scheduled-trigger" } } as any);
      await $.turn.start({ text: "tâche planifiée", turnId: "t9" } as any);
      await engine.clock.advance(3_000);
      await engine.finish("t9", []);
      expect(await engine.shows("0:02 ✓")).toBe(true);
    });

    test(`chrono : sans liste des tâches de fond, il se rabat sur les agents actifs (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un sous-agent de fond");
      await engine.clock.advance(2_000);
      engine.setAgents([{ id: "a1", status: "running", type: "general-purpose", description: "x" }]);
      // Une version de Claude Code sans `background_tasks`.
      await $.classic.Stop({ stop_hook_active: false } as any);
      await $.turn.complete({ answer: "", durationMs: 1, turnId: t1, reason: "answer" } as any);
      await engine.clock.advance(3_000);
      expect(await engine.shows("1 en fond")).toBe(true);
      engine.setAgents([{ id: "a1", status: "completed", type: "general-purpose", description: "x" }]);
      const t2 = await engine.agentDone("a1");
      await engine.clock.advance(1_000);
      await $.classic.Stop({ stop_hook_active: false } as any);
      await $.turn.complete({ answer: "", durationMs: 1, turnId: t2, reason: "answer" } as any);
      expect(await engine.shows("0:06 ✓")).toBe(true);
    });

    test(`chrono : une interruption du tour relancé par la dernière tâche l'arrête (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un shell de fond");
      await engine.clock.advance(2_000);
      await engine.finish(t1, [{ id: "b1", type: "shell" }]);
      await engine.clock.advance(10_000);
      const t2 = await engine.shellDone("b1");
      await engine.clock.advance(1_000);
      // Échap pendant le tour relancé : pas de `classic.Stop`, mais le shell a déjà notifié sa fin.
      await $.turn.complete({ answer: "", durationMs: 1, turnId: t2, reason: "aborted", isAborted: true } as any);
      await engine.clock.advance(5_000);
      expect(await engine.shows("0:13 ✓")).toBe(true);
      expect(await engine.shows(/en fond/)).toBe(false);
    });

    test(`chrono : une notification livrée pendant un tour libère sa tâche (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance deux shells de fond");
      await engine.clock.advance(2_000);
      await engine.finish(t1, [
        { id: "b1", type: "shell" },
        { id: "b2", type: "shell" },
      ]);
      await engine.clock.advance(10_000);
      const t2 = await engine.shellDone("b2");
      await engine.clock.advance(1_000);
      // L'autre shell finit pendant ce tour : sa notification le rejoint, puis Échap.
      await $.prompt.submit({ text: "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>", wait: false, origin: { kind: "task-notification" }, turnId: t2 } as any);
      await engine.clock.advance(1_000);
      await $.turn.complete({ answer: "", durationMs: 1, turnId: t2, reason: "aborted", isAborted: true } as any);
      await engine.clock.advance(5_000);
      expect(await engine.shows("0:14 ✓")).toBe(true);
    });

    test(`chrono : une erreur d'API, sans \`classic.Stop\`, garde les agents encore actifs (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      const t1 = await engine.send("lance un sous-agent de fond");
      await engine.clock.advance(2_000);
      engine.setAgents([{ id: "a1", status: "running", type: "general-purpose", description: "x" }]);
      await $.turn.complete({ answer: "", durationMs: 1, turnId: t1, reason: "error" } as any);
      await engine.clock.advance(5_000);
      expect(await engine.shows("0:07")).toBe(true);
      expect(await engine.shows("1 en fond")).toBe(true);
    });

    test(`chrono : un prompt resté sans tour ne prête pas son heure au même texte envoyé plus tard (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const engine = await realEngine($, on, surface);
      // Un prompt refusé ou consommé par un hook : aucun tour ne le suit.
      await $.prompt.submit({ text: "continue", wait: false, origin: { kind: surface === "terminal" ? "composer" : "sdk" } } as any);
      await engine.clock.advance(600_000);
      await engine.send("continue");
      await engine.clock.advance(2_000);
      expect(await engine.shows("0:02")).toBe(true);
    });
  }

  for (const surface of ["terminal", "desktop"] as const) {
    test(`tokens/s : le temps de génération du modèle seul, depuis le dernier message (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      engineDraws(on);
      on("prompt.submit", (_, e: any) => ({ text: e.text }));
      on("turn.start", ($, e: any) => ({ turnId: e.turnId }));
      // Sous le plugin : le modèle lit le prompt (`wait` ms), puis génère `tokens` en `generate` ms.
      let plan = { wait: 0, generate: 0, tokens: 0 };
      on("turn.step", async function* (_, e: any) {
        await clock.advance(plan.wait);
        yield { kind: "thinking", index: 0, text: "…" };
        await clock.advance(plan.generate / 2);
        yield { kind: "text", index: 1, text: "ok" };
        await clock.advance(plan.generate / 2);
        const usage = { input_tokens: 10, output_tokens: plan.tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: "claude-opus-5-5" };
        yield { kind: "stop", stopReason: "end_turn", usage };
        return { turnId: e.turnId, index: e.index, answer: "ok", toolUses: [], stopReason: "end_turn", usage } as any;
      });
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
      const ui = await mountValues($, surface);
      const step = async (next: typeof plan, agentId?: string) => {
        plan = next;
        for await (const _ of $.turn.step({ turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1, agentId } as any)) {
          // les morceaux de la réponse, sans intérêt ici
        }
      };
      // Un message reçu au repos, puis son tour (docs/evenements-moteur.md).
      const send = async (text: string) => {
        await $.prompt.submit({ text, wait: false, origin: { kind: "composer" } } as any);
        await $.turn.start({ text, turnId: "t1" } as any);
      };

      await send("bonjour");
      expect(await ui.find({ type: "Text", text: /tok\/s$/ })).toBeUndefined();
      // 400 tokens en 4 s de génération : la lecture du prompt (2 s) ne compte pas.
      await step({ wait: 2_000, generate: 4_000, tokens: 400 });
      expect(await ui.find({ type: "Text", text: "100 tok/s" })).toBeDefined();
      // Un outil ou une tâche de fond tourne 30 s : hors génération, la vitesse ne bouge pas.
      await clock.advance(30_000);
      expect(await ui.find({ type: "Text", text: "100 tok/s" })).toBeDefined();
      // Deuxième requête du même tour : moyenne sur l'ensemble, 700 tokens en 5 s.
      await step({ wait: 1_000, generate: 1_000, tokens: 300 });
      expect(await ui.find({ type: "Text", text: "140 tok/s" })).toBeDefined();
      // Un sous-agent génère en parallèle : il n'entre pas dans la moyenne.
      await step({ wait: 0, generate: 1_000, tokens: 5_000 }, "a1");
      expect(await ui.find({ type: "Text", text: "140 tok/s" })).toBeDefined();

      // Un nouveau message remet la moyenne à zéro.
      await send("encore");
      expect(await ui.find({ type: "Text", text: /tok\/s$/ })).toBeUndefined();
      await step({ wait: 500, generate: 2_000, tokens: 100 });
      expect(await ui.find({ type: "Text", text: "50 tok/s" })).toBeDefined();
    });
  }

  test("desktop : la ligne du chrono passe en haut à gauche, au-dessus des autres bandeaux", async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    // Sous le plugin : le bandeau d'un autre mod (stats-board…).
    on("ui.render", ($: any, e: any) => {
      const { Text } = $.ui.resolve(e);
      return e.component === "AbovePrompt" ? Text({ key: "autre", children: "Stats" }) : Text({ children: "" });
    });
    on("prompt.submit", (_, e: any) => ({ text: e.text }));
    on("turn.start", ($, e: any) => ({ turnId: e.turnId }));
    await $.session.start({ surface: "desktop", isInteractive: true, cwd: "/work" } as any);
    // Un message reçu au repos, puis son tour (docs/evenements-moteur.md).
    await $.prompt.submit({ text: "bonjour", wait: false, origin: { kind: "sdk" } } as any);
    await $.turn.start({ text: "bonjour", turnId: "t1" } as any);
    const ui = await mountValues($, "desktop");
    const root = await ui.find({ type: "Box" });
    const [mine, other] = (root?.children ?? []) as any[];
    expect(mine.props.key).toBe("session-tools");
    expect(mine.props.justifyContent).toBeUndefined();
    expect(JSON.stringify(other)).toContain("Stats");
  });

  test("/session-tools:start répond seul, sans le modèle ni panneau", async ($, on) => {
    let reachedBelow = false;
    const opened: string[] = [];
    // Sous le plugin : ce qui tiendrait lieu de la commande (le modèle) si le mod ne répondait pas.
    on("command.run", { command: "session-tools:start" }, async () => {
      reachedBelow = true;
      return { text: "modèle" };
    });
    on("ui.open", ($, e: any) => {
      opened.push(e.id);
      return { value: {} } as any;
    });
    const out = await $.command.run({ command: "session-tools:start", args: "" } as any);
    expect(String(out.text)).toBe("Mods démarrés.");
    expect(reachedBelow).toBe(false);
    expect(opened).toEqual([]);
  });
});
