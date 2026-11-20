#!/usr/bin/env node
// Daily updater: pulls new tournaments from MTGTop8 for cEDH, Modern, Standard and Legacy,
// enriches cards with Scryfall (color identity + image id), and rebuilds the rankings.
// Run: node scripts/update.mjs            (normal daily run)
//      MAX_NEW_EVENTS=10 node scripts/update.mjs   (quick test)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseFormatPage, parseEventPage, parseDeckList, parseMtgoExport, countCards } from './lib/parse.mjs';
import { topList, isMajor } from './lib/rank.mjs';

const ROOT = new URL('../data/', import.meta.url);
const UA = 'MetaGrimoire/1.0 (fan site; daily tournament digest)';
const BASE = 'https://www.mtgtop8.com/';

export const FORMATS = {
  cedh: { label: 'cEDH', code: 'cEDH' },
  modern: { label: 'Modern', code: 'MO' },
  standard: { label: 'Standard', code: 'ST' },
  legacy: { label: 'Legacy', code: 'LE' },
};

const MAX_NEW_EVENTS = Number(process.env.MAX_NEW_EVENTS || 40); // per format per run
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 35); // only fetch events this recent
const KEEP_EVENTS_DAYS = 120; // tournament history kept
const KEEP_LISTS_DAYS = 60; // decklists kept
const DELAY_MS = Number(process.env.DELAY_MS || 1100); // be polite to MTGTop8

const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ageDays = (d) => (Date.parse(today) - Date.parse(d)) / 86400000;

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      await sleep(DELAY_MS);
      return new TextDecoder('windows-1252').decode(buf);
    } catch (e) {
      if (i === tries) throw new Error(`${url}: ${e.message}`);
      await sleep(DELAY_MS * 3 * i);
    }
  }
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(new URL(name, ROOT), 'utf8'));
  } catch {
    return fallback;
  }
}
const writeJson = (name, data) => writeFile(new URL(name, ROOT), JSON.stringify(data));

// Decklists are sharded so opening one deck downloads ~1/16 of a format's lists.
export const SHARDS = 16;
async function readDecks(key) {
  const all = {};
  for (let i = 0; i < SHARDS; i++) Object.assign(all, await readJson(`decks/${key}-${i}.json`, {}));
  return all;
}
async function writeDecks(key, decks) {
  const shards = Array.from({ length: SHARDS }, () => ({}));
  for (const [id, l] of Object.entries(decks)) shards[Number(id) % SHARDS][id] = l;
  await Promise.all(shards.map((d, i) => writeJson(`decks/${key}-${i}.json`, d)));
}

// ---------- Scryfall enrichment ----------
async function enrichCards(names, cards) {
  const missing = [...names].filter((n) => !(n in cards));
  console.log(`Scryfall: ${missing.length} new card names`);
  const lookup = async (batch) => {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    });
    await sleep(120);
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    return res.json();
  };
  const store = (asked, c) => {
    const face = c.card_faces?.[0] || c;
    const type = face.type_line || c.type_line || '';
    cards[asked] = [c.id, (c.color_identity || []).join(''), /Land/.test(type) ? 1 : 0, c.cmc ?? 0, face.artist || c.artist || '', typeLetter(type)];
  };
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    try {
      const out = await lookup(batch);
      const byName = new Map();
      for (const c of out.data || []) {
        byName.set(c.name.toLowerCase(), c);
        for (const f of c.card_faces || []) byName.set(f.name.toLowerCase(), c);
      }
      const retry = [];
      for (const n of batch) {
        const c = byName.get(n.toLowerCase()) || byName.get(n.split(/\s*\/\/?\s*/)[0].toLowerCase());
        if (c) store(n, c);
        else retry.push(n);
      }
      // split / adventure cards written as "A/B" — retry with front face only
      if (retry.length) {
        const fronts = retry.map((n) => n.split(/\s*\/\/?\s*/)[0]);
        const out2 = await lookup(fronts);
        const m2 = new Map((out2.data || []).map((c) => [c.name.split(' // ')[0].toLowerCase(), c]));
        retry.forEach((n, k) => {
          const c = m2.get(fronts[k].toLowerCase());
          if (c) store(n, c);
          else cards[n] = null; // unknown, don't retry every day
        });
      }
    } catch (e) {
      console.warn('Scryfall batch failed:', e.message);
    }
  }
}

