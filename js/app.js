import { COMBOS, WUBRG, parseColorQuery, suggestCombos, pipsHTML, symbolURL, comboName, comboByKey, sortKey, frameVars } from './colors.js';

/* =========================================================================
   Meta Grimoire: what's winning in cEDH, Modern, Standard and Legacy.
   Tournament data: ./data/*.json, rebuilt every morning by scripts/update.mjs.
   Card data, art and prices: Scryfall, live.
   ========================================================================= */

const FORMATS = { cedh: 'cEDH', modern: 'Modern', standard: 'Standard', legacy: 'Legacy' };
const FMT_KEYS = Object.keys(FORMATS);
const LEGAL_KEY = { cedh: 'commander', modern: 'modern', standard: 'standard', legacy: 'legacy' };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const main = $('#main');
const store = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const money = (v, cur = '$') => (v == null ? '–' : `${cur}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const finish = (rank) => (rank === 1 ? 'Won' : rank === 2 ? 'Finished second at' : rank <= 4 ? 'Made top 4 at' : rank <= 8 ? 'Made top 8 at' : 'Made top 16 at');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------------- data ---------------- */
const EMBED = (() => { try { return JSON.parse(document.getElementById('embedded-data')?.textContent || 'null'); } catch { return null; } })();
const jsonCache = new Map();
function getJSON(url) {
  if (EMBED?.files && url in EMBED.files) return Promise.resolve(EMBED.files[url]);
  if (!jsonCache.has(url)) {
    const p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: ${r.status}`))));
    jsonCache.set(url, p);
    p.catch(() => jsonCache.delete(url));
  }
  return jsonCache.get(url);
}
const loadMeta = () => getJSON('data/meta.json').catch(() => ({ updated: null, formats: {} }));
const loadEvents = (f) => getJSON(`data/events/${f}.json`).catch(() => []);
const loadDeck = (f, id) => getJSON(`data/decks/${f}-${id % 16}.json`).then((d) => d[id] || null).catch(() => null);
let cardsMap = {};
const cardsReady = getJSON('data/cards.json').then((m) => (cardsMap = m || {})).catch(() => {});

/* Scryfall, politely queued (about 10 requests a second at most, as their docs ask) */
let sfGate = Promise.resolve();
let sfLast = 0;
function sf(pathOrUrl, { fresh = false } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.scryfall.com${pathOrUrl}`;
  if (!fresh && jsonCache.has(url)) return jsonCache.get(url);
  const gate = sfGate.then(async () => {
    const wait = sfLast + 100 - performance.now();
    if (wait > 0) await sleep(wait);
    sfLast = performance.now();
  });
  sfGate = gate.catch(() => {});
  const p = gate
    .then(() => fetch(url, { headers: { Accept: 'application/json' } }))
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.details || `Scryfall answered ${r.status}`), { status: r.status });
      return j;
    });
  if (!fresh) {
    jsonCache.set(url, p);
    p.catch(() => jsonCache.delete(url));
  }
  return p;
}

const imgById = (id, ver = 'normal') => `https://cards.scryfall.io/${ver}/front/${id[0]}/${id[1]}/${id}.jpg`;
const imgByName = (name, ver = 'normal') => {
  const c = cardsMap[name];
  return c?.[0] ? imgById(c[0], ver) : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${ver}`;
};
const faceImgs = (card, ver = 'normal') => {
  if (card.image_uris) return [card.image_uris[ver]];
  return (card.card_faces || []).map((f) => f.image_uris?.[ver]).filter(Boolean);
};

/* ---------------- hover preview: follows the pointer on rAF, image decoded before it shows ---------------- */
const preview = (() => {
  const el = $('#preview');
  const [front, back] = $$('img', el);
  const decoded = new Set();
  let target = null, shown = false, mx = 0, my = 0, raf = 0, touchMode = false;
  const dims = () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const w = (matchMedia('(max-width: 860px)').matches ? 13.125 : 16.25) * rem;
    return { w: el.classList.contains('dfc') ? w * 2 + 8 : w, h: Math.round((w * 680) / 488) };
  };
  function place() {
    raf = 0;
    const { w, h } = dims();
    let x, y;
    if (touchMode) {
      x = (innerWidth - w) / 2;
      y = (innerHeight - h) / 2;
    } else {
      x = mx + 28;
      if (x + w > innerWidth - 10) x = mx - 28 - w;
      x = Math.max(10, x);
      y = Math.min(Math.max(my - h / 2, 10), innerHeight - h - 10);
    }
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }
  const urlsFor = (t) => (t.dataset.img ? [t.dataset.img, t.dataset.img2].filter(Boolean) : t.dataset.card ? [imgByName(t.dataset.card)] : []);
  function decode(url) {
    if (decoded.has(url)) return Promise.resolve();
    const im = new Image();
    im.decoding = 'async';
    im.src = url;
    return (im.decode ? im.decode() : new Promise((r) => (im.onload = r))).then(() => decoded.add(url)).catch(() => {});
  }
  function show(t, touch = false) {
    target = t;
    touchMode = touch;
    const [a, b] = urlsFor(t);
    if (!a) return;
    Promise.all([decode(a), b ? decode(b) : null]).then(() => {
      if (target !== t) return;
      front.src = a;
      el.classList.toggle('dfc', !!b);
      if (b) back.src = b;
      place();
      el.classList.add('show');
      shown = true;
    });
  }
  function hide() { target = null; shown = false; el.classList.remove('show'); }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest?.('[data-card],[data-img]');
    if (!t || t === target) return;
    mx = e.clientX; my = e.clientY;
    show(t);
  });
  document.addEventListener('pointerout', (e) => {
    if (!target || e.pointerType === 'touch') return;
    if (e.relatedTarget?.closest?.('[data-card],[data-img]') !== target) hide();
  });
  document.addEventListener('pointermove', (e) => {
    mx = e.clientX; my = e.clientY;
    if (shown && !touchMode && !raf) raf = requestAnimationFrame(place);
  }, { passive: true });
  // phones: tap a card name to see it large, tap anywhere to put it away
  document.addEventListener('click', (e) => {
    if (!touchMode && !matchMedia('(hover: none)').matches) return;
    const t = e.target.closest?.('[data-card]');
    if (t && !t.closest('a,button') && t !== target) { show(t, true); return; }
    if (shown) hide();
  });
  addEventListener('scroll', () => { if (shown && touchMode) hide(); }, { passive: true });
  return { hide, warm: (urls) => urls.forEach((u) => decode(u)) };
})();

/* ---------------- official art in page heads (Scryfall art_crop, artist credited) ---------------- */
const ART_POOLS = {
  home: ['Ragavan, Nimble Pilferer', 'The One Ring', 'Force of Will', 'Sheoldred, the Apocalypse', "Thassa's Oracle", 'Orcish Bowmasters', 'Atraxa, Grand Unifier', 'Murktide Regent', "Urza's Saga", 'Emrakul, the Aeons Torn'],
  events: ['Elesh Norn, Mother of Machines', 'Teferi, Time Raveler', 'Solitude', 'Grief', 'Fury', 'Archon of Cruelty'],
  colors: ['Niv-Mizzet, Parun', 'Kenrith, the Returned King', 'Jodah, the Unifier', 'Omnath, Locus of Creation', 'Najeela, the Blade-Blossom', 'Tymna the Weaver'],
  cards: ['Jace, the Mind Sculptor', 'Mox Opal', 'Brainstorm', 'Lightning Bolt', 'Dark Ritual', 'Sol Ring'],
  deck: ['Wrenn and Six', 'Thoughtseize', 'Snapcaster Mage', 'Fable of the Mirror-Breaker', 'Ponder', 'Counterspell'],
};
async function loadArt(scope) {
  const box = $(`[data-art="${scope}"]`, main);
  if (!box) return;
  const pool = ART_POOLS[scope];
  const name = pool[Math.floor(Math.random() * pool.length)];
  try {
    const c = await sf(`/cards/named?exact=${encodeURIComponent(name)}`);
    const face = c.image_uris ? c : c.card_faces?.[0];
    const url = face?.image_uris?.art_crop;
    if (!url) return;
    await new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = rej; i.src = url; });
    const art = $('.head-art', box);
    art.style.backgroundImage = `url("${url}")`;
    art.classList.add('ready');
    const credit = $('.credit', box);
    credit.innerHTML = `<a href="${esc(c.scryfall_uri)}" target="_blank" rel="noopener" data-img="${esc(faceImgs(c)[0])}">${esc(c.name)}</a>, illustrated by ${esc(face.artist || c.artist)}. © Wizards of the Coast`;
    credit.hidden = false;
  } catch {}
}
const headHTML = (scope, left, right = '') => `
  <div class="head" data-art="${scope}">
    <div class="head-art"></div>
    <div class="wrap head-inner"><div>${left}</div><div>${right}</div></div>
    <p class="credit" hidden></p>
  </div>`;

/* ---------------- three random cards, a fresh three on every page switch ---------------- */
const RANDOM_Q = encodeURIComponent('game:paper -is:funny -t:basic -is:token (r:r or r:m)');
const handBuf = [];
let handFill = null;
async function fetchRandomCard() {
  const c = await sf(`/cards/random?q=${RANDOM_Q}`, { fresh: true });
  const imgs = faceImgs(c);
  if (!imgs[0]) return null;
  await new Promise((r) => { const i = new Image(); i.onload = r; i.onerror = r; i.src = imgs[0]; });
  return { name: c.name, img: imgs[0], img2: imgs[1], card: c };
}
function refillHand() {
  if (handFill) return handFill;
  handFill = (async () => {
    while (handBuf.length < 6) {
      const c = await fetchRandomCard().catch(() => null);
      if (c) handBuf.push(c); else break;
    }
  })().finally(() => (handFill = null));
  return handFill;
}
async function renderHand(box) {
  if (!box) return;
  box.innerHTML = '<div class="fcard"></div><div class="fcard"></div><div class="fcard"></div>';
  const picks = handBuf.splice(0, 3);
  if (picks.length < 3) {
    const more = await Promise.all(Array.from({ length: 3 - picks.length }, () => fetchRandomCard().catch(() => null)));
    picks.push(...more.filter(Boolean));
  }
  if (!box.isConnected) { handBuf.unshift(...picks); return; }
  $$('.fcard', box).forEach((el, i) => {
    const p = picks[i];
    if (!p) return;
    el.innerHTML = `<img src="${esc(p.img)}" alt="${esc(p.name)}" decoding="async">`;
    el.dataset.img = p.img;
    if (p.img2) el.dataset.img2 = p.img2;
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('click', () => openCard(p.card));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openCard(p.card); });
    setTimeout(() => el.classList.add('in'), 80 * i);
  });
  refillHand(); // load the next three now so the next switch is instant
}

/* ---------------- page size: scales every rem-based measure together ---------------- */
const ZOOM_STEPS = [0.8, 0.87, 0.93, 1, 1.07, 1.15];
const BASE_PCT = 93.75; // design default: 15px text on a 16px browser
function setZoom(i, save = true) {
  i = Math.max(0, Math.min(ZOOM_STEPS.length - 1, i));
  document.documentElement.style.fontSize = `${BASE_PCT * ZOOM_STEPS[i]}%`;
  const out = $('.zoom output');
  if (out) out.textContent = `${Math.round(ZOOM_STEPS[i] * 100)}%`;
  $$('.zoom button').forEach((b) => (b.disabled = (b.dataset.z === '-1' && i === 0) || (b.dataset.z === '1' && i === ZOOM_STEPS.length - 1)));
  if (save) try { localStorage.setItem('pageZoom', String(i)); } catch {}
  setZoom.i = i;
}
$('.topbar').insertAdjacentHTML('beforeend', '<div class="zoom" role="group" aria-label="Page size"><button data-z="-1" aria-label="Make the page smaller">−</button><output aria-live="polite"></output><button data-z="1" aria-label="Make the page larger">+</button></div>');
$$('.zoom button').forEach((b) => b.addEventListener('click', () => setZoom(setZoom.i + Number(b.dataset.z))));
setZoom((() => { try { const v = localStorage.getItem('pageZoom'); return v == null ? 3 : Number(v); } catch { return 3; } })(), false);

/* ---------------- router ---------------- */
let viewKeys = null; // per-view keyboard handler
addEventListener('keydown', (e) => { if (!e.target.closest('input, textarea') && $('#modal').hidden) viewKeys?.(e); });
const routes = { home: viewHome, events: viewEvents, deck: viewDeck, colors: viewColors, cards: viewCards, printings: viewPrintings };
let renderToken = 0;
async function router() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const name = routes[parts[0]] ? parts[0] : 'home';
  $$('.mainnav a').forEach((a) => {
    const on = a.dataset.nav === (name === 'deck' ? 'events' : name === 'printings' ? 'cards' : name);
    a.classList.toggle('active', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  preview.hide();
  closeModal();
  viewKeys = null;
  const token = ++renderToken;
  main.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await routes[name](parts.slice(1), token);
  } catch (e) {
    console.error(e);
    if (token === renderToken) main.innerHTML = `<div class="wrap note">This page couldn't load: ${esc(e.message)}. Reload to try again.</div>`;
  }
  if (token === renderToken) {
    renderHand($('[data-flair]', main));
    scrollTo({ top: 0, behavior: 'instant' });
  }
}
const stale = (token) => token !== renderToken;
addEventListener('hashchange', router);

