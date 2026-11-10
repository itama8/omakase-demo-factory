// Everything the composition draws over the footage, as HTML made from the
// film plan. `camera` moves with the footage (highlights, click ripples);
// `screen` stays put (captions, key callouts, cards). The template animates
// them by id.
const W = 1920, H = 1080;
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const px = (n) => `${Number(n.toFixed(1))}px`;

export function overlayHtml(film) {
  const highlights = film.highlights.map((mark, i) => {
    // A little air around the element, so the ring does not sit on its edge.
    const pad = 8;
    return `<div id="highlight-${i}" class="highlight ${mark.style}" style="left:${px(mark.box.x * W - pad)};top:${px(mark.box.y * H - pad)};width:${px(mark.box.w * W + pad * 2)};height:${px(mark.box.h * H + pad * 2)}"></div>`;
  });
  const ripples = film.cursor.clicks.map((click, i) => `<div id="ripple-${i}" class="ripple" style="left:${px(click.x * W)};top:${px(click.y * H)}"></div>`);
  const captions = film.captions.map((caption, i) => `<div id="caption-${i}" class="clip caption ${caption.position}" data-start="${caption.start}" data-duration="${caption.duration}" data-track-index="3"><span>${escape(caption.text)}</span></div>`);
  const keys = film.keys.map((entry, i) => `<div id="keys-${i}" class="keys ${entry.position}">${entry.label.split("+").map((key) => `<kbd>${escape(key.trim())}</kbd>`).join("")}</div>`);
  const cards = film.cards.map((card, i) => `<section id="card-${i}" class="card"><h2>${escape(card.text)}</h2>${card.subtitle ? `<p>${escape(card.subtitle)}</p>` : ""}</section>`);
  return { camera: [...highlights, ...ripples].join("\n"), screen: [...captions, ...keys, ...cards].join("\n") };
}
