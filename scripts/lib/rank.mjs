// Archetype scoring: rewards winning, finishing high often, and doing it at big / qualifier events.

const PLACE_POINTS = (rank) =>
  rank === 1 ? 10 : rank === 2 ? 7 : rank <= 4 ? 5 : rank <= 8 ? 3 : rank <= 16 ? 1 : 0;

export const MAJOR_RE =
  /qualifier|\bRCQ\b|\bPTQ\b|regional|championship|\bopen\b|pro tour|grand prix|\bGP\b|nationals|showdown|finals|\bcup\b|invitational|\bRC\b/i;

export function eventWeight(ev) {
  const p = Math.max(ev.players || 16, 8);
  let w = 1 + Math.log2(p / 8) * 0.35;
  if ((ev.stars || 0) >= 3) w *= 1.5;
  else if ((ev.stars || 0) === 2) w *= 1.15;
  return w;
}

export const isMajor = (ev) => (ev.stars || 0) >= 3 || MAJOR_RE.test(ev.name || '');

const dayDiff = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;

const normKey = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @param events  [{date, players, stars, name, top:[{rank, deckId, name, colors}]}]
 * @param today   'YYYY-MM-DD'
 * @param days    window length
 * @param offset  shift window back (for trend comparison)
 */
export function scoreArchetypes(events, today, days, offset = 0) {
  const map = new Map();
  let slots = 0;
  for (const ev of events) {
    const age = dayDiff(today, ev.date);
    if (!(age >= offset && age < offset + days)) continue;
    const w = eventWeight(ev);
    const major = isMajor(ev);
    for (const d of ev.top || []) {
      if (!d.rank || d.rank > 16) continue;
      slots++;
      const key = normKey(d.name);
      let a = map.get(key);
      if (!a) {
        a = { key, name: d.name, score: 0, wins: 0, top8: 0, entries: 0, majorTop8: 0, events: new Set(), colorVotes: {}, best: null };
        map.set(key, a);
      }
      a.entries++;
      a.events.add(ev.id);
      a.score += PLACE_POINTS(d.rank) * w;
      if (d.rank === 1) a.wins++;
      if (d.rank <= 8) a.top8++;
      if (d.rank <= 8 && major) a.majorTop8++;
      if (d.colors !== undefined && d.colors !== null) a.colorVotes[d.colors] = (a.colorVotes[d.colors] || 0) + 1;
      const better =
        !a.best || d.rank < a.best.rank || (d.rank === a.best.rank && ev.date > a.best.date);
      if (better) a.best = { deckId: d.deckId, rank: d.rank, date: ev.date, event: ev.name, eventId: ev.id, player: d.player };
    }
  }
  return [...map.values()]
    .map((a) => {
      const colors = Object.entries(a.colorVotes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      return {
        key: a.key,
        name: a.name,
        colors,
        score: Math.round((a.score + a.events.size * 2 + a.majorTop8 * 3) * 10) / 10,
        wins: a.wins,
        top8: a.top8,
        entries: a.entries,
        events: a.events.size,
        majorTop8: a.majorTop8,
        share: slots ? Math.round((a.entries / slots) * 1000) / 10 : 0,
        best: a.best,
      };
    })
    .sort((x, y) => y.score - x.score || y.wins - x.wins || y.top8 - x.top8);
}

/** Top N with trend vs the previous window of the same length. */
export function topList(events, today, days, n = 10) {
  const now = scoreArchetypes(events, today, days);
  const prev = scoreArchetypes(events, today, days, days);
  const prevRank = new Map(prev.map((a, i) => [a.key, i + 1]));
  return now.slice(0, n).map((a, i) => {
    const p = prevRank.get(a.key);
    return { ...a, rank: i + 1, prevRank: p ?? null, trend: p == null ? 'new' : p - (i + 1) };
  });
}