/* ---------------- shared bits ---------------- */
const deckHref = (fmt, id) => `#/deck/${fmt}/${id}`;
const fmtSeg = (active, base) => `<nav class="seg" aria-label="Format">${FMT_KEYS.map((f) => `<a href="${base}${f}" class="${active === f ? 'on' : ''}" ${active === f ? 'aria-current="page"' : ''}>${FORMATS[f]}</a>`).join('')}</nav>`;
const noData = () => `<div class="note">No tournament data yet. In the GitHub repo, open the Actions tab and run “Daily meta update”. After that first run it updates itself every morning.</div>`;
const artUrl = (id) => imgById(id, 'art_crop');

/* =========================================================================
   HOME
   ========================================================================= */
async function viewHome([fmtArg], token) {
  if (FORMATS[fmtArg]) store.set('homeFmt', fmtArg);
  const meta = await loadMeta();
  if (stale(token)) return;
  const fmt = store.get('homeFmt', 'modern');
  const win = store.get('homeWin', 'week');
  const revealed = store.get('revealed', false);
  const total = Object.values(meta.formats || {}).reduce((a, f) => a + (f.events || 0), 0);
  const opt = (kind, v, label, on) => `<button class="opt" data-${kind}="${v}" aria-pressed="${on}">${label}</button>`;

  main.innerHTML = `
    ${headHTML('home', `
      <h1 class="say">What's winning in
        ${FMT_KEYS.map((f) => opt('fmt', f, FORMATS[f], f === fmt)).join(' <span class="sep">/</span> ')}
        this ${opt('win', 'week', 'week', win === 'week')} <span class="sep">/</span> ${opt('win', 'month', 'month', win === 'month')}</h1>
      <p class="stamp">${EMBED?.sample ? 'Preview build with sample tournament results. Card search, art, previews and prices are live from Scryfall.' : meta.updated ? `Updated ${new Date(meta.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}, from ${plural(total, 'tournament')}.` : 'Waiting for the first tournament sync.'}</p>`,
    `<div class="hand" data-flair aria-label="Three random cards"></div>
      <div class="deal-row"><p>Three random cards. Switch pages for three more.</p>
        <button class="btn" id="reveal">${revealed ? 'Jump to the top 10' : 'Reveal the top 10'}</button></div>`)}
    <section class="block wrap" id="top10" ${revealed ? '' : 'hidden'}>
      <div class="block-head"><div><h2 id="t10title"></h2>
        <p>Ranked by wins and top 8 finishes, weighted by event size, with extra credit for majors and qualifiers. Each card opens the archetype's best list.</p></div></div>
      <div class="top10" id="top10list"></div>
    </section>
    <section class="block wrap">
      <div class="block-head"><h2>Latest winners</h2><a href="#/events/${fmt}">All ${FORMATS[fmt]} tournaments</a></div>
      <div id="winners"></div>
    </section>`;
  loadArt('home');

  const sync = () => {
    $$('[data-fmt]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.fmt === store.get('homeFmt', 'modern')));
    $$('[data-win]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.win === store.get('homeWin', 'week')));
    if (!$('#top10').hidden) drawTop10(meta);
  };
  $$('[data-fmt]').forEach((b) => b.addEventListener('click', () => { store.set('homeFmt', b.dataset.fmt); sync(); }));
  $$('[data-win]').forEach((b) => b.addEventListener('click', () => { store.set('homeWin', b.dataset.win); sync(); }));
  $('#reveal').addEventListener('click', () => {
    const sec = $('#top10');
    const first = sec.hidden;
    sec.hidden = false;
    store.set('revealed', true);
    $('#reveal').textContent = 'Jump to the top 10';
    drawTop10(meta);
    if (first) deal($('#top10list'), $('[data-flair]'));
    setTimeout(() => sec.scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'start' }), first ? 420 : 0);
  });
  if (revealed) drawTop10(meta);

  const winners = FMT_KEYS.flatMap((f) => (meta.formats?.[f]?.recent || []).slice(0, 2).map((ev) => ({ f, ev }))).filter((x) => x.ev.winner);
  $('#winners').innerHTML = winners.length
    ? `<div class="ledger winners">${winners.map(({ f, ev }) => `
      <a class="row" href="${deckHref(f, ev.winner.deckId)}" style="${frameVars(ev.winner.colors)}">
        <span class="stripe"></span>
        <span class="main"><strong>${esc(ev.winner.name)}</strong> ${pipsHTML(ev.winner.colors, 16)}<span>${esc(ev.winner.player)} won ${esc(ev.name)}${ev.major ? ', a major event' : ''}</span></span>
        <span class="side">${FORMATS[f]}<br>${fmtDate(ev.date)}</span>
      </a>`).join('')}</div>`
    : noData();
}

/* One archetype, drawn as a Magic card. Frame = color identity, art = its signature card. */
function archCard(a, fmt, win) {
  const sentences = [
    a.wins ? `Won ${plural(a.wins, 'event')}, with ${plural(a.top8, 'top 8 finish', 'top 8 finishes')} across ${plural(a.events, 'tournament')} this ${win}.` : `${plural(a.top8, 'top 8 finish', 'top 8 finishes')} across ${plural(a.events, 'tournament')} this ${win}, still looking for a win.`,
    a.majorTop8 ? `<span class="extra">${a.majorTop8} of those came at majors or qualifiers.</span>` : '',
    a.trend === 'new' ? 'New to the top 10.' : a.trend > 0 ? `Up ${a.trend} from last ${win}.` : a.trend < 0 ? `Down ${-a.trend} from last ${win}.` : 'Holding its place.',
  ].filter(Boolean).join(' ');
  const flavor = a.best ? `<p class="flavor extra">${finish(a.best.rank)} ${esc(a.best.event)}${a.best.player ? `, piloted by ${esc(a.best.player)}` : ''}.</p>` : '';
  const art = a.sig
    ? `<img src="${esc(a.sig.id ? artUrl(a.sig.id) : imgByName(a.sig.name, 'art_crop'))}" alt="" loading="lazy" decoding="async">`
    : `<span class="noart">${pipsHTML(a.colors, 40)}</span>`;
  const href = a.best ? deckHref(fmt, a.best.deckId) : `#/events/${fmt}`;
  return `<a class="mcard" href="${href}" style="${frameVars(a.colors)}" aria-label="Number ${a.rank}, ${esc(a.name)}. ${a.wins} wins, ${a.top8} top 8 finishes. Open the best list.">
    <span class="frame">
      <span class="bar"><span class="name">${esc(a.name)}</span><span class="cost">${pipsHTML(a.colors, 14)}</span></span>
      <span class="art" ${a.sig ? `data-card="${esc(a.sig.name)}"` : ''}>${art}</span>
      <span class="bar type"><span>Archetype, ${FORMATS[fmt]}</span><span class="rank">#${a.rank}</span></span>
      <span class="textbox"><p>${sentences}</p>${flavor}</span>
      <span class="foot"><span ${a.sig && !a.sig.artist ? `data-sig="${esc(a.sig.name)}"` : ''}>${a.sig ? `${esc(a.sig.name)}${a.sig.artist ? `, illus. ${esc(a.sig.artist)}` : ''}` : ''}</span><span>© WotC</span></span>
    </span>
    <span class="pt" title="${a.wins} wins / ${a.top8} top 8 finishes">${a.wins}/${a.top8}</span>
  </a>`;
}

