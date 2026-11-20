#!/usr/bin/env node
// Bundles the whole site (HTML, CSS, JS and data/*.json) into one file you can open by double-clicking.
//   node scripts/build-standalone.mjs                 -> dist/meta-grimoire.html from ./data
//   DATA_DIR=/path SAMPLE=1 node scripts/build-standalone.mjs  -> marks the build as sample data
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dataDir = process.env.DATA_DIR ? new URL(`file://${process.env.DATA_DIR.replace(/\/?$/, '/')}`) : new URL('data/', root);
const read = (p, base = root) => readFile(new URL(p, base), 'utf8');

const files = {};
const add = async (rel) => { try { files[`data/${rel}`] = JSON.parse(await read(rel, dataDir)); } catch {} };
await add('meta.json');
await add('cards.json');
for (const dir of ['events', 'decks']) {
  for (const f of await readdir(new URL(`${dir}/`, dataDir)).catch(() => [])) if (f.endsWith('.json')) await add(`${dir}/${f}`);
}

const css = await read('css/styles.css');
const colors = (await read('js/colors.js')).replace(/^export /gm, '');
const app = (await read('js/app.js')).replace(/^import .*?;\n/m, '');
const payload = JSON.stringify({ sample: !!process.env.SAMPLE, files }).replace(/</g, '\\u003c');

let html = await read('index.html');
html = html
  .replace(/\s*<link rel="preload" href="data\/meta.json"[^>]*>/, '')
  .replace('<link rel="stylesheet" href="css/styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="js/app.js"></script>', '')
  .replace('</body>', () => `<script id="embedded-data" type="application/json">${payload}</script>\n<script type="module">\n${colors}\n${app}\n</script>\n</body>`);

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/meta-grimoire.html', root), html);
console.log(`dist/meta-grimoire.html written (${(html.length / 1024).toFixed(0)} KB, ${Object.keys(files).length} data files${process.env.SAMPLE ? ', sample data' : ''})`);
