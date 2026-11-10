import { filmTime, sourceTime } from "./edits.js";

export const EFFECTS = {
  caption: "Caption",
  camera: "Zoom",
  speed: "Speed",
  cut: "Remove",
  highlight: "Highlight",
  keys: "Key callout",
  card: "Title card",
  transition: "Transition",
};
const round = (n) => Number(n.toFixed(4));
export function resolvePoint(text, spans, edge = "start") {
  const m = String(text)
    .trim()
    .match(
      /^([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:@(start|end))?(?:\s*([+-])\s*(\d+(?:\.\d+)?)(ms|s))?$/,
    );
  if (!m || !spans[m[1]]) throw new Error(`Cannot place edit at ${text}`);
  return (
    spans[m[1]][m[2] ?? edge] +
    (m[4]
      ? Number(m[4]) * (m[5] === "ms" ? 0.001 : 1) * (m[3] === "-" ? -1 : 1)
      : 0)
  );
}
export function resolveRange(text, spans) {
  const parts = String(text).split("..");
  return [
    resolvePoint(parts[0], spans),
    resolvePoint(parts.at(-1), spans, "end"),
  ];
}
export function anchorAt(spans, source, edge = "start") {
  const scenes = Object.entries(spans).filter(([id]) => !id.includes("/"));
  const match =
    scenes.find(([, s]) =>
      edge === "end"
        ? source > s.start + 0.00001 && source <= s.end + 0.00001
        : source >= s.start - 0.00001 && source < s.end - 0.00001,
    ) ?? scenes.at(-1);
  if (!match) throw new Error("The take has no scenes");
  const [id, s] = match;
  if (Math.abs(source - s.start) < 0.00005) return `${id}@start`;
  if (Math.abs(source - s.end) < 0.00005) return `${id}@end`;
  const offset = round(source - s.start);
  return `${id}@start${offset < 0 ? "-" : "+"}${Math.abs(offset)}s`;
}
export function rangeFromTimeline(film, spans, start, end) {
  if (
    ![start, end].every(Number.isFinite) ||
    start < 0 ||
    end > film.duration + 0.001 ||
    end - start < 0.04
  )
    throw new Error(
      "Choose an end at least 0.04 seconds after the start, within the timeline.",
    );
  const from = sourceTime(film, start),
    to = sourceTime(film, end);
  if (to - from < 0.04)
    throw new Error("Choose a range containing recorded footage.");
  return `${anchorAt(spans, from)} .. ${anchorAt(spans, to, "end")}`;
}
export const effectSeconds = (value, fallback = 2.2) =>
  typeof value === "number"
    ? value
    : parseFloat(value ?? fallback) *
      (String(value).endsWith("ms") ? 0.001 : 1);
export function cardTimes(card, film, spans) {
  const [from, to] = resolveRange(card.range, spans);
  if (card.effects?.card) {
    const hold = film.cards.find(
      (c) =>
        Math.abs((c.source ?? -1) - from) < 0.002 &&
        c.text === card.effects.card.card,
    );
    const start = hold?.start ?? filmTime(film, from);
    if (Object.keys(card.effects).length === 1)
      return [start, start + effectSeconds(card.effects.card.for)];
    return [Math.min(start, filmTime(film, from)), filmTime(film, to)];
  }
  const start = filmTime(film, from),
    end = filmTime(film, to);
  // A cut still needs an editable window after its footage has been removed.
  return [start, end > start + 0.001 ? end : start + (to - from)];
}
export function moveRange(card, film, spans, start, end) {
  if (card.effects?.card) {
    const [oldStart] = cardTimes(card, film, spans),
      duration = effectSeconds(card.effects.card.for);
    const compressed = {
      ...film,
      duration: film.duration - duration,
      pieces: film.pieces.map((p) => ({
        ...p,
        at:
          p.at + film.logo >= oldStart + duration - 0.001
            ? p.at - duration
            : p.at,
      })),
    };
    const from = sourceTime(compressed, start);
    const to =
      Object.keys(card.effects).length === 1
        ? from + 0.1
        : sourceTime(compressed, end - duration);
    if (to <= from)
      throw new Error(
        "Keep enough room for the title duration and the other effects.",
      );
    return `${anchorAt(spans, from)} .. ${anchorAt(spans, to, "end")}`;
  }
  return rangeFromTimeline(film, spans, start, end);
}
export function importCards(edits, spans) {
  const cards = [];
  for (const [index, entry] of edits.entries()) {
    const kind = Object.keys(EFFECTS).find((key) => key in entry);
    let range = entry.over ?? entry.cut;
    if (!range && entry.review?.range) {
      range = entry.review.range;
      const [from, to] = resolveRange(range, spans),
        at = resolvePoint(entry.at, spans);
      if (Math.abs(from - at) > 0.0001)
        range = `${anchorAt(spans, at)} .. ${anchorAt(spans, at + to - from, "end")}`;
    }
    if (!range) {
      const from = resolvePoint(entry.at, spans);
      const duration =
        typeof entry.for === "number"
          ? entry.for
          : parseFloat(entry.for ?? (kind === "card" ? "2.2" : ".5")) *
            (String(entry.for).endsWith("ms") ? 0.001 : 1);
      range = `${entry.at} .. ${anchorAt(spans, from + duration, "end")}`;
    }
    let group =
      entry.review &&
      cards.find(
        (c) =>
          c.id === entry.review.id && c.range === range && !c.effects[kind],
      );
    // An agent need not know browser metadata: adjacent effects over the
    // same resolved range form the same card as a manual combination.
    const last = cards.at(-1);
    if (
      !group &&
      !entry.review &&
      last?.unmarked &&
      !last.effects[kind] &&
      !["card", "transition"].includes(kind) &&
      !Object.keys(last.effects).some((key) =>
        ["card", "transition"].includes(key),
      )
    ) {
      const a = resolveRange(last.range, spans),
        b = resolveRange(range, spans);
      if (a.every((value, i) => Math.abs(value - b[i]) < 0.00001)) group = last;
    }
    if (!group) {
      let id = entry.review?.id ?? `saved-${index}`;
      if (cards.some((card) => card.id === id))
        id = `part-${index}-${id.slice(0, 70)}`;
      group = {
        id,
        range,
        open: false,
        effects: {},
        originals: [],
        touched: false,
        unmarked: !entry.review,
      };
      cards.push(group);
    }
    group.effects[kind] = structuredClone(entry);
    group.originals.push(structuredClone(entry));
  }
  return cards;
}
export function defaultEffect(kind) {
  return structuredClone(
    {
      caption: { caption: "", box: [0.15, 0.78, 0.7, 0.15] },
      camera: { camera: { on: [0.5, 0.5], zoom: 1.4 } },
      speed: { speed: 1.5 },
      cut: { cut: "" },
      highlight: { highlight: [0.25, 0.25, 0.5, 0.5], style: "ring" },
      keys: { keys: "Ctrl+K", box: [0.6, 0.8, 0.32, 0.14] },
      card: { card: "Title", subtitle: "", for: 2.2 },
      transition: { transition: "dip" },
    }[kind],
  );
}
export function serializeCards(cards, spans) {
  return cards.flatMap((card) => {
    if (!card.touched && card.originals?.length)
      return structuredClone(card.originals);
    const [from, to] = resolveRange(card.range, spans);
    if (!(to > from))
      throw new Error("Each edit needs an end after its start.");
    return Object.entries(card.effects).map(([kind, effect]) => {
      const entry = structuredClone(effect);
      delete entry.over;
      delete entry.cut;
      delete entry.at;
      if (kind !== "card" && kind !== "camera") delete entry.for;
      if (kind === "cut") entry.cut = card.range;
      else if (kind === "card" || kind === "transition") {
        entry.at = card.range.split("..")[0].trim();
        entry.for =
          kind === "card"
            ? `${effectSeconds(effect.for)}s`
            : `${round(to - from)}s`;
      } else entry.over = card.range;
      entry.review = {
        id: card.id,
        collapsed: !card.open,
        ...(kind === "card" ? { range: card.range } : {}),
      };
      return entry;
    });
  });
}