function drawTop10(meta) {
  const fmt = store.get('homeFmt', 'modern');
  const win = store.get('homeWin', 'week');
  const list = meta.formats?.[fmt]?.top?.[win] || [];
  $('#t10title').textContent = `Top 10 ${FORMATS[fmt]} decks this ${win}`;
  const box = $('#top10list');
  if (!list.length) {
    box.innerHTML = meta.updated ? `<div class="note" style="grid-column:1/-1">No ${FORMATS[fmt]} results in this window yet.</div>` : `<div style="grid-column:1/-1">${noData()}</div>`;
    return;
  }
  box.innerHTML = list.map((a) => archCard(a, fmt, win)).join('');
  // art credit is required next to art crops; look up any artist the data doesn't carry
  $$('[data-sig]', box).forEach(async (el) => {
    try {
      const c = await sf(`/cards/named?exact=${encodeURIComponent(el.dataset.sig)}`);
      el.textContent = `${el.dataset.sig}, illus. ${(c.card_faces?.[0] || c).artist || c.artist}`;
    } catch {}
  });
}

/* The one choreographed moment: the ten cards are dealt out of the hand. */
function deal(grid, from) {
  if (REDUCED.matches || !grid || !from) return;
  const f = from.getBoundingClientRect();
  const fx = f.left + f.width / 2, fy = f.top + f.height / 2;
  $$('.mcard', grid).forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const dx = fx - (r.left + r.width / 2), dy = fy - (r.top + r.height / 2);
    c.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(${i % 2 ? 9 : -9}deg) scale(.42)`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 760, delay: 120 + i * 65, easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'backwards' },
    );
  });
}

/* =========================================================================
   TOURNAMENTS
   ========================================================================= */
async function viewEvents([fmtArg], token) {
  const fmt = FORMATS[fmtArg] ? fmtArg : store.get('homeFmt', 'modern');
  const events = await loadEvents(fmt);
  if (stale(token)) return;
  main.innerHTML = `
    ${headHTML('events', `<h1>${FORMATS[fmt]} tournaments</h1><p class="lede">Every event tracked in the last 120 days. Open one to see its top finishers, then any deck for the full list.</p>`, '<div class="hand small" data-flair></div>')}
    <section class="block wrap">
      <div class="block-head">${fmtSeg(fmt, '#/events/')}
        <input class="field" style="max-width:360px" id="evq" type="search" placeholder="Filter by event, deck or player" aria-label="Filter tournaments" autocomplete="off">
      </div>
      <div class="ledger" id="evlist"></div>
      <p style="text-align:center;margin-top:18px"><button class="btn quiet sm" id="more" hidden>Show 30 more</button></p>
    </section>`;
  loadArt('events');
  if (!events.length) { $('#evlist').outerHTML = noData(); return; }

  let filtered = events, shown = 0;
  const PAGE = 30;
  const row = (ev) => {
    const w = ev.top.find((d) => d.rank === 1) || ev.top[0];
    const facts = [ev.major && 'Major event', fmtDate(ev.date), ev.players && plural(ev.players, 'player'), ev.location].filter(Boolean).join(', ');
    return `<div class="event">
      <div class="row click" role="button" tabindex="0" aria-expanded="false" style="${frameVars(w?.colors)}">
        <span class="stripe"></span>
        <span class="main"><strong>${esc(ev.name)}</strong><span>${esc(facts)}</span></span>
        ${w ? `<span class="side">Won by <b style="color:var(--text);font-weight:600">${esc(w.name)}</b> ${pipsHTML(w.colors, 16)}</span>` : ''}
      </div>
      <div class="standings">${ev.top.map((d) => `
        <a class="standing" href="${deckHref(fmt, d.deckId)}"><span class="r">${esc(d.rankLabel || d.rank)}</span><span>${esc(d.name)}</span><span>${pipsHTML(d.colors, 16)}</span><span class="pl">${esc(d.player)}</span></a>`).join('')}
        ${EMBED?.sample ? '' : `<p class="fine" style="margin:8px 10px 0"><a href="https://www.mtgtop8.com/event?e=${ev.id}" target="_blank" rel="noopener">Open this event on MTGTop8</a></p>`}
      </div></div>`;
  };
  const draw = (reset) => {
    if (reset) { $('#evlist').innerHTML = ''; shown = 0; }
    const next = filtered.slice(shown, shown + PAGE);
    $('#evlist').insertAdjacentHTML('beforeend', next.map(row).join('') || (shown ? '' : '<p class="note" style="border:0;margin:0">Nothing matches that filter. Try a deck name like “Murktide” or a player.</p>'));
    shown += next.length;
    $('#more').hidden = shown >= filtered.length;
  };
  draw(true);
  $('#more').addEventListener('click', () => draw(false));
  const toggle = (rowEl) => {
    const ev = rowEl.parentElement;
    ev.classList.toggle('open');
    rowEl.setAttribute('aria-expanded', ev.classList.contains('open'));
  };
  $('#evlist').addEventListener('click', (e) => { const r = e.target.closest('.row.click'); if (r) toggle(r); });
  $('#evlist').addEventListener('keydown', (e) => { const r = e.target.closest('.row.click'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(r); } });
  $('#evq').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    filtered = !q ? events : events.filter((ev) => ev.name.toLowerCase().includes(q) || ev.top.some((d) => d.name.toLowerCase().includes(q) || d.player.toLowerCase().includes(q)));
    draw(true);
    if (q) $$('.row.click', $('#evlist')).slice(0, 5).forEach(toggle);
  }, 180));
}

/* =========================================================================
   DECK
   ========================================================================= */
async function viewDeck([fmt, idStr], token) {
  if (!FORMATS[fmt]) return viewEvents([], token);
  const id = Number(idStr);
  const [events, list] = await Promise.all([loadEvents(fmt), loadDeck(fmt, id), cardsReady]);
  if (stale(token)) return;
  let ev, entry;
  for (const e of events) { const d = e.top.find((x) => x.deckId === id); if (d) { ev = e; entry = d; break; } }
  let mode = store.get('deckMode', 'text');
  if (!['text', 'stacks', 'table'].includes(mode)) mode = 'text';
  const story = entry
    ? `${finish(entry.rank)} ${esc(ev.name)} on ${fmtDate(ev.date)}, piloted by ${esc(entry.player)}.${ev.players ? ` ${ev.players} players.` : ''}`
    : 'This list is older than the 60-day archive.';
  const isCmd = fmt === 'cedh';
  const total = list ? countRows(list.m) : 0;
  const side = list ? countRows(list.s) : 0;
  const need = isCmd ? 100 : 60;
  const countLine = !list ? '' : total >= need
    ? (isCmd ? `${total} cards, commander included.` : `${total}-card main deck${side ? ` and ${side}-card sideboard` : ''}.`)
    : `This list has ${total} cards instead of ${need}. The source page may be missing some; check it on MTGTop8.`;

  main.innerHTML = `
    ${headHTML('deck', `
      <a class="back" href="#/events/${fmt}">${FORMATS[fmt]} tournaments</a>
      <h1>${esc(entry?.name || 'Decklist')} ${pipsHTML(entry?.colors, 30)}</h1>
      <p class="lede">${story}</p>
      ${list ? `<p class="count ${total >= need ? '' : 'warn'}">${countLine}</p>` : ''}
      <div class="actions">
        ${list ? `<button class="btn" id="copy">Copy decklist</button>
        <span class="seg" role="group" aria-label="View"><button data-mode="text" aria-pressed="${mode === 'text'}">List</button><button data-mode="stacks" aria-pressed="${mode === 'stacks'}">Stacks</button><button data-mode="table" aria-pressed="${mode === 'table'}">On the table</button></span>` : ''}
        ${EMBED?.sample ? '' : `<a class="btn quiet" href="https://www.mtgtop8.com/event?e=${ev?.id || ''}&d=${id}" target="_blank" rel="noopener">Open on MTGTop8</a>`}
      </div>`, '<div class="hand small" data-flair></div>')}
    <section class="block wrap" id="deckbody"></section>`;
  loadArt('deck');
  if (!list) { $('#deckbody').innerHTML = '<div class="note">This decklist isn\'t stored here anymore. Open it on MTGTop8 instead.</div>'; return; }
  let deckOpen = () => {};

  const info = (n) => cardsMap[n] || null; // [id, colorIdentity, isLand, cmc, artist, type]
  const isLand = (n) => info(n)?.[2] === 1 || info(n)?.[5] === 'L';
  const mv = (n) => info(n)?.[3];
  const byCmc = (a, b) => (mv(a[1]) ?? 99) - (mv(b[1]) ?? 99) || a[1].localeCompare(b[1]);
  const cmdr = new Set(list.c || []);
  const body = list.m.filter(([, n]) => !cmdr.has(n));
  const groupsNow = () => [
    ['Commander', list.m.filter(([, n]) => cmdr.has(n))],
    ['Spells', body.filter(([, n]) => !isLand(n)).sort(byCmc)],
    ['Lands', body.filter(([, n]) => isLand(n)).sort((a, b) => a[1].localeCompare(b[1]))],
    ['Sideboard', [...list.s].sort(byCmc)],
  ].filter(([, g]) => g.length);
  const featured = list.c?.[0] || body.find(([, n]) => !isLand(n))?.[1] || list.m[0][1];

  // 60-card decks are laid out by mana value; cEDH by card type, in the order players sort them
  const mvColumns = (rows) => {
    const by = new Map();
    for (const r of rows) {
      const v = mv(r[1]);
      const k = v == null ? 'Spells' : v <= 1 ? '1 or less' : v >= 6 ? '6+' : String(v);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    return ['1 or less', '2', '3', '4', '5', '6+', 'Spells'].filter((k) => by.has(k)).map((k) => [k === 'Spells' ? k : `Mana value ${k}`, by.get(k).sort((a, b) => a[1].localeCompare(b[1]))]);
  };
  const TYPE_ORDER = [['C', 'Creatures'], ['I', 'Instants'], ['S', 'Sorceries'], ['E', 'Enchantments'], ['A', 'Artifacts'], ['P', 'Planeswalkers'], ['B', 'Battles'], ['O', 'Other']];
  const typeColumns = (rows) => {
    const by = new Map();
    for (const r of rows) {
      const t = info(r[1])?.[5] || 'O';
      if (!by.has(t)) by.set(t, []);
      by.get(t).push(r);
    }
    return TYPE_ORDER.filter(([t]) => by.has(t)).map(([t, label]) => [label, by.get(t).sort(byCmc)]);
  };
  const layout = () => {
    const g = Object.fromEntries(groupsNow());
    const cols = [];
    if (g.Commander) cols.push(['Commander', g.Commander]);
    cols.push(...(isCmd ? typeColumns(g.Spells || []) : mvColumns(g.Spells || [])));
    if (g.Lands) cols.push(['Lands', g.Lands]);
    return { cols, side: g.Sideboard || [] };
  };

  const listHTML = () => `<div class="deck-layout"><div class="sheet">${groupsNow().map(([t, g]) => `
      <h4>${t}<span>${countRows(g)}</span></h4>${g.map(([q, n]) => `<button type="button" class="cline" data-card="${esc(n)}" title="See every printing of ${esc(n)}"><span class="q">${q}</span><span class="nm">${esc(n)}</span></button>`).join('')}`).join('')}
    </div><div class="featured"><img id="feat" src="${esc(imgByName(featured))}" alt="${esc(featured)}" decoding="async"></div></div>`;

  const stacksHTML = () => {
    const { cols, side } = layout();
    if (side.length) cols.push(['Sideboard', side]);
    return `<div class="stacks">${cols.map(([t, g]) => `<div class="stack-col"><h3>${t}</h3><p>${plural(countRows(g), 'card')}</p>
      <div class="stack">${g.map(([q, n]) => `<figure class="sc ${q > 1 ? 'many' : ''}" data-card="${esc(n)}" tabindex="0" role="button" aria-label="${esc(n)}, see every printing"><img loading="lazy" decoding="async" src="${esc(imgByName(n))}" alt="${esc(n)}">${q > 1 ? `<figcaption class="q">${q}</figcaption>` : ''}</figure>`).join('')}</div></div>`).join('')}</div>`;
  };

  const tableHTML = () => {
    const { cols, side } = layout();
    let i = 0;
    const pile = (rows) => rows.map(([q, n]) => Array.from({ length: q }, (_, k) => `<img class="tc ${k ? 'copy' : ''}" style="--i:${i++}" data-card="${esc(n)}" src="${esc(imgByName(n))}" alt="${k ? '' : esc(n)}" decoding="async" draggable="false">`).join('')).join('');
    const zone = ([t, rows], extra = '') => `<div class="tzone ${extra}"><h4>${t}<span>${countRows(rows)}</span></h4><div class="tpile">${pile(rows)}</div></div>`;
    const tallest = Math.max(...[...cols, ['', side]].map(([, r]) => countRows(r) + r.length * 2));
    const fit = Math.min(0.95, Math.max(0.64, 1.25 - tallest / 90)) * (matchMedia('(max-width: 860px)').matches ? 0.6 : 1);
    return `<div class="tscene ${tallest > 40 ? 'tall' : ''}" style="--rx:50deg;--rz:-4deg;--tz:${fit.toFixed(2)}">
      <div class="table3d"><div class="mat" style="${frameVars(entry?.colors)}">
        <div class="mat-title">${esc(entry?.name || 'Decklist')}</div>
        <div class="zones">${cols.map((c) => zone(c, c[0] === 'Commander' ? 'cmd' : c[0] === 'Lands' ? 'lands' : '')).join('')}${side.length ? zone(['Sideboard', side], 'sb') : ''}</div>
        <div class="d20" aria-hidden="true"><span>${isCmd ? 40 : 20}</span></div>
      </div></div>
      <div class="tcontrols">
        <span class="seg" role="group" aria-label="Camera"><button data-cam="flat">From above</button><button data-cam="angled" aria-pressed="true">Seated</button><button data-cam="low">Low angle</button></span>
        <span class="seg" role="group" aria-label="Table zoom"><button data-tz="-1" aria-label="Zoom out">−</button><button data-tz="1" aria-label="Zoom in">+</button></span>
        <button class="btn quiet sm" id="redeal">Deal again</button>
        <span class="soft">Drag the table to turn it. Hover a card to read it, click it to see every printing.</span>
      </div>
    </div>`;
  };

  const dealTable = () => {
    if (REDUCED.matches) return;
    $$('.tc', $('#deckbody')).forEach((c) => {
      const i = Number(c.style.getPropertyValue('--i'));
      c.animate([{ transform: 'translate3d(0, -18rem, 14rem) rotate(-14deg)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'none', opacity: 1 }],
        { duration: 520, delay: Math.min(i * 14, 1400), easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'backwards' });
    });
  };
  const wireTable = () => {
    const scene = $('.tscene');
    const st = { rx: 50, rz: -4, tz: parseFloat(scene.style.getPropertyValue('--tz')) };
    const apply = () => { scene.style.setProperty('--rx', `${st.rx}deg`); scene.style.setProperty('--rz', `${st.rz}deg`); scene.style.setProperty('--tz', st.tz); };
    let drag = null;
    scene.addEventListener('pointerdown', (e) => { if (e.target.closest('.tcontrols')) return; drag = { x: e.clientX, y: e.clientY, rx: st.rx, rz: st.rz, card: e.target.closest('[data-card]')?.dataset.card }; scene.setPointerCapture(e.pointerId); scene.classList.add('grabbing'); });
    scene.addEventListener('pointermove', (e) => {
      if (!drag) return;
      st.rz = Math.max(-40, Math.min(40, drag.rz + (e.clientX - drag.x) * 0.18));
      st.rx = Math.max(0, Math.min(68, drag.rx - (e.clientY - drag.y) * 0.18));
      apply();
    });
    const end = (e) => {
      const tap = drag && e.type === 'pointerup' && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6 && drag.card;
      const name = tap ? drag.card : null;
      drag = null;
      scene.classList.remove('grabbing');
      if (name) deckOpen(name);
    };
    scene.addEventListener('pointerup', end);
    scene.addEventListener('pointercancel', end);
    const CAMS = { flat: [0, 0], angled: [50, -4], low: [64, 8] };
    $$('[data-cam]', scene).forEach((b) => b.addEventListener('click', () => {
      [st.rx, st.rz] = CAMS[b.dataset.cam];
      scene.classList.add('easing');
      apply();
      setTimeout(() => scene.classList.remove('easing'), 600);
      $$('[data-cam]', scene).forEach((x) => x.setAttribute('aria-pressed', x === b));
    }));
    $$('[data-tz]', scene).forEach((b) => b.addEventListener('click', () => { st.tz = Math.max(0.4, Math.min(1.6, st.tz + Number(b.dataset.tz) * 0.12)); scene.classList.add('easing'); apply(); setTimeout(() => scene.classList.remove('easing'), 400); }));
    $('#redeal').addEventListener('click', dealTable);
  };

  const draw = async () => {
    const m = store.get('deckMode', 'text');
    const box = $('#deckbody');
    if (m !== 'text') {
      const names = [...new Set([...list.m, ...list.s].map(([, n]) => n))];
      if (names.some((n) => !cardsMap[n]?.[0] || !cardsMap[n]?.[5])) {
        box.innerHTML = '<div class="loading">Sorting the cards…</div>';
        await enrichCards(names);
        if (stale(token) || store.get('deckMode', 'text') !== m) return;
      }
    }
    box.innerHTML = m === 'text' ? listHTML() : m === 'stacks' ? stacksHTML() : tableHTML();
    if (m === 'table') { wireTable(); dealTable(); }
  };
  const openPrintings = (name) => {
    preview.hide();
    store.set('printingsBack', { name, hash: location.hash, label: `${entry?.name || 'Decklist'} decklist` });
    location.hash = `#/printings/${encodeURIComponent(name)}`;
  };
  $('#deckbody').addEventListener('click', (e) => {
    if (e.target.closest('.tscene')) return; // the table handles its own taps (it can be dragged)
    const t = e.target.closest('[data-card]');
    if (t) openPrintings(t.dataset.card);
  });
  $('#deckbody').addEventListener('keydown', (e) => {
    const t = e.target.closest('figure[data-card]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPrintings(t.dataset.card); }
  });
  deckOpen = openPrintings;
  await draw();
  $('#deckbody').addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-card]');
    const feat = $('#feat');
    if (t && feat) feat.src = imgByName(t.dataset.card);
  });
  preview.warm(list.m.slice(0, 12).map(([, n]) => imgByName(n)));
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    store.set('deckMode', b.dataset.mode);
    $$('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    draw();
  }));
  $('#copy').addEventListener('click', async () => {
    const lines = [
      ...(list.c?.length ? ['Commander', ...list.c.map((n) => `1 ${n}`), ''] : []),
      ...body.map(([q, n]) => `${q} ${n}`),
      ...(list.s.length ? ['', 'Sideboard', ...list.s.map(([q, n]) => `${q} ${n}`)] : []),
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Decklist copied'); } catch { toast('Your browser blocked copying. Select the list instead.'); }
  });
}

