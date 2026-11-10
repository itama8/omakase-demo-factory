// Shared screen/camera geometry for both paused preview and rendered export.
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const px = n=>`${Number(n.toFixed(1))}px`;
export function overlayHtml(film) {
 const {width:W,height:H}=film;
 const highlight=(m,i)=>`<div id="highlight-${i}" class="highlight ${m.style}" style="left:${px(m.box.x*W)};top:${px(m.box.y*H)};width:${px(m.box.w*W)};height:${px(m.box.h*H)}"></div>`;
 const ripples=film.cursor.clicks.map((c,i)=>`<div id="ripple-${i}" class="ripple" style="left:${px(c.x*W)};top:${px(c.y*H)}"></div>`);
 const placed=b=>` style="inset:auto;left:${px(b[0]*W)};top:${px(b[1]*H)};width:${px(b[2]*W)};height:${px(b[3]*H)};align-items:center;justify-content:center"`;
 const captions=film.captions.map((c,i)=>`<div id="caption-${i}" class="clip caption ${c.position}${c.box?' placed':''}"${c.box?placed(c.box):''} data-start="${c.start}" data-duration="${c.duration}" data-track-index="3"><span>${escape(c.text)}</span></div>`);
 const keys=film.keys.map((k,i)=>`<div id="keys-${i}" class="keys ${k.position}${k.box?' placed':''}"${k.box?placed(k.box):''}>${k.label.split('+').map(s=>`<kbd>${escape(s.trim())}</kbd>`).join('')}</div>`);
 const cards=film.cards.map((c,i)=>`<section id="card-${i}" class="card"><h2>${escape(c.text)}</h2>${c.subtitle?`<p>${escape(c.subtitle)}</p>`:''}</section>`);
 return {camera:[...film.highlights.flatMap((m,i)=>m.space==='camera'?[highlight(m,i)]:[]),...ripples].join('\n'),screen:[...film.highlights.flatMap((m,i)=>m.space!=='camera'?[highlight(m,i)]:[]),...captions,...keys,...cards].join('\n')};
}
