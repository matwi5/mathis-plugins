import { describe, expect, mock, test } from "claude-code/testing";

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
        // Le pied desktop, trop étroit, ne garde que le bouton : les valeurs sont dans le bandeau.
        const footer = await $.ui.mount({ plugin: "session-tools", surface, component: "SessionMode", props: { modes: [] } } as any);
        expect(await footer.find({ type: "Text", text: /^Cache/ })).toBeUndefined();
        expect(await footer.find({ key: "ultracode" })).toBeDefined();
      }
    });
  }

  for (const surface of ["terminal", "desktop"] as const) {
    test(`le bouton Ultracode lance /effort ultracode on|off (${surface})`, async ($, on) => {
      const runs: string[] = [];
      mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      engineDraws(on);
      // Sous le plugin : la commande /effort intégrée. En interactif, c'est une commande à
      // interface qui ne renvoie aucun texte ; `/effort auto` ne touche pas Ultracode.
      on("command.run", { command: "effort" }, ($, e) => {
        runs.push(e.args);
        return {};
      });
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);

      const ui = await $.ui.mount({ plugin: "session-tools", surface, component: "SessionMode", props: { modes: [] } } as any);
      expect((await ui.find({ key: "ultracode" }))?.text).toMatch(/off$/);

      await ui.press({ key: "ultracode" });
      expect(runs).toEqual(["ultracode on"]);
      expect((await ui.find({ key: "ultracode" }))?.text).toMatch(/on$/);

      await ui.press({ key: "ultracode" });
      expect(runs).toEqual(["ultracode on", "ultracode off"]);
      expect((await ui.find({ key: "ultracode" }))?.text).toMatch(/off$/);

      // Tapé à la main, /effort met aussi le bouton à jour.
      await $.command.run({ command: "effort", args: "ultracode on" });
      expect((await ui.find({ key: "ultracode" }))?.text).toMatch(/on$/);
      await $.command.run({ command: "effort", args: "auto" });
      expect((await ui.find({ key: "ultracode" }))?.text).toMatch(/on$/);
      await $.command.run({ command: "effort", args: "ultracode off" });
      expect((await ui.find({ key: "ultracode" }))?.text).toMatch(/off$/);
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
      // Le brouillon reste tel quel, et Ultracode n'en est pas touché.
      expect(calls.fills).toEqual([]);
      expect((await ui.find({ key: "ultracode" }))?.text).toMatch(/off$/);
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
      // Sous le plugin : le moteur démarre le tour d'un prompt reçu au repos.
      let turns = 0;
      on("prompt.submit", async (_, e: any) => {
        if (!e.turnId) await $.turn.start({ text: e.text, turnId: `t${++turns}` });
        return { text: e.text };
      });
      on("turn.start", ($, e: any) => ({ turnId: e.turnId }));
      on("turn.complete", () => ({ text: "" }));
      await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
      const ui = await mountValues($, surface);
      const send = (text: string, extra: object = {}) =>
        $.prompt.submit({ text, wait: false, origin: { kind: surface === "terminal" ? "composer" : "sdk" }, ...extra } as any);
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

      // Un tour lancé par une notification ne touche pas au chrono.
      await $.prompt.submit({ text: "tâche finie", wait: false, origin: { kind: "task-notification" } } as any);
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

  for (const surface of ["terminal", "desktop"] as const) {
    test(`tokens/s : le temps de génération du modèle seul, depuis le dernier message (${surface})`, { timeoutMs: 30_000 }, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000_000 });
      on("session.start", ($, e) => ({ cwd: e.cwd }));
      engineDraws(on);
      on("prompt.submit", async (_, e: any) => {
        if (!e.turnId) await $.turn.start({ text: e.text, turnId: "t1" });
        return { text: e.text };
      });
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
      const send = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: "composer" } } as any);

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
    on("prompt.submit", async (_, e: any) => {
      await $.turn.start({ text: e.text, turnId: "t1" });
      return { text: e.text };
    });
    on("turn.start", ($, e: any) => ({ turnId: e.turnId }));
    await $.session.start({ surface: "desktop", isInteractive: true, cwd: "/work" } as any);
    await $.prompt.submit({ text: "bonjour", wait: false, origin: { kind: "sdk" } } as any);
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
    const out = await $.command.run({ command: "session-tools:start", args: "" });
    expect(String(out.text)).toBe("Mods démarrés.");
    expect(reachedBelow).toBe(false);
    expect(opened).toEqual([]);
  });
});