/* =========================================================================
   COLORS: the color pie
   ========================================================================= */
const PLACE = (r) => (r === 1 ? 10 : r === 2 ? 7 : r <= 4 ? 5 : r <= 8 ? 3 : 1);
const PIE_ANGLE = { W: -90, U: -18, B: 54, R: 126, G: 198 };
async function viewColors([arg], token) {
  const selected = arg != null && arg !== '' ? (arg === 'C' ? '' : parseColorQuery(arg) ?? sortKey(arg)) : null;
  const mode = store.get('colorMode', 'exact');
  const fsel = store.get('colorFmt', 'all');
  const combo = selected != null ? comboByKey(selected) : null;

  main.innerHTML = `
    ${headHTML('colors', `<h1>Find decks by color</h1><p class="lede">Pick colors on the pie, or type a name: a guild like Boros or Izzet, a shard like Grixis or Esper, a wedge, a four-color name like Glint-Eye, or just “UR”.</p>`, '<div class="hand small" data-flair></div>')}
    <section class="block wrap">
      <div class="pie-layout">
        <div class="pie" role="group" aria-label="Color pie">
          ${WUBRG.map((c) => { const a = (PIE_ANGLE[c] * Math.PI) / 180; return `<button class="mana" data-mana="${c}" aria-pressed="${selected != null && selected.includes(c)}" aria-label="${c}" style="left:${50 + 41 * Math.cos(a)}%;top:${50 + 41 * Math.sin(a)}%"><img src="${symbolURL(c)}" alt=""></button>`; }).join('')}
          <div class="center"><div><strong>${selected != null ? esc(combo?.name || selected) : 'Pick colors'}</strong><span>${selected != null ? (combo?.group && combo.group !== combo.name ? esc(combo.group) : '') : 'or type a name'}</span></div></div>
          ${selected != null ? '<button class="clear" id="clear">Clear</button>' : ''}
        </div>
        <div>
          <div class="searchbar">
            <input class="field" id="cq" type="search" placeholder="Boros, Esper, sans green, UR…" aria-label="Color combination" autocomplete="off" value="${selected != null ? esc(comboName(selected)) : ''}">
            <div class="suggest" id="csug" hidden></div>
          </div>
          <div class="filters">
            <div><span class="lbl">Match</span><span class="seg"><button data-cmode="exact" aria-pressed="${mode === 'exact'}">Exactly these colors</button><button data-cmode="includes" aria-pressed="${mode === 'includes'}">At least these colors</button></span></div>
            <div><span class="lbl">Format</span><span class="seg">${['all', ...FMT_KEYS].map((f) => `<button data-cfmt="${f}" aria-pressed="${fsel === f}">${f === 'all' ? 'All' : FORMATS[f]}</button>`).join('')}</span></div>
            <div><button class="btn quiet sm" data-mana="C" aria-pressed="${selected === ''}"><img src="${symbolURL('C')}" alt="" width="16" height="16"> Colorless decks</button></div>
          </div>
        </div>
      </div>
    </section>
    <section class="block wrap" id="cresults" ${selected == null ? 'hidden' : ''}></section>
    <section class="block wrap">
      <div class="block-head"><h2>Every color combination</h2></div>
      <div class="index">${['Colorless', 'Mono', 'Guilds', 'Shards', 'Wedges', 'Four-Color', 'Five-Color'].map((g) => `
        <section><h3>${g === 'Mono' ? 'One color' : g}</h3>${COMBOS.filter((c) => c.group === g).map((c) => `
          <a class="${selected === c.key ? 'on' : ''}" href="#/colors/${c.key || 'C'}">${pipsHTML(c.key, 16)} ${esc(c.name)}</a>`).join('')}</section>`).join('')}
      </div>
    </section>`;
  loadArt('colors');

  const go = (key) => { location.hash = `#/colors/${key === '' ? 'C' : key}`; };
  const input = $('#cq'), sug = $('#csug');
  let hi = -1;
  input.addEventListener('input', () => {
    const list = suggestCombos(input.value);
    hi = -1;
    sug.hidden = !list.length;
    sug.innerHTML = list.map((c) => `<button data-key="${c.key || 'C'}">${pipsHTML(c.key, 16)} ${esc(c.name)} <span class="soft">${c.group}</span></button>`).join('');
  });
  input.addEventListener('keydown', (e) => {
    const btns = $$('button', sug);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && btns.length) {
      e.preventDefault();
      hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle('hi', i === hi));
    } else if (e.key === 'Enter') {
      if (hi >= 0 && btns[hi]) return btns[hi].click();
      const k = parseColorQuery(input.value);
      if (k != null) go(k); else toast(`“${input.value}” isn't a color combination name`);
    } else if (e.key === 'Escape') sug.hidden = true;
  });
  sug.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) location.hash = `#/colors/${b.dataset.key}`; });
  input.addEventListener('blur', () => setTimeout(() => (sug.hidden = true), 150));
  $$('[data-mana]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.mana;
    if (c === 'C') return go('');
    const cur = new Set(selected || '');
    cur.has(c) ? cur.delete(c) : cur.add(c);
    const k = sortKey([...cur].join(''));
    k ? go(k) : (location.hash = '#/colors');
  }));
  $('#clear')?.addEventListener('click', () => (location.hash = '#/colors'));
  $$('[data-cmode]').forEach((b) => b.addEventListener('click', () => { store.set('colorMode', b.dataset.cmode); router(); }));
  $$('[data-cfmt]').forEach((b) => b.addEventListener('click', () => { store.set('colorFmt', b.dataset.cfmt); router(); }));
  if (selected == null) return;

  const box = $('#cresults');
  box.innerHTML = '<div class="loading">Searching the archive…</div>';
  const fmts = fsel === 'all' ? FMT_KEYS : [fsel];
  const all = await Promise.all(fmts.map((f) => loadEvents(f).then((evs) => evs.map((e) => ({ ...e, f })))));
  if (stale(token)) return;
  const match = (c) => c != null && (mode === 'exact' ? c === selected : [...selected].every((x) => c.includes(x)));
  const decks = [];
  for (const ev of all.flat()) for (const d of ev.top) if (match(d.colors)) decks.push({ ...d, ev });
  decks.sort((a, b) => b.ev.date.localeCompare(a.ev.date) || a.rank - b.rank);
  const now = Date.now();
  const arch = new Map();
  for (const d of decks) {
    if ((now - Date.parse(d.ev.date)) / 864e5 > 30) continue;
    const k = `${d.ev.f}|${d.name.toLowerCase()}`;
    const a = arch.get(k) || { name: d.name, f: d.ev.f, colors: d.colors, score: 0, wins: 0, top8: 0, best: d };
    a.score += PLACE(d.rank);
    if (d.rank === 1) a.wins++;
    if (d.rank <= 8) a.top8++;
    if (d.rank < a.best.rank) a.best = d;
    arch.set(k, a);
  }
  const archList = [...arch.values()].sort((a, b) => b.score - a.score).slice(0, 12);
  const where = `${mode === 'exact' ? 'Exactly' : 'At least'} ${selected === '' ? 'colorless' : `these colors`}, ${fsel === 'all' ? 'every format' : FORMATS[fsel]}.`;
  box.innerHTML = `
    <div class="block-head"><div><h2>${esc(combo?.name || selected)} decks ${pipsHTML(selected, 28)}</h2><p>${where}</p></div></div>
    <div class="split">
      <div><h3>Best archetypes, last 30 days</h3>
        ${archList.length ? `<div class="ledger">${archList.map((a) => `
          <a class="row" href="${deckHref(a.f, a.best.deckId)}" style="${frameVars(a.colors)}"><span class="stripe"></span>
            <span class="main"><strong>${esc(a.name)}</strong><span>${FORMATS[a.f]}, ${plural(a.wins, 'win')}, ${plural(a.top8, 'top 8')}</span></span>
            <span class="side">${pipsHTML(a.colors, 16)}</span></a>`).join('')}</div>` : '<div class="note">No archetypes in these colors made a top 8 in the last 30 days. Try “At least these colors”.</div>'}
      </div>
      <div><h3>Recent finishes</h3>
        ${decks.length ? `<div class="ledger">${decks.slice(0, 40).map((d) => `
          <a class="standing" href="${deckHref(d.ev.f, d.deckId)}"><span class="r">${esc(d.rankLabel || d.rank)}</span><span>${esc(d.name)} <span class="soft">${FORMATS[d.ev.f]}</span></span><span>${pipsHTML(d.colors, 16)}</span><span class="pl">${fmtDate(d.ev.date)}</span></a>`).join('')}</div>` : '<div class="note">No tournament decks found in these colors yet.</div>'}
      </div>
    </div>`;
}

