// Official Magic color-combination names (guilds, shards, wedges, 4-color "Nephilim" names)
// plus common aliases (Strixhaven colleges, Tarkir clans, Ikoria triomes, "sans" names).
export const WUBRG = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };

export const COMBOS = [
  { key: '', name: 'Colorless', group: 'Colorless', aliases: ['colorless', 'c', 'eldrazi'] },
  { key: 'W', name: 'Mono-White', group: 'Mono', aliases: ['white', 'mono white', 'w'] },
  { key: 'U', name: 'Mono-Blue', group: 'Mono', aliases: ['blue', 'mono blue', 'u'] },
  { key: 'B', name: 'Mono-Black', group: 'Mono', aliases: ['black', 'mono black', 'b'] },
  { key: 'R', name: 'Mono-Red', group: 'Mono', aliases: ['red', 'mono red', 'r'] },
  { key: 'G', name: 'Mono-Green', group: 'Mono', aliases: ['green', 'mono green', 'g'] },

  { key: 'WU', name: 'Azorius', group: 'Guilds', aliases: ['azorius senate'] },
  { key: 'UB', name: 'Dimir', group: 'Guilds', aliases: ['house dimir'] },
  { key: 'BR', name: 'Rakdos', group: 'Guilds', aliases: ['cult of rakdos'] },
  { key: 'RG', name: 'Gruul', group: 'Guilds', aliases: ['gruul clans'] },
  { key: 'WG', name: 'Selesnya', group: 'Guilds', aliases: ['selesnya conclave'] },
  { key: 'WB', name: 'Orzhov', group: 'Guilds', aliases: ['orzhov syndicate', 'silverquill'] },
  { key: 'UR', name: 'Izzet', group: 'Guilds', aliases: ['izzet league', 'prismari'] },
  { key: 'BG', name: 'Golgari', group: 'Guilds', aliases: ['golgari swarm', 'witherbloom'] },
  { key: 'WR', name: 'Boros', group: 'Guilds', aliases: ['boros legion', 'lorehold'] },
  { key: 'UG', name: 'Simic', group: 'Guilds', aliases: ['simic combine', 'quandrix'] },

  { key: 'WUG', name: 'Bant', group: 'Shards', aliases: ['bant'] },
  { key: 'WUB', name: 'Esper', group: 'Shards', aliases: ['obscura'] },
  { key: 'UBR', name: 'Grixis', group: 'Shards', aliases: ['maestros'] },
  { key: 'BRG', name: 'Jund', group: 'Shards', aliases: ['riveteers'] },
  { key: 'WRG', name: 'Naya', group: 'Shards', aliases: ['cabaretti'] },

  { key: 'WBG', name: 'Abzan', group: 'Wedges', aliases: ['indatha', 'doran', 'junk'] },
  { key: 'WUR', name: 'Jeskai', group: 'Wedges', aliases: ['raugrin', 'american'] },
  { key: 'UBG', name: 'Sultai', group: 'Wedges', aliases: ['zagoth', 'bug'] },
  { key: 'WBR', name: 'Mardu', group: 'Wedges', aliases: ['savai'] },
  { key: 'URG', name: 'Temur', group: 'Wedges', aliases: ['ketria', 'rug'] },

  { key: 'UBRG', name: 'Glint-Eye', group: 'Four-Color', aliases: ['non-white', 'sans white', 'chaos', 'glint eye'] },
  { key: 'WBRG', name: 'Dune-Brood', group: 'Four-Color', aliases: ['non-blue', 'sans blue', 'aggression', 'dune brood'] },
  { key: 'WURG', name: 'Ink-Treader', group: 'Four-Color', aliases: ['non-black', 'sans black', 'altruism', 'ink treader'] },
  { key: 'WUBG', name: 'Witch-Maw', group: 'Four-Color', aliases: ['non-red', 'sans red', 'growth', 'witch maw'] },
  { key: 'WUBR', name: 'Yore-Tiller', group: 'Four-Color', aliases: ['non-green', 'sans green', 'artifice', 'yore tiller'] },

  { key: 'WUBRG', name: 'Five-Color', group: 'Five-Color', aliases: ['wubrg', 'domain', 'rainbow', '5c', '5 color'] },
];

export const sortKey = (s) =>
  [...new Set(String(s).toUpperCase().replace(/[^WUBRG]/g, ''))]
    .sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b))
    .join('');

export const comboByKey = (k) => COMBOS.find((c) => c.key === sortKey(k ?? ''));
export const comboName = (k) => (k == null ? 'Unknown' : comboByKey(k)?.name || k);

/** Turn user input ("boros", "rw", "W/R", "grixis", "sans green") into a color key or null. */
export function parseColorQuery(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  const exact = COMBOS.find((c) => c.name.toLowerCase() === s || c.aliases.includes(s));
  if (exact) return exact.key;
  const pref = COMBOS.find((c) => c.name.toLowerCase().startsWith(s) || c.aliases.some((a) => a.startsWith(s) && s.length >= 3));
  if (pref) return pref.key;
  if (/^[wubrgc\s/,+-]+$/i.test(s)) return sortKey(s);
  return null;
}

/** Combos whose name/alias starts with or contains the query — for suggestions. */
export function suggestCombos(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  return COMBOS.filter((c) => c.name.toLowerCase().includes(s) || c.aliases.some((a) => a.includes(s))).slice(0, 6);
}

const SYMBOL = (c) => `https://svgs.scryfall.io/card-symbols/${c}.svg`;
export const pipsHTML = (key, size = 18) => {
  if (key == null) return '<span class="pip-unknown" title="Colors unknown">?</span>';
  const list = key === '' ? ['C'] : [...key];
  return `<span class="pips" title="${comboName(key)}">${list
    .map((c) => `<img src="${SYMBOL(c)}" alt="{${c}}" width="${size}" height="${size}" decoding="async">`)
    .join('')}</span>`;
};
export const symbolURL = SYMBOL;

/** Card-frame colors for a color identity: mono = its color, two = split hybrid frame, three+ = gold, none = artifact. */
const FRAME = { W: 'var(--fw)', U: 'var(--fu)', B: 'var(--fb)', R: 'var(--fr)', G: 'var(--fg)' };
export function frameVars(key) {
  if (key == null) return '--f1:var(--seam);--f2:var(--seam)';
  const c = [...key];
  if (!c.length) return '--f1:var(--artifact);--f2:var(--artifact)';
  if (c.length === 1) return `--f1:${FRAME[c[0]]};--f2:${FRAME[c[0]]}`;
  if (c.length === 2) return `--f1:${FRAME[c[0]]};--f2:${FRAME[c[1]]}`;
  return '--f1:var(--gold);--f2:var(--gold)';
}
