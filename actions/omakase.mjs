// The action vocabulary: every move a screenplay can ask of Omakase.
//
// This is the only file that knows Omakase's selectors, shortcuts, and
// timing. It is the part that has to change when the app changes, so it
// belongs in the Omakase repo beside a contract; it lives here until it
// can move.
//
// An action has a one-line `summary`, its `args`, and `run(stage, args)`.
// The value written after the action's name in a screenplay arrives as
// `args.value`. Every wait is on app state, never on a pause, so the same
// action works at check speed.

const FIND = "noteSearch";
const FIND_OPEN = `!document.getElementById('${FIND}').classList.contains('hidden')`;
const FIND_CARD = `#${FIND} .note-search-card`;
const FIND_INPUT = "#noteSearchInput";
const FIND_ACTIVE = "#noteSearchResults .note-search-result.is-active";
const HUD_CARD = "body > .keystroke-hud-card[popover]";
const EDITOR_READY = "!!document.querySelector('#cm6EditorHost .cm-content') && !!document.querySelector('.note-item.active')";
const NOTE_NAME = "document.getElementById('noteNameBtn').textContent.trim()";
const SCOPES = { vault: { combo: "Ctrl+Shift+F", label: "Whole vault" }, note: { combo: "Ctrl+F", label: "Current note" } };
const quote = (value) => JSON.stringify(value);

export const actions = {
  pause: {
    summary: "Hold still. Rhythm only: nothing may depend on it.",
    args: { value: { type: "duration", required: true, doc: "how long, such as 800ms or 1.2s" } },
    run: (stage, { value }) => stage.pause(value)
  },

  type: {
    summary: "Type text into whatever has focus, one key at a time.",
    args: {
      value: { type: "text", required: true, doc: "the text; a line break is Enter" },
      wpm: { type: "number", default: 70, doc: "typing speed in words per minute" },
      reads: { type: "text", doc: "the note must read exactly this afterwards; defaults to the typed text when the note started empty" }
    },
    async run(stage, { value, wpm, reads }) {
      const before = (await stage.app.editorState()).text;
      await stage.type(value, { wpm });
      const expected = reads ?? (before === "" ? value : null);
      if (expected !== null) await stage.app.until("the note reads as typed", async () => (await stage.app.editorState()).text === expected, { timeoutMs: 3000 });
    }
  },

  press: {
    summary: "Press one key, such as Enter, Escape, or ArrowDown.",
    args: { value: { type: "text", required: true, doc: "the key name" }, times: { type: "number", default: 1 }, gap: { type: "duration", default: 0.45, doc: "pause between repeats" } },
    async run(stage, { value, times, gap }) {
      for (let count = 0; count < times; count++) {
        if (count) await stage.pause(gap * 1000);
        await stage.stroke(value);
      }
    }
  },

  chord: {
    summary: "Press a key combination, modifiers first, such as Ctrl+L. The camera goes to the keys.",
    args: { value: { type: "text", required: true, doc: "the combination" } },
    run: (stage, { value }) => stage.chord(value, { watch: HUD_CARD })
  },

  find: {
    summary: "Open find, type a query, walk down the matches, and jump to one.",
    args: {
      value: { type: "text", required: true, doc: "the query" },
      in: { type: "enum", values: ["vault", "note"], default: "vault", doc: "search every note or the current one" },
      down: { type: "number", default: 0, doc: "matches to step past before jumping" },
      lands: { type: "text", required: true, doc: "name of the note the jump must end in" },
      wpm: { type: "number", default: 48 }
    },
    async run(stage, { value: query, in: where, down, lands, wpm }) {
      const scope = SCOPES[where];
      await stage.chord(scope.combo, { watch: HUD_CARD });
      await stage.until(`${where} find opens`, `${FIND_OPEN} && document.getElementById('noteSearchScope').textContent === ${quote(scope.label)}`);
      await stage.show("modal", FIND_CARD);
      await stage.pause(450);
      await stage.type(query, { where: () => stage.box(FIND_INPUT), wpm });
      // Vault find reopens on its last results and searches after a short
      // delay, so wait for results that answer this query, not for any results.
      await stage.until(`matches for ${query}`, `document.querySelector(${quote(FIND_INPUT)}).value === ${quote(query)} && (document.querySelector('#noteSearchResults .note-search-result')?.textContent.toLowerCase().includes(${quote(query.toLowerCase())}) ?? false)`);
      await stage.pause(250);
      await stage.show("modal", FIND_CARD);
      await stage.pause(900);
      for (let step = 0; step < down; step++) {
        await stage.stroke("ArrowDown");
        await stage.show("select", FIND_ACTIVE);
        await stage.pause(520);
      }
      await stage.pause(300);
      await stage.stroke("Enter");
      await stage.until("find closes", `!(${FIND_OPEN})`);
      await stage.until(`${query} lands in ${lands}`, `${NOTE_NAME} === ${quote(lands)}`);
      // A jump into another note loads the note first and selects the match after.
      await stage.app.until(`the jump for "${query}" selects the match`, async () => {
        const { text, anchor, head } = await stage.app.editorState();
        return text.slice(Math.min(anchor, head), Math.max(anchor, head)).toLowerCase() === query.toLowerCase();
      }, { timeoutMs: 5000 });
      await stage.pause(350);
      stage.beat("land", { query, box: await stage.caret() });
      await stage.shot(`land ${query}`);
    }
  },

  "keystroke-hud": {
    summary: "Show or hide the card that displays pressed keys. Setup only: it reloads the window.",
    setupOnly: true,
    args: { value: { type: "enum", values: ["on", "off"], required: true } },
    async run(stage, { value }) {
      const on = value === "on";
      // The HUD keeps its state in local storage and reads it at startup.
      await stage.app.evaluate(`localStorage.setItem('omakase.keystrokeHud.enabled', '${on}'), document.documentElement.dataset.demoStale = '1', location.reload(), true`);
      // A read can land while the old page is being torn down. That is not ready yet.
      const ready = `document.documentElement.dataset.demoStale !== '1' && ${EDITOR_READY} && !!document.querySelector(${quote(HUD_CARD)}) === ${on}`;
      await stage.app.until("the window reloads", () => stage.app.evaluate(ready).catch(() => false));
      await stage.app.view("(view.focus(), true)");
    }
  },

  sidebar: {
    summary: "Open or close the note list.",
    args: { value: { type: "enum", values: ["open", "closed"], required: true } },
    async run(stage, { value }) {
      // A closed sidebar slides off the left edge; its notes stay in the DOM.
      const open = "document.querySelector('.note-item.active')?.getBoundingClientRect().right > 0";
      const want = value === "open";
      // Just after a reload the app can restore its own sidebar state over
      // ours, so press, look, and press again if it did not hold.
      for (let attempt = 0; attempt < 4; attempt++) {
        if ((await stage.app.evaluate(open)) !== want) {
          await stage.app.view("(view.focus(), true)");
          await stage.stroke("Escape");
          await stage.pause(120);
          await stage.stroke("Escape");
        }
        const held = await stage.app.until(`the sidebar is ${value}`, async () => (await stage.app.evaluate(open)) === want, { timeoutMs: 1500 }).catch(() => false);
        // Held means it is still right a moment later.
        if (held && (await new Promise((resolve) => setTimeout(resolve, 300)), (await stage.app.evaluate(open)) === want)) return;
      }
      throw new Error(`the sidebar would not stay ${value}`);
    }
  }
};

/** What the recorder needs to start the app for a screenplay. */
export const app = {
  /** The vault to seed, relative to the Omakase checkout. */
  defaultVault: "demo-notes"
};
