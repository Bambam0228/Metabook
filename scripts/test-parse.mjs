// Run: node scripts/test-parse.mjs  — checks the parsers against saved MTGTop8 pages.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseFormatPage, parseEventPage, parseDeckList, parseRank, parseMtgoExport, countCards } from './lib/parse.mjs';
import { scoreArchetypes } from './lib/rank.mjs';

const fmt = parseFormatPage(readFileSync(new URL('./fixtures/format_MO.html', import.meta.url), 'utf8'));
assert.ok(fmt.length >= 20, `expected >=20 events, got ${fmt.length}`);
const ch = fmt.find((e) => e.id === 94075);
assert.equal(ch.name, 'MTGO Challenge 16');
assert.equal(ch.stars, 2);
assert.equal(ch.date, '2026-11-19');
const unity = fmt.find((e) => e.id === 93550);
assert.equal(unity.stars, 3);
assert.match(unity.location, /Hof/);

const ev = parseEventPage(readFileSync(new URL('./fixtures/event_MO.html', import.meta.url), 'utf8'));
assert.equal(ev.players, 33);
assert.equal(ev.date, '2026-11-19');
assert.equal(ev.stars, 2);
assert.equal(ev.decks.length, 4);
assert.deepEqual(ev.decks[0], { rank: 1, rankLabel: '1', deckId: 914269, name: 'Cosmogoyf', player: 'hellisreal' });
assert.equal(ev.decks[2].rank, 3);

const list = parseDeckList(readFileSync(new URL('./fixtures/event_MO.html', import.meta.url), 'utf8'));
assert.equal(list.main.length, 6);
assert.deepEqual(list.main[0], [4, 'Blackcleave Cliffs']);
assert.deepEqual(list.side[1], [3, 'Veil of Summer']);

const cmd = parseDeckList('<div class="O14">COMMANDER</div><div id="mdabc1" class="deck_line hover_tr">1 <span class="L14">Kinnan, Bonder Prodigy</span></div><div class="O14">1 CREATURES</div><div id="mdx2" class="deck_line hover_tr">1 <span class="L14">Birds of Paradise</span></div>');
assert.deepEqual(cmd.commanders, ['Kinnan, Bonder Prodigy']);
assert.equal(parseRank('9-16'), 9);

const exp = parseMtgoExport('4 Lightning Bolt\r\n56 Mountain\r\n\r\nSideboard\r\n15 Pyroblast\r\n');
assert.equal(countCards(exp.main), 60);
assert.equal(countCards(exp.side), 15);
const exp2 = parseMtgoExport('1 Sol Ring\n98 Island\n\n1 Kinnan, Bonder Prodigy\n');
assert.equal(countCards(exp2.main), 99);
assert.deepEqual(exp2.side, [[1, 'Kinnan, Bonder Prodigy']]);

// Ranking sanity
const today = '2026-11-20';
const events = [
  { id: 1, date: '2026-11-19', players: 64, stars: 2, name: 'Challenge', top: [
    { rank: 1, deckId: 11, name: 'Boros Aggro', colors: 'RW' },
    { rank: 2, deckId: 12, name: 'Amulet Titan', colors: 'G' },
  ] },
  { id: 2, date: '2026-11-18', players: 32, stars: 1, name: 'Local', top: [
    { rank: 1, deckId: 21, name: 'Boros Aggro', colors: 'RW' },
  ] },
  { id: 3, date: '2026-10-01', players: 32, stars: 1, name: 'Old', top: [
    { rank: 1, deckId: 31, name: 'Old Deck', colors: 'B' },
  ] },
];
const wk = scoreArchetypes(events, today, 7);
assert.equal(wk[0].name, 'Boros Aggro');
assert.equal(wk[0].wins, 2);
assert.ok(!wk.find((a) => a.name === 'Old Deck'));
console.log(`OK — ${fmt.length} events parsed, ${ev.decks.length} standings, ranking top: ${wk[0].name}`);