// C creature, P planeswalker, B battle, L land, I instant, S sorcery, A artifact, E enchantment
const typeLetter = (t) => (/Creature/.test(t) ? 'C' : /Planeswalker/.test(t) ? 'P' : /Battle/.test(t) ? 'B' : /Land/.test(t) ? 'L' : /Instant/.test(t) ? 'I' : /Sorcery/.test(t) ? 'S' : /Artifact/.test(t) ? 'A' : /Enchantment/.test(t) ? 'E' : 'O');

const WUBRG = 'WUBRG';
const sortColors = (set) => [...set].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');

function deckColors(list, cards, fmtKey) {
  if (!list) return null;
  const set = new Set();
  let cmdrs = list.c?.length ? list.c : null;
  if (!cmdrs && fmtKey === 'cedh' && list.s?.length && list.s.length <= 2) cmdrs = list.s.map((x) => x[1]);
  if (cmdrs) {
    for (const n of cmdrs) for (const ch of cards[n]?.[1] || '') set.add(ch);
    return sortColors(set);
  }
  let known = 0;
  for (const [, n] of list.m || []) {
    const c = cards[n];
    if (!c) continue;
    known++;
    if (c[2] === 1) continue; // lands don't define a deck's colors
    for (const ch of c[1]) set.add(ch);
  }
  return known ? sortColors(set) : null;
}

// Signature card for an archetype: the nonland card its lists share most, discounted when it is a
// format-wide staple (Thoughtseize, Force of Will...). cEDH uses the commander.
function signatureCard(entry, events, decks, cards, days, fmtKey) {
  const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const recent = events.filter((e) => ageDays(e.date) < days);
  const all = [], mine = [];
  for (const e of recent) for (const d of e.top) {
    const l = decks[d.deckId];
    if (!l) continue;
    all.push(l);
    if (norm(d.name) === entry.key) mine.push(l);
  }
  if (!mine.length) return null;
  const pick = (name) => (cards[name] ? { name, id: cards[name][0], artist: cards[name][4] || '' } : null);
  if (fmtKey === 'cedh') {
    const c = mine.find((l) => l.c?.length)?.c[0];
    if (c && pick(c)) return pick(c);
  }
  const freq = new Map();
  for (const l of all) for (const n of new Set(l.m.map((x) => x[1]))) freq.set(n, (freq.get(n) || 0) + 1);
  const score = new Map();
  for (const l of mine) for (const [q, n] of l.m) {
    if (!cards[n] || cards[n][2] === 1) continue;
    score.set(n, (score.get(n) || 0) + q);
  }
  let best = null, bestS = -1;
  for (const [n, s] of score) {
    const v = s / (1 + 3 * ((freq.get(n) || 0) / all.length));
    if (v > bestS) { bestS = v; best = n; }
  }
  return best ? pick(best) : null;
}

