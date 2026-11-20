// Parsers for MTGTop8 pages. Kept tolerant of absolute or relative links and &amp; vs &.

const decode = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

/** "19/11/26" -> "2026-11-19" */
export function parseDate(ddmmyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(ddmmyy || '');
  if (!m) return null;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

/** "1" -> 1, "3-4" -> 3, "5-8" -> 5, "9-16" -> 9 */
export function parseRank(txt) {
  const m = /^(\d+)/.exec(String(txt).trim());
  return m ? Number(m[1]) : null;
}

/** Events listed on a format page (format?f=XX). */
export function parseFormatPage(html) {
  const out = new Map();
  const row =
    /<a href="(?:https?:\/\/www\.mtgtop8\.com\/)?event\?e=(\d+)&(?:amp;)?f=[\w]+">([^<]+)<\/a>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*class="S12"[^>]*>\s*(\d{2}\/\d{2}\/\d{2})\s*<\/td>/gs;
  let m;
  while ((m = row.exec(html))) {
    const [, id, name, rest, starsTd, date] = m;
    if (out.has(id)) continue;
    const loc = /@\s*<a[^>]*>([^<]+)<\/a>/.exec(rest);
    out.set(id, {
      id: Number(id),
      name: decode(name),
      location: loc ? decode(loc[1]) : '',
      stars: (starsTd.match(/star\.png/g) || []).length,
      bigstar: /bigstar\.png/.test(starsTd),
      date: parseDate(date),
    });
  }
  return [...out.values()];
}

/** Event page: header info + standings rows. */
export function parseEventPage(html) {
  const info = {};
  const pd = /(\d+)\s+players\s*-\s*(\d{2}\/\d{2}\/\d{2})/.exec(html);
  if (pd) {
    info.players = Number(pd[1]);
    info.date = parseDate(pd[2]);
  } else {
    const d = /(?:Date|>)\s*:?\s*(\d{2}\/\d{2}\/\d{2})\s*</.exec(html);
    if (d) info.date = parseDate(d[1]);
  }
  const arch = /<div class="meta_arch"[^>]*>(.*?)<\/div>/s.exec(html);
  if (arch) info.stars = (arch[1].match(/star\.png/g) || []).length;

  const decks = [];
  const seen = new Set();
  const rowRe =
    /<div style="width:42px;"[^>]*class="S14">\s*([^<]+?)\s*<\/div>(.*?)class="player"[^>]*>([^<]+)<\/a>/gs;
  let m;
  while ((m = rowRe.exec(html))) {
    const [, rankTxt, mid, player] = m;
    const link = /event\?e=(\d+)&(?:amp;)?d=(\d+)[^"]*">([^<]+)<\/a>/.exec(
      mid.replace(/<a href="[^"]*"><img[^>]*><\/a>/g, ''),
    );
    if (!link) continue;
    const deckId = Number(link[2]);
    if (seen.has(deckId)) continue;
    seen.add(deckId);
    decks.push({
      rank: parseRank(rankTxt),
      rankLabel: decode(rankTxt),
      deckId,
      name: decode(link[3]),
      player: decode(player),
    });
  }
  return { ...info, decks };
}

/**
 * Decklist shown on an event page with &d=ID.
 * Returns { main:[[qty,name]], side:[[qty,name]], commanders:[name] }.
 */
export function parseDeckList(html) {
  const main = [];
  const side = [];
  const commanders = [];
  let section = '';
  const tok =
    /<div class="O14"[^>]*>([^<]+)<\/div>|<div id="(md|sb)[^"]*" class="deck_line[^"]*">\s*(\d+)\s*<span class="L14">([^<]+)<\/span>/g;
  let m;
  while ((m = tok.exec(html))) {
    if (m[1] !== undefined) {
      section = m[1].toUpperCase();
      continue;
    }
    const qty = Number(m[3]);
    const name = decode(m[4]);
    if (/COMMANDER/.test(section)) commanders.push(name);
    if (m[2] === 'sb') side.push([qty, name]);
    else main.push([qty, name]);
  }
  return { main, side, commanders };
}

/** MTGTop8 "mtgo?d=ID" text export: "4 Card Name" lines, then "Sideboard" (or a blank line) and the sideboard. */
export function parseMtgoExport(text) {
  const main = [], side = [];
  let inSide = false, seenMain = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { if (seenMain) inSide = true; continue; }
    if (/^sideboard/i.test(line)) { inSide = true; continue; }
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    (inSide ? side : main).push([Number(m[1]), decode(m[2])]);
    if (!inSide) seenMain = true;
  }
  return { main, side, commanders: [] };
}

export const countCards = (rows) => rows.reduce((a, [q]) => a + q, 0);