/* =========================================================================
   CARD LOOKUP: a collector's binder
   ========================================================================= */
const countRows = (rows) => rows.reduce((a, [q]) => a + q, 0);
const typeLetter = (t = '') => (/Creature/.test(t) ? 'C' : /Planeswalker/.test(t) ? 'P' : /Battle/.test(t) ? 'B' : /Land/.test(t) ? 'L' : /Instant/.test(t) ? 'I' : /Sorcery/.test(t) ? 'S' : /Artifact/.test(t) ? 'A' : /Enchantment/.test(t) ? 'E' : 'O');

/* Fill in Scryfall ids, types and mana values for card names the stored data doesn't cover. */
async function enrichCards(names) {
  const need = names.filter((n) => !cardsMap[n]?.[0] || !cardsMap[n]?.[5]);
  for (let i = 0; i < need.length; i += 15) {
    const chunk = need.slice(i, i + 15);
    const q = chunk.map((n) => `!"${n.replace(/"/g, '')}"`).join(' or ');
    try {
      let page = await sf(`/cards/search?q=${encodeURIComponent(q)}&unique=cards`);
      const found = [...page.data];
      while (page.has_more) { page = await sf(page.next_page); found.push(...page.data); }
      const byName = new Map();
      for (const c of found) {
        byName.set(c.name.toLowerCase(), c);
        for (const f of c.card_faces || []) byName.set(f.name.toLowerCase(), c);
      }
      for (const n of chunk) {
        const c = byName.get(n.toLowerCase()) || byName.get(n.split(/\s*\/\/?\s*/)[0].toLowerCase());
        if (!c) continue;
        const face = c.card_faces?.[0] || c;
        const type = face.type_line || c.type_line || '';
        const old = cardsMap[n] || [];
        cardsMap[n] = [c.id, (c.color_identity || []).join(''), /Land/.test(type) ? 1 : 0, c.cmc ?? old[3] ?? 0, face.artist || c.artist || '', typeLetter(type)];
      }
    } catch {}
  }
}