// ---------- main ----------
async function updateFormat(key, fmt, cards) {
  const events = await readJson(`events/${key}.json`, []);
  const decks = await readDecks(key);
  const known = new Set(events.map((e) => e.id));

  // 1. discover recent events
  const found = new Map();
  for (let page = 1; page <= 6; page++) {
    let list;
    try {
      list = parseFormatPage(await get(`${BASE}format?f=${fmt.code}&cp=${page}`));
    } catch (e) {
      console.warn(e.message);
      break;
    }
    if (!list.length) break;
    let fresh = 0;
    for (const ev of list) if (!found.has(ev.id)) { found.set(ev.id, ev); fresh++; }
    const oldest = list.reduce((a, e) => (e.date && e.date < a ? e.date : a), '9999');
    if (!fresh || ageDays(oldest) > LOOKBACK_DAYS) break;
  }
  const todo = [...found.values()]
    .filter((e) => !known.has(e.id) && e.date && ageDays(e.date) <= LOOKBACK_DAYS)
    .filter((e) => !/\bleague\b/i.test(e.name) || isMajor(e)) // MTGO leagues have no winner
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_NEW_EVENTS);
  console.log(`${fmt.label}: ${found.size} listed, ${todo.length} new`);

  // 2. fetch each new event + its top-8 lists
  for (const ev of todo) {
    try {
      const html = await get(`${BASE}event?e=${ev.id}&f=${fmt.code}`);
      const info = parseEventPage(html);
      const top = info.decks.filter((d) => d.rank && d.rank <= 8);
      if (!top.length) continue;
      for (const d of top) {
        const page = d === info.decks[0] ? html : await get(`${BASE}event?e=${ev.id}&d=${d.deckId}&f=${fmt.code}`);
        let l = parseDeckList(page);
        // Lists must be complete: 60+ main for constructed, 100 with the commander for cEDH.
        const need = key === 'cedh' ? 100 : 60;
        const total = (x) => countCards(x.main) + (key === 'cedh' && !x.commanders.length ? countCards(x.side) : 0);
        if (total(l) < need) {
          try {
            const exp = parseMtgoExport(await get(`${BASE}mtgo?d=${d.deckId}`));
            if (key === 'cedh' && exp.side.length && exp.side.length <= 2) {
              exp.commanders = exp.side.map(([, n]) => n);
              exp.main = [...exp.side, ...exp.main];
              exp.side = [];
            }
            if (total(exp) > total(l)) l = exp;
          } catch (e) {
            console.warn(`export for deck ${d.deckId} failed: ${e.message}`);
          }
        }
        if (l.main.length) decks[d.deckId] = { m: l.main, s: l.side, c: l.commanders, n: total(l), ok: total(l) >= need };
      }
      events.push({
        id: ev.id,
        name: ev.name,
        location: ev.location,
        date: info.date || ev.date,
        players: info.players || null,
        stars: Math.max(ev.stars || 0, info.stars || 0),
        top: info.decks.filter((d) => d.rank && d.rank <= 16).map((d) => ({
          rank: d.rank, rankLabel: d.rankLabel, deckId: d.deckId, name: d.name, player: d.player,
        })),
      });
    } catch (e) {
      console.warn(`event ${ev.id} skipped: ${e.message}`);
    }
  }

  // 3. retention
  const kept = events.filter((e) => ageDays(e.date) <= KEEP_EVENTS_DAYS).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const listIds = new Set(kept.filter((e) => ageDays(e.date) <= KEEP_LISTS_DAYS).flatMap((e) => e.top.map((d) => String(d.deckId))));
  for (const id of Object.keys(decks)) if (!listIds.has(id)) delete decks[id];
  return { events: kept, decks };
}

async function main() {
  await mkdir(new URL('events/', ROOT), { recursive: true });
  await mkdir(new URL('decks/', ROOT), { recursive: true });
  const cards = await readJson('cards.json', {});
  const results = {};
  for (const [key, fmt] of Object.entries(FORMATS)) results[key] = await updateFormat(key, fmt, cards);

  // card data for every list we keep
  const names = new Set();
  for (const { decks } of Object.values(results))
    for (const l of Object.values(decks)) for (const [, n] of [...l.m, ...l.s]) names.add(n);
  await enrichCards(names, cards);

  const meta = { updated: new Date().toISOString(), formats: {} };
  for (const [key, fmt] of Object.entries(FORMATS)) {
    const { events, decks } = results[key];
    for (const ev of events) {
      ev.major = isMajor(ev);
      for (const d of ev.top) {
        const c = deckColors(decks[d.deckId], cards, key);
        if (c !== null) d.colors = c;
      }
    }
    await writeJson(`events/${key}.json`, events);
    await writeDecks(key, decks);
    meta.formats[key] = {
      label: fmt.label,
      events: events.length,
      lastEvent: events[0]?.date || null,
      recent: events.slice(0, 8).map(({ id, name, date, players, stars, major, top }) => ({
        id, name, date, players, stars, major, winner: top.find((d) => d.rank === 1) || top[0] || null,
      })),
      top: Object.fromEntries([['week', 7], ['month', 30]].map(([k, days]) => [k, topList(events, today, days).map((a) => ({
        ...a, sig: signatureCard(a, events, decks, cards, days, key),
      }))])),
    };
  }
  // keep cards.json limited to names still in use
  const slim = {};
  for (const n of names) if (cards[n]) slim[n] = cards[n];
  await writeJson('cards.json', slim);
  await writeJson('meta.json', meta);
  console.log('Done.', Object.entries(meta.formats).map(([k, f]) => `${k}: ${f.events} events`).join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
