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
const LAUNCHER_OPEN = "!document.getElementById('commandPalette').classList.contains('hidden')";
const LAUNCHER_CARD = "#commandPalette .command-palette-card";
const LAUNCHER_INPUT = "#commandPaletteInput";
const LAUNCHER_ACTIVE = "#commandPaletteList .command-palette-item.is-active";
const NAVIGATOR_OPEN = "!document.getElementById('noteNavigator').classList.contains('hidden')";
const NAVIGATOR_SHELL = "#noteNavigator .note-navigator-shell";
const NAVIGATOR_LAYOUT = "document.getElementById('noteNavigatorCalendar').dataset.level";
// Everything a move can change: the layout, the calendar's day, and the selected note.
const NAVIGATOR_AT = `(() => {
  const calendar = document.getElementById('noteNavigatorCalendar');
  const label = (id) => document.getElementById(id).getAttribute('aria-label');
  return [calendar.dataset.level, calendar.dataset.day, label('noteNavigatorPrevious'), label('noteNavigatorNext'), document.querySelector('.note-navigator-week-card[aria-current="true"]')?.textContent ?? ''].join('|');
})()`;
const NAVIGATOR_KEYWORD = "#noteNavigatorKeyword";
const NAVIGATOR_CLOSEUPS = { calendar: "#noteNavigatorCalendar", day: '#noteNavigatorWeekDays .note-navigator-day[data-selected="true"]' };
const NAVIGATOR_KEYS = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };
const SCOPES = { vault: { combo: "Ctrl+Shift+F", label: "Whole vault" }, note: { combo: "Ctrl+F", label: "Current note" } };
const TABLE_SUSHI_PANEL = ".table-sushi-panel";
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

  launcher: {
    summary: "Open the launcher with Ctrl+L, type a command's name, and run it. \"Open Navigator\" opens the note browser.",
    args: {
      value: { type: "text", required: true, doc: "the command's name as the launcher lists it, such as Open Navigator" },
      wpm: { type: "number", default: 48 }
    },
    async run(stage, { value: command, wpm }) {
      await stage.chord("Ctrl+L", { watch: HUD_CARD });
      await stage.until("the launcher opens", LAUNCHER_OPEN);
      await stage.show("modal", LAUNCHER_CARD);
      await stage.pause(450);
      await stage.type(command, { where: () => stage.box(LAUNCHER_INPUT), wpm });
      await stage.until(`the launcher offers ${command}`, `document.querySelector(${quote(`${LAUNCHER_ACTIVE} .command-palette-item-title`)})?.textContent.trim().toLowerCase() === ${quote(command.toLowerCase())}`);
      await stage.show("select", LAUNCHER_ACTIVE);
      await stage.pause(700);
      await stage.stroke("Enter");
      await stage.until("the launcher closes", `!(${LAUNCHER_OPEN})`);
    }
  },

  navigator: {
    summary: "Browse notes in the navigator: pages by day, or a calendar by week. Opens it with Ctrl+Shift+Space unless it is already open, and stays in it until a step says open. The camera fills the picture with it and does not go to the keys.",
    args: {
      value: { type: "enum", values: ["day", "week"], required: true, doc: "the layout; switching presses d or w" },
      closeup: { type: "enum", values: ["calendar", "day"], doc: "hold the camera close for this step: on the calendar icon, whose marker moves with the selected day, or by week on the selected day's column. It pulls back when the step ends" },
      search: { type: "text", doc: "by day: press s, type this keyword filter, and return to the pages. Done before the moves. The selected page must then contain it" },
      moves: { type: "text", doc: "arrow keys in order, such as \"left 3, right, down 2\". By day, left and right turn to the older and newer note, and up and down scroll the page. By week, left and right move a day, up and down pick among that day's notes, and previous-week and next-week jump seven days. A move that changes nothing fails, except a scroll" },
      gap: { type: "duration", default: 0.7, doc: "pause after each move" },
      then: { type: "enum", values: ["stay", "open"], default: "stay", doc: "open presses Enter on the selected note and leaves the navigator, as the camera pulls back to the whole window" },
      lands: { type: "text", doc: "with open: name of the note that must end up open" }
    },
    async run(stage, { value: layout, closeup, search, moves, gap, then, lands }) {
      const strokes = (moves ?? "").split(",").map((move) => move.trim()).filter(Boolean).flatMap((move) => {
        const [, direction, count = "1"] = move.match(/^(left|right|up|down|previous-week|next-week)(?:\s+(\d+))?$/i) ?? [];
        if (!direction) throw new Error(`navigator: "${move}" is not a move. Write a direction and an optional count, such as "left 3"`);
        return Array(Number(count)).fill(direction.toLowerCase());
      });
      if (!(await stage.app.evaluate(NAVIGATOR_OPEN))) {
        // The keys are not the subject here, so the camera stays where it is.
        await stage.chord("Ctrl+Shift+Space", { watch: null });
        await stage.until("the navigator opens", NAVIGATOR_OPEN);
        // Take it in for a beat, then move in until it fills the picture.
        await stage.pause(600);
        await stage.show("fill", NAVIGATOR_SHELL);
        await stage.pause(900);
      }
      if ((await stage.app.evaluate(NAVIGATOR_LAYOUT)) !== layout) {
        await stage.stroke(layout[0]);
        await stage.until(`the navigator shows the ${layout}`, `${NAVIGATOR_LAYOUT} === ${quote(layout)}`);
        await stage.pause(gap * 1000);
      }
      if (search) {
        await stage.stroke("s");
        await stage.until("the keyword filter takes focus", `document.activeElement === document.querySelector(${quote(NAVIGATOR_KEYWORD)})`);
        await stage.pause(350);
        await stage.type(search, { where: () => stage.box(NAVIGATOR_KEYWORD), wpm: 48 });
        await stage.until(`the navigator finds ${search}`, `document.getElementById('noteNavigatorCurrent').textContent.toLowerCase().includes(${quote(search.toLowerCase())})`);
        await stage.pause(900);
        await stage.stroke("Enter");
        await stage.until("the pages take focus back", `document.activeElement !== document.querySelector(${quote(NAVIGATOR_KEYWORD)})`);
        await stage.pause(gap * 1000);
      }
      if (closeup) {
        if (closeup === "day" && layout !== "week") throw new Error("navigator: \"closeup: day\" frames a day's column, which only the week layout has");
        await stage.show("closeup", NAVIGATOR_CLOSEUPS[closeup]);
        await stage.pause(1100);
      }
      for (const direction of strokes) {
        const scrolls = layout === "day" && (direction === "up" || direction === "down");
        const before = await stage.app.evaluate(NAVIGATOR_AT);
        if (direction.endsWith("-week")) {
          await stage.down("Ctrl");
          await stage.stroke(direction === "next-week" ? "ArrowRight" : "ArrowLeft");
          await stage.up("Ctrl");
        } else {
          await stage.stroke(NAVIGATOR_KEYS[direction]);
        }
        // A scroll at the end of a page moves nothing, and that is fine.
        if (!scrolls) await stage.until(`${direction} moves the navigator`, `${NAVIGATOR_AT} !== ${quote(before)}`, { timeoutMs: 3000 });
        await stage.pause(gap * 1000);
      }
      await stage.shot(`navigator ${layout}`);
      if (then !== "open") {
        if (closeup) await stage.show("fill", NAVIGATOR_SHELL);
        return;
      }
      // The note opens where it was last read, so there is no caret to frame:
      // pull back to the whole window as the navigator gives way to it.
      stage.beat("land");
      await stage.stroke("Enter");
      await stage.until("the navigator closes", `!(${NAVIGATOR_OPEN})`);
      if (lands) await stage.until(`the navigator lands in ${lands}`, `${NOTE_NAME} === ${quote(lands)}`);
      await stage.until("the note is ready", EDITOR_READY);
      await stage.pause(350);
      await stage.shot(`land ${lands ?? "note"}`);
    }
  },

  "table-sushi": {
    summary: "Ask Sushi about a table: click a cell, open table Sushi, type the question, and hold on the card until the answer lands.",
    args: {
      value: { type: "text", required: true, doc: "the question" },
      row: { type: "number", default: 1, doc: "body row of the cell to start from, counting the header as 0" },
      column: { type: "number", default: 0, doc: "column of that cell, from 0" },
      lift: { type: "number", doc: "after the click, scroll so the table's top sits this many pixels below the editor's top, leaving room for the card" },
      wpm: { type: "number", default: 56 },
      answer: { type: "text", doc: "text the finished answer must contain" }
    },
    async run(stage, { value, row, column, lift, wpm, answer }) {
      const cell = `.cm-table-inline [data-cell-row="${row}"][data-table-col-index="${column}"]`;
      await stage.until("the table is drawn", `!!document.querySelector(${quote(cell)})`);
      await stage.app.click(cell);
      await stage.pause(450);
      // Clicking scrolls the caret into view, so the table is lifted afterwards.
      if (lift !== undefined) {
        await stage.app.evaluate(`(() => {
          const scroller = document.querySelector('#cm6EditorHost .cm-scroller');
          const top = document.querySelector('.cm-table-inline').getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          scroller.scrollTo({ top: scroller.scrollTop + top - ${lift}, behavior: 'smooth' });
          return true;
        })()`);
        await stage.until("the table is lifted", `Math.abs(document.querySelector('.cm-table-inline').getBoundingClientRect().top - document.querySelector('#cm6EditorHost .cm-scroller').getBoundingClientRect().top - ${lift}) < 4`);
        await stage.pause(300);
      }
      // Table Sushi is w held with d pressed twice.
      const w = { key: "w", code: "KeyW", vk: 87 };
      stage.beat("chord", { label: "W + D D", box: await stage.box(HUD_CARD) });
      await stage.app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: w.vk, text: "w" });
      await stage.pause(160);
      await stage.stroke("d");
      await stage.pause(120);
      await stage.stroke("d");
      await stage.app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: w.vk });
      await stage.until("the table Sushi prompt has focus", "document.activeElement?.classList.contains('table-sushi-prompt')");
      await stage.show("modal", TABLE_SUSHI_PANEL);
      await stage.pause(300);
      await stage.type(value, { wpm, where: () => stage.box(TABLE_SUSHI_PANEL), label: value });
      await stage.pause(350);
      await stage.stroke("Enter");
      await stage.until("the card starts working", `!!document.querySelector('${TABLE_SUSHI_PANEL} .cm-invocation-card-loading')`);
      await stage.show("modal", TABLE_SUSHI_PANEL);
      await stage.shot("table sushi working");
      await stage.app.until("the answer lands", () => stage.app.evaluate(`document.querySelector(${quote(TABLE_SUSHI_PANEL)})?.dataset.phase === 'answer'`), { timeoutMs: 60_000 });
      if (answer) await stage.until("the answer reads as scripted", `document.querySelector('.table-sushi-answer')?.textContent.includes(${quote(answer)})`);
      await stage.show("modal", TABLE_SUSHI_PANEL);
      await stage.shot("table sushi answer");
    }
  },

  "note-sushi": {
    summary: "Ask Sushi in the note: put the caret on the line after one that contains `after`, open the prompt, type the question, and hold on the card until the answer is written.",
    args: {
      value: { type: "text", required: true, doc: "the question" },
      after: { type: "text", required: true, doc: "text on the line just above where the caret goes" },
      lift: { type: "number", doc: "scroll so the caret sits this many pixels below the editor's top, leaving room for the card" },
      wpm: { type: "number", default: 56 },
      answer: { type: "text", doc: "text the finished answer must contain" },
      press: { type: "text", doc: "a key combination to press while the card works, such as Ctrl+Alt+L" },
      times: { type: "number", default: 1, doc: "how many times to press it" },
      every: { type: "duration", default: 3, doc: "time between presses, and before the first" }
    },
    async run(stage, { value, after, lift, wpm, answer, press, times, every }) {
      const placed = await stage.app.view(`(() => {
        const doc = view.state.doc;
        for (let n = 1; n < doc.lines; n++) {
          if (!doc.line(n).text.includes(${quote(after)})) continue;
          view.dispatch({ selection: { anchor: doc.line(n + 1).from } });
          view.focus();
          return true;
        }
        return false;
      })()`);
      if (!placed) throw new Error(`no line contains ${quote(after)}`);
      if (lift !== undefined) {
        await stage.app.evaluate(`(() => {
          const scroller = document.querySelector('#cm6EditorHost .cm-scroller');
          const caret = document.querySelector('.cm-cursor')?.getBoundingClientRect().top ?? 0;
          scroller.scrollTo({ top: scroller.scrollTop + caret - scroller.getBoundingClientRect().top - ${lift}, behavior: 'smooth' });
          return true;
        })()`);
      }
      await stage.pause(700);
      // Ask Sushi is w held with d pressed twice.
      stage.beat("chord", { label: "W + D D", box: null });
      await stage.app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, text: "w" });
      await stage.pause(160);
      await stage.stroke("d");
      await stage.pause(120);
      await stage.stroke("d");
      await stage.app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
      await stage.until("the Sushi prompt has focus", "document.activeElement?.classList.contains('selected-sushi-composer-input')");
      await stage.show("modal", ".selected-sushi-composer");
      await stage.pause(300);
      await stage.type(value, { wpm, where: () => stage.box(".selected-sushi-composer"), label: value });
      await stage.pause(350);
      await stage.stroke("Enter");
      await stage.until("the card starts working", "!!document.querySelector('.cm-invocation-card .cm-invocation-card-loading')");
      await stage.show("modal", ".cm-invocation-card");
      await stage.shot("note sushi working");
      for (let count = 0; press && count < times; count++) {
        await stage.pause(every * 1000);
        await stage.chord(press, { watch: null });
        await stage.shot(`note sushi working ${count + 2}`);
      }
      await stage.app.until("the answer is written", () => stage.app.evaluate(`document.querySelector('.cm-invocation-card')?.dataset.phase === 'done'`), { timeoutMs: 60_000 });
      if (answer) await stage.until("the answer reads as scripted", `document.querySelector('#cm6EditorHost .cm-content').textContent.includes(${quote(answer)})`);
      await stage.show("modal", ".cm-invocation-card");
      await stage.shot("note sushi answer");
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