/*
  The binder. Two 9-pocket pages side by side (one on phones). Turning a page is a real 3D leaf:
  the leaf's front is the page you're leaving, its back is the page you land on, and it swings
  around the binding. Images for the next spread are loaded before the leaf moves.
*/
function mountBinder(el, { total, load, pocket, onOpen }) {
  const wide = matchMedia('(min-width: 1000px)');
  const per = () => (wide.matches ? 18 : 9);
  let spread = 0, busy = false;
  const byIdx = new Map();
  const pageHTML = (list, base) => `<div class="bpage">${Array.from({ length: 9 }, (_, i) => {
    const it = list[i];
    if (!it) return '<span class="pocket empty" aria-hidden="true"></span>';
    byIdx.set(base + i, it);
    return pocket(it, base + i);
  }).join('')}</div>`;
  async function pagesFor(s) {
    const n = per(), from = s * n;
    const list = await load(from, n);
    return (n === 18 ? [list.slice(0, 9), list.slice(9, 18)] : [list]).map((l, k) => pageHTML(l, from + k * 9));
  }
  const lastSpread = () => Math.max(0, Math.ceil(total / per()) - 1);
  function frame(pages) {
    const n = per(), totalPages = Math.max(1, Math.ceil(total / 9));
    const first = spread * (n / 9) + 1, last = Math.min(first + n / 9 - 1, totalPages);
    el.innerHTML = `<div class="binder ${n === 9 ? 'single' : ''}">${pages.join('')}</div>
      <div class="binder-nav"><button class="btn quiet sm" data-turn="-1" ${spread ? '' : 'disabled'}>Previous page</button>
        <span>${first === last ? `Page ${first}` : `Pages ${first} and ${last}`} of ${totalPages}</span>
        <button class="btn quiet sm" data-turn="1" ${spread < lastSpread() ? '' : 'disabled'}>Next page</button></div>`;
  }
  const warm = (html) => {
    const urls = [...html.matchAll(/ src="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    return Promise.race([Promise.all(urls.map((u) => new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = u; }))), sleep(1200)]);
  };
  async function render() { frame(await pagesFor(spread)); }
  async function goTo(target) {
    if (busy || target < 0 || target > lastSpread() || target === spread) return;
    busy = true;
    const dir = target > spread ? 1 : -1;
    const [oldPages, newPages] = await Promise.all([pagesFor(spread), pagesFor(target)]);
    await warm(newPages.join(''));
    spread = target;
    const book = $('.binder', el);
    if (REDUCED.matches || !book || !el.isConnected) { frame(newPages); busy = false; return; }
    const blank = '<div class="bpage reverse"></div>';
    let base, front, back, kind, from, to;
    if (newPages.length === 2 && dir > 0) { base = [oldPages[0], newPages[1]]; front = oldPages[1]; back = newPages[0]; kind = 'right'; from = 0; to = -180; }
    else if (newPages.length === 2) { base = [newPages[0], oldPages[1]]; front = oldPages[0]; back = newPages[1]; kind = 'left'; from = 0; to = 180; }
    else if (dir > 0) { base = [newPages[0]]; front = oldPages[0]; back = blank; kind = 'single'; from = 0; to = -180; }
    else { base = [oldPages[0]]; front = newPages[0]; back = blank; kind = 'single'; from = -180; to = 0; }
    // The turning page is cut into vertical strips. Each frame, every strip is placed at the end of the
    // previous one with a slightly different angle, so the page bends like a real binder page.
    const ref = $('.bpage', book);
    const W = ref.offsetWidth, H = ref.offsetHeight, N = 8, sw = W / N;
    const shownPages = $$('.bpage', book);
    const look = (p) => { const cs = getComputedStyle(p); return `padding:${cs.padding};box-shadow:${cs.boxShadow};border-radius:${cs.borderRadius}`; };
    const leftLook = look(shownPages[0]), rightLook = look(shownPages[shownPages.length - 1]);
    const styled = (html, st) => html.replace('<div class="bpage"', `<div class="bpage" style="${st}"`);
    if (newPages.length === 2) {
      front = styled(front, kind === 'right' ? rightLook : leftLook);
      back = styled(back, kind === 'right' ? leftLook : rightLook);
    } else { front = styled(front, leftLook); back = styled(back, leftLook); }
    const fromRight = kind === 'left';
    let strips = '';
    for (let k = 0; k < N; k++) {
      const fOff = fromRight ? W - (k + 1) * sw : k * sw;
      const bOff = fromRight ? k * sw : W - (k + 1) * sw;
      strips += `<div class="strip" style="width:${sw + (k < N - 1 ? 3 : 0)}px"><div class="face"><div class="slice" style="width:${W}px;height:${H}px;left:${-fOff}px">${front}</div><div class="slice" hidden style="width:${W}px;height:${H}px;left:${-bOff}px">${back}</div></div><div class="lite"></div></div>`;
    }
    book.innerHTML = `${base.join('')}<div class="cast ${kind}"></div><div class="leaf ${kind}">${strips}</div>`;
    const leaf = $('.leaf', book);
    const segs = $$('.strip', leaf);
    const faces = $$('.face', leaf);
    const lites = $$('.lite', leaf);
    const shadeOf = (deg) => 0.5 * (1 - Math.abs(Math.cos((deg * Math.PI) / 180)));
    const flipped = new Array(N).fill(false);
    const cast = $('.cast', book);
    const D = 1150;
    const side = fromRight ? -1 : 1; // which way "out from the binding" is on screen
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const lerp = (a, b, t) => a + (b - a) * t;
    // curl over time: outer edge leads while peeling, trails while falling, flutters flat
    const curl = (t) => (t < 0.2 ? lerp(0, 1, t / 0.2) : t < 0.5 ? lerp(1, 0.15, (t - 0.2) / 0.3) : t < 0.78 ? lerp(0.15, -0.9, (t - 0.5) / 0.28) : t < 0.92 ? lerp(-0.9, 0.25, (t - 0.78) / 0.14) : lerp(0.25, 0, (t - 0.92) / 0.08));
    const dirSign = Math.sign(to - from);
    await new Promise((done) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / D);
        const baseAngle = from + (to - from) * ease(t);
        const lift = Math.sin(Math.PI * t) * 26; // px toward the viewer at mid-turn
        const c = curl(t) * dirSign * 5.5; // degrees added per strip
        let x = 0, z = lift * 0.25;
        for (let k = 0; k < N; k++) {
          const ang = baseAngle + c * k;
          const rad = (ang * Math.PI) / 180;
          segs[k].style.transform = `translate3d(${side * x}px, 0, ${z}px) rotateY(${ang}deg)`;
          // past vertical we're looking at the back of the strip: show the new page there, un-mirrored
          const past = Math.abs(ang) > 90;
          if (past !== flipped[k]) {
            flipped[k] = past;
            const [fs, bs] = faces[k].children;
            fs.hidden = past;
            bs.hidden = !past;
            faces[k].style.transform = past ? 'scaleX(-1)' : '';
          }
          // one continuous light gradient across the curve: each strip blends into the next one's shade
          const a1 = shadeOf(ang), a2 = shadeOf(baseAngle + c * (k + 1));
          lites[k].style.background = `linear-gradient(${fromRight ? 270 : 90}deg, rgb(0 0 0 / ${a1.toFixed(3)}), rgb(0 0 0 / ${a2.toFixed(3)}))`;
          x += sw * Math.cos(rad);
          z += -side * sw * Math.sin(rad);
        }
        if (cast) cast.style.opacity = String(Math.max(0, 0.6 * (1 - t * 1.6)));
        if (t < 1 && el.isConnected) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    frame(newPages);
    busy = false;
  }
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-turn]');
    if (t) return goTo(spread + Number(t.dataset.turn));
    const p = e.target.closest('.pocket[data-idx]');
    if (p) onOpen(byIdx.get(Number(p.dataset.idx)), Number(p.dataset.idx));
  });
  let swipe = null;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') swipe = e.clientX; });
  el.addEventListener('pointerup', (e) => { if (swipe != null && Math.abs(e.clientX - swipe) > 60) goTo(spread + (e.clientX < swipe ? 1 : -1)); swipe = null; });
  wide.addEventListener('change', () => { if (el.isConnected) { spread = 0; render(); } });
  return {
    render,
    turn: (d) => goTo(spread + d),
    async jumpTo(idx) {
      const target = Math.floor(idx / per());
      if (target !== spread) await goTo(target);
      const p = $(`.pocket[data-idx="${idx}"]`, el);
      if (p) { p.classList.remove('found'); void p.offsetWidth; p.classList.add('found'); p.focus({ preventScroll: true }); p.scrollIntoView({ block: 'nearest', behavior: REDUCED.matches ? 'auto' : 'smooth' }); }
    },
  };
}

const priceOf = (c) => c.prices?.usd ?? c.prices?.usd_foil ?? c.prices?.usd_etched ?? null;
function pocketHTML(c, idx, label = c.name) {
  const [a, b] = faceImgs(c);
  const price = priceOf(c);
  const foilOnly = c.finishes && !c.finishes.includes('nonfoil');
  return `<button class="pocket ${foilOnly ? 'foil' : ''}" data-idx="${idx}" data-img="${esc(a || '')}" ${b ? `data-img2="${esc(b)}"` : ''} aria-label="${esc(label)}${price ? `, ${money(price)}` : ''}">
    <img loading="lazy" decoding="async" src="${esc(a || '')}" alt="">${price ? `<span class="sticker">${money(price)}</span>` : ''}</button>`;
}

function searchForm(q, placeholder) {
  return `<form class="searchbar" id="cform" autocomplete="off" role="search">
      <input class="field" id="cardq" type="search" aria-label="Card name or Scryfall search" placeholder="${placeholder}" value="${esc(q)}">
      <div class="suggest" id="asug" hidden></div>
    </form>`;
}
function wireSearch(onPickName) {
  const input = $('#cardq'), sug = $('#asug');
  let hi = -1;
  input.addEventListener('input', debounce(async () => {
    const v = input.value.trim();
    if (v.length < 2) { sug.hidden = true; return; }
    try {
      const r = await sf(`/cards/autocomplete?q=${encodeURIComponent(v)}`);
      if (input.value.trim() !== v) return;
      hi = -1;
      sug.innerHTML = r.data.slice(0, 8).map((n) => `<button type="button" data-n="${esc(n)}" data-card="${esc(n)}">${esc(n)}</button>`).join('');
      sug.hidden = !r.data.length;
    } catch {}
  }, 160));
  input.addEventListener('keydown', (e) => {
    const btns = $$('button', sug);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && btns.length) {
      e.preventDefault();
      hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle('hi', i === hi));
    } else if (e.key === 'Escape') sug.hidden = true;
  });
  sug.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { preview.hide(); onPickName(b.dataset.n); } });
  input.addEventListener('blur', () => setTimeout(() => (sug.hidden = true), 150));
  $('#cform').addEventListener('submit', (e) => {
    e.preventDefault();
    const btns = $$('button', sug);
    if (hi >= 0 && btns[hi]) return btns[hi].click();
    const v = input.value.trim();
    if (v) location.hash = `#/cards/${encodeURIComponent(v)}`;
  });
  return input;
}

async function viewCards([q = ''], token) {
  main.innerHTML = `
    ${headHTML('cards', `<h1>Card lookup</h1><p class="lede">Search any Magic card. Pick one and its binder opens with every printing ever made, each with its price.</p>`, '<div class="hand small" data-flair></div>')}
    <section class="block wrap">
      ${searchForm(q, 'Card name, or a Scryfall search like t:dragon c:r')}
      <p class="fine">Scryfall search syntax works here too, for example <a href="#/cards/${encodeURIComponent('id:grixis t:legendary t:creature')}">id:grixis t:legendary t:creature</a>.</p>
    </section>
    <section class="block wrap" id="cres" style="padding-top:0"></section>`;
  loadArt('cards');
  const input = wireSearch((name) => (location.hash = `#/printings/${encodeURIComponent(name)}`));
  if (!q) { input.focus(); return; }

  const res = $('#cres');
  res.innerHTML = '<div class="loading">Searching Scryfall…</div>';
  let page;
  try {
    page = await sf(`/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`);
  } catch (e) {
    if (stale(token)) return;
    res.innerHTML = `<div class="note">${e.status === 404 ? `No cards match “${esc(q)}”. Check the spelling, or search part of the name.` : esc(e.message)}</div>`;
    return;
  }
  if (stale(token)) return;
  if (page.total_cards === 1) { location.replace(`#/printings/${encodeURIComponent(page.data[0].name)}`); return; }
  const all = [...page.data];
  let more = page.has_more ? page.next_page : null;
  const load = async (from, n) => {
    while (all.length < from + n && more) { const p = await sf(more); all.push(...p.data); more = p.has_more ? p.next_page : null; }
    return all.slice(from, from + n);
  };
  res.innerHTML = `<div class="block-head"><div><h2>${plural(page.total_cards, 'card')}</h2><p>Pick a card to open its binder of every printing. Turn pages with the arrow keys or the buttons.</p></div></div><div id="binder"></div>`;
  const binder = mountBinder($('#binder'), { total: page.total_cards, load, pocket: (c, i) => pocketHTML(c, i), onOpen: (c) => (location.hash = `#/printings/${encodeURIComponent(c.name)}`) });
  await binder.render();
  viewKeys = (e) => { if (e.key === 'ArrowRight') binder.turn(1); if (e.key === 'ArrowLeft') binder.turn(-1); };
}

/* Every printing of one card, in binder pockets. */
async function viewPrintings([name = ''], token) {
  if (!name) return viewCards([], token);
  const dir = store.get('printOrder', 'asc');
  main.innerHTML = '<div class="loading">Opening the binder…</div>';
  let first;
  try {
    first = await sf(`/cards/search?q=${encodeURIComponent(`!"${name.replace(/"/g, '')}" include:extras`)}&unique=prints&order=released&dir=${dir}`);
  } catch (e) {
    if (stale(token)) return;
    main.innerHTML = `<div class="wrap note" style="margin-top:2rem">${e.status === 404 ? `Scryfall has no card named “${esc(name)}”.` : esc(e.message)} <a href="#/cards">Back to card lookup</a></div>`;
    return;
  }
  if (stale(token)) return;
  const total = first.total_cards;
  const all = [...first.data];
  let more = first.has_more ? first.next_page : null;
  const load = async (from, n) => {
    while (all.length < from + n && more) { const p = await sf(more); all.push(...p.data); more = p.has_more ? p.next_page : null; }
    return all.slice(from, from + n);
  };
  const loadAll = async () => { while (more && all.length < 3000) await load(all.length, 175); return all; };
  const years = (list) => list.map((p) => p.released_at?.slice(0, 4)).filter(Boolean).sort();
  const ys = years(first.data);
  const card = first.data[0];

  main.innerHTML = `
    ${headHTML('cards', `
      ${(() => { const b = store.get('printingsBack', null); return b && b.name === name ? `<a class="back" href="${esc(b.hash)}">Back to the ${esc(b.label)}</a>` : '<a class="back" href="#/cards">Card lookup</a>'; })()}
      <h1>${esc(card.name)}</h1>
      <p class="lede">${plural(total, 'printing')}${ys.length ? `, ${dir === 'asc' ? `starting in ${ys[0]}` : `newest from ${ys.at(-1)}`}` : ''}. Flip through the whole binder, or find the one you want and jump straight to it.</p>
      <div class="actions">
        <span class="seg" role="group" aria-label="Order"><button data-order="asc" aria-pressed="${dir === 'asc'}">Oldest first</button><button data-order="desc" aria-pressed="${dir === 'desc'}">Newest first</button></span>
        <button class="btn quiet" id="details">Rules text and price table</button>
      </div>`, '<div class="hand small" data-flair></div>')}
    <section class="block wrap">
      <div class="searchbar find">
        <input class="field" id="findp" type="search" placeholder="Find a printing: set name, set code, year or collector number" aria-label="Find a printing" autocomplete="off">
        <div class="suggest" id="fsug" hidden></div>
      </div>
      <div id="binder" style="margin-top:1.4rem"></div>
    </section>`;
  loadArt('cards');
  const label = (p) => `${p.set_name}, ${p.released_at?.slice(0, 4) || ''}`;
  const binder = mountBinder($('#binder'), { total, load, pocket: (p, i) => pocketHTML(p, i, label(p)), onOpen: (p) => openCard(p) });
  await binder.render();
  viewKeys = (e) => { if (e.key === 'ArrowRight') binder.turn(1); if (e.key === 'ArrowLeft') binder.turn(-1); };
  $$('[data-order]').forEach((b) => b.addEventListener('click', () => { store.set('printOrder', b.dataset.order); router(); }));
  $('#details').addEventListener('click', () => openCard(card));

  const input = $('#findp'), sug = $('#fsug');
  let hits = [], hi = -1;
  const show = async () => {
    const v = input.value.trim().toLowerCase();
    if (!v) { sug.hidden = true; return; }
    const list = await loadAll();
    if (input.value.trim().toLowerCase() !== v) return;
    hits = list.map((p, i) => ({ p, i })).filter(({ p }) => `${p.set_name} ${p.set} ${p.collector_number} ${p.released_at} ${(p.frame_effects || []).join(' ')} ${p.promo ? 'promo' : ''}`.toLowerCase().includes(v)).slice(0, 8);
    hi = -1;
    sug.innerHTML = hits.length
      ? hits.map(({ p, i }) => `<button type="button" data-i="${i}" data-img="${esc(faceImgs(p)[0] || '')}">${esc(p.set_name)} <span class="soft">${esc(p.set.toUpperCase())} #${esc(p.collector_number)}, ${esc(p.released_at?.slice(0, 4))}${priceOf(p) ? `, ${money(priceOf(p))}` : ''}</span></button>`).join('')
      : '<p class="fine" style="padding:.6rem 1rem;margin:0">No printing matches that. Try a year like 1994 or a set code like LEA.</p>';
    sug.hidden = false;
  };
  input.addEventListener('input', debounce(show, 140));
  input.addEventListener('keydown', (e) => {
    const btns = $$('button', sug);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && btns.length) {
      e.preventDefault();
      hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle('hi', i === hi));
    } else if (e.key === 'Enter') { e.preventDefault(); (btns[hi] || btns[0])?.click(); }
    else if (e.key === 'Escape') sug.hidden = true;
  });
  sug.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sug.hidden = true;
    preview.hide();
    binder.jumpTo(Number(b.dataset.i));
  });
  input.addEventListener('blur', () => setTimeout(() => (sug.hidden = true), 180));
}

/* ---------------- card details: rules text, legality, every printing with its prices ---------------- */
const symbolize = (txt) => esc(txt).replace(/\{([^}]+)\}/g, (_, s) => `<img src="${symbolURL(s.replace(/\//g, ''))}" alt="{${esc(s)}}">`);
let lastFocus = null;
function closeModal() {
  const m = $('#modal');
  if (m.hidden) return;
  m.hidden = true;
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}
$('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); preview.hide(); } });

function legalityLine(card) {
  const by = { legal: [], not_legal: [], banned: [], restricted: [] };
  for (const f of FMT_KEYS) (by[card.legalities?.[LEGAL_KEY[f]]] || by.not_legal).push(FORMATS[f]);
  const join = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
  return [
    by.legal.length && `<span class="ok">Legal in ${join(by.legal)}.</span>`,
    by.banned.length && `<span class="no">Banned in ${join(by.banned)}.</span>`,
    by.restricted.length && `<span class="no">Restricted in ${join(by.restricted)}.</span>`,
    by.not_legal.length && `<span class="no">Not legal in ${join(by.not_legal)}.</span>`,
  ].filter(Boolean).join(' ');
}

async function openCard(card) {
  if (!card) return;
  preview.hide();
  lastFocus = document.activeElement;
  const m = $('#modal'), body = $('.modal-body', m);
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  $('.modal-panel', m).scrollTop = 0;
  const faces = card.card_faces?.length && !card.image_uris ? card.card_faces : [card];
  const text = (card.card_faces || [card]).map((f) => `<b>${esc(f.name)}</b> ${symbolize(f.mana_cost || '')}\n<i>${esc(f.type_line || '')}</i>\n${symbolize(f.oracle_text || '')}${f.power != null ? `\n<b>${esc(f.power)}/${esc(f.toughness)}</b>` : ''}${f.loyalty ? `\nLoyalty ${esc(f.loyalty)}` : ''}`).join('\n\n');
  body.innerHTML = `<div class="cardview">
    <div class="imgs">${faceImgs(card, 'large').map((u, i) => `<img id="mimg${i}" src="${esc(u)}" alt="${esc(card.name)}" decoding="async">`).join('')}</div>
    <div>
      <h2 id="modal-title">${esc(card.name)}</h2>
      <p class="legal">${legalityLine(card)}</p>
      <div class="oracle">${text}</div>
      <p class="fine">Illustrated by ${esc(faces[0].artist || card.artist || 'an unknown artist')}. <a href="${esc(card.scryfall_uri)}" target="_blank" rel="noopener">View on Scryfall</a></p>
      <div id="values"><div class="loading" style="padding:16px">Loading every printing…</div></div>
      <div id="prints"></div>
    </div></div>`;
  $('.modal-x', m).focus();

  let prints = [];
  try {
    let page = await sf(card.prints_search_uri);
    prints = page.data;
    let n = 0;
    while (page.has_more && n++ < 12 && !m.hidden) { page = await sf(page.next_page); prints = prints.concat(page.data); }
  } catch (e) {
    $('#values').innerHTML = `<p class="fine">Printings couldn't load (${esc(e.message)}). Close and reopen the card to try again.</p>`;
    return;
  }
  if (m.hidden) return;
  const num = (v) => (v == null ? null : Number(v));
  const rows = prints.map((p) => ({
    p, set: p.set_name, code: p.set.toUpperCase(), cn: p.collector_number, rarity: p.rarity, date: p.released_at,
    usd: num(p.prices.usd), foil: num(p.prices.usd_foil), etched: num(p.prices.usd_etched), eur: num(p.prices.eur), tix: num(p.prices.tix),
  }));
  const lowest = (k) => rows.filter((r) => r[k] != null).sort((a, b) => a[k] - b[k])[0];
  const cheapN = lowest('usd'), cheapF = lowest('foil');
  const top = rows.map((r) => ({ r, v: Math.max(r.usd ?? 0, r.foil ?? 0, r.etched ?? 0) })).sort((a, b) => b.v - a.v)[0];
  const cell = (label, value, r) => `<div><small>${label}</small><b>${value}</b><em>${r ? `${esc(r.set)}, #${esc(r.cn)}` : 'No market price'}</em></div>`;
  $('#values').innerHTML = `<div class="values">
    ${cell('Cheapest non-foil', cheapN ? money(cheapN.usd) : '–', cheapN)}
    ${cell('Cheapest foil', cheapF ? money(cheapF.foil) : '–', cheapF)}
    ${cell('Most valuable printing', top?.v ? money(top.v) : '–', top?.v ? top.r : null)}
    <div><small>Printings</small><b>${rows.length}</b><em>${plural(prints.filter((p) => p.digital).length, 'digital-only printing')}</em></div>
  </div>`;

  let sortK = 'date', dir = -1, filter = '';
  $('#prints').insertAdjacentHTML('beforebegin', '<input class="field" id="pfilter" type="search" placeholder="Find a printing: set, year, number or rarity" aria-label="Filter printings" autocomplete="off" style="margin-bottom:.8rem">');
  const cols = [['set', 'Set'], ['cn', 'No.'], ['rarity', 'Rarity'], ['date', 'Released'], ['usd', 'Non-foil'], ['foil', 'Foil'], ['etched', 'Etched'], ['eur', 'EUR'], ['tix', 'MTGO tix']];
  const numeric = ['usd', 'foil', 'etched', 'eur', 'tix'];
  const drawTable = () => {
    const shown = filter ? rows.filter((r) => `${r.set} ${r.code} ${r.cn} ${r.date} ${r.rarity}`.toLowerCase().includes(filter)) : rows;
    const sorted = [...shown].sort((a, b) => {
      const x = a[sortK], y = b[sortK];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
    });
    $('#prints').innerHTML = `<div class="tablewrap"><table class="prints"><thead><tr>${cols.map(([k, l]) => `<th scope="col" data-k="${k}" class="${numeric.includes(k) ? 'num' : ''}" ${sortK === k ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${l}${sortK === k ? (dir > 0 ? ' ▴' : ' ▾') : ''}</th>`).join('')}</tr></thead><tbody>
      ${sorted.length ? '' : `<tr><td colspan="9" class="soft" style="white-space:normal">No printing matches “${esc(filter)}”.</td></tr>`}
      ${sorted.map((r) => { const [a, b] = faceImgs(r.p); return `<tr class="${top?.v && r === top.r ? 'top' : ''} ${r.p.id === card.id ? 'current' : ''}" data-img="${esc(a || '')}" ${b ? `data-img2="${esc(b)}"` : ''} data-pid="${r.p.id}">
        <td><img class="set-ico" src="https://svgs.scryfall.io/sets/${esc(r.p.set)}.svg" alt="" loading="lazy" onerror="this.style.visibility='hidden'">${esc(r.set)} <span class="soft">${esc(r.code)}</span>${r.p.digital ? ' <span class="soft">(digital)</span>' : ''}</td>
        <td>${esc(r.cn)}</td><td style="text-transform:capitalize">${esc(r.rarity)}</td><td>${esc(r.date)}</td>
        <td class="num">${money(r.usd)}</td><td class="num">${money(r.foil)}</td><td class="num">${money(r.etched)}</td><td class="num">${money(r.eur, '€')}</td><td class="num">${r.tix == null ? '–' : r.tix}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="fine">USD prices are TCGplayer market, EUR is Cardmarket, tix are Cardhoarder, all via Scryfall and refreshed about once a day. The highlighted row is the most valuable printing. Select a printing to see its art, or a column to sort.</p>`;
  };
  drawTable();
  $('#pfilter').addEventListener('input', debounce((e) => { filter = e.target.value.trim().toLowerCase(); drawTable(); }, 120));
  const cur = $('tr.current', $('#prints')), wrap = $('.tablewrap', $('#prints'));
  if (cur && wrap) wrap.scrollTop = Math.max(0, cur.offsetTop - wrap.clientHeight / 2 + cur.offsetHeight / 2);
  $('#prints').addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (th) { const k = th.dataset.k; dir = sortK === k ? -dir : (numeric.includes(k) || k === 'date' ? -1 : 1); sortK = k; drawTable(); return; }
    const tr = e.target.closest('tr[data-pid]');
    if (tr) {
      const p = rows.find((r) => r.p.id === tr.dataset.pid).p;
      faceImgs(p, 'large').forEach((u, i) => { const im = $(`#mimg${i}`); if (im) im.src = u; });
    }
  });
}

/* ---------------- start ---------------- */
if (EMBED?.sample) main.insertAdjacentHTML('beforebegin', '<p class="sample-bar">Sample tournament data for previewing the design. Real results replace it after the first daily update.</p>');
refillHand();
router();
