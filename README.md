# Meta Grimoire

Daily-updated MTG tournament meta for **cEDH, Modern, Standard and Legacy**.

- **Home**: the headline is the control (“What's winning in cEDH / Modern / Standard / Legacy this week / month”). Three random cards sit next to it, with a new set on every page switch. **Reveal the top 10** deals the ten best archetypes out as real card frames: the frame color is the deck's color identity, the art is its signature card, and the P/T box shows wins/top 8s.
- **Tournaments**: 120 days of event history per format, with top-8 standings and full decklists (copy button, list or visual view).
- **Colors**: a clickable color pie, plus search by official color-combination names (Boros, Izzet, Grixis, Golgari, Esper, Glint-Eye, Yore-Tiller, Strixhaven college names, "sans green"…) or by toggling mana symbols, with exact or includes matching.
- **Card Lookup**: search any card (Scryfall syntax works). Results open in a collector's binder; picking a card opens **its own binder with every printing ever made**, oldest or newest first, with price stickers and a holo sheen on foil-only printings. Pages turn with a 3D page flip (buttons, arrow keys or swipe). **Find a printing** jumps straight to a set, year or collector number, and clicking any pocket opens the rules text plus a searchable price table (non-foil / foil / etched USD, EUR, TIX).
- **Decks**: every list is checked for completeness (60+ main for constructed, 100 with commander for cEDH). If MTGTop8's page is short, the updater falls back to its MTGO export, and incomplete lists are flagged. Views: **List**, **Stacks**, and **On the table**, a 3D wooden table with a playmat in the deck's colors and a d20. 60-card decks are laid out by mana value with lands and sideboard separate; cEDH decks are laid out commander, creatures, instants, sorceries, enchantments, artifacts, lands. Drag to turn the table.
- **Hover any card name** to see the full card, which follows the cursor smoothly. On phones, tap a card name.
- Art is official Magic art from Scryfall (`art_crop`), credited to the artist, per [Scryfall's image guidelines](https://scryfall.com/docs/api/images) and the WotC Fan Content Policy. No AI art.

## How the daily update works

`.github/workflows/update-meta.yml` runs every day at 10:23 UTC (also on demand):

1. `scripts/update.mjs` reads the MTGTop8 format pages for the 4 formats and picks up new events from the last 35 days. MTGO leagues are skipped because they have no winner.
2. For each new event it saves the top 8 standings and decklists, waiting about 1 s between requests.
3. New card names are looked up in Scryfall's `/cards/collection` to get each card's color identity and image.
4. Archetypes are ranked for the last 7 and 30 days. Points come from placement (1st 10, 2nd 7, top 4 5, top 8 3, top 16 1), weighted by event size and stars. Bonuses go to showing up across many events and to top 8s at majors or qualifiers (RCQ, PTQ, Regional, Open, Championship…). A trend arrow compares each archetype with the previous window.
5. The job commits `data/`. Netlify redeploys on that push.

History is kept for 120 days and decklists for 60 days. Decklists are split into 16 files per format so opening a deck downloads only a small part.

## Setup (about 5 minutes)

1. Create a GitHub repo (private is fine) and push this folder to `main`.
2. Repo **Settings → Actions → General → Workflow permissions →** select **Read and write**.
3. The first push starts the workflow by itself. You can also go to **Actions → Daily meta update → Run workflow**. The first run backfills about a month of events and takes around 20–40 minutes.
4. On Netlify, choose **Add new site → Import from Git**, pick the repo, and leave the build command empty with publish directory `.`.

One-file version (opens with a double-click, data inlined): `node scripts/build-standalone.mjs` writes `dist/meta-grimoire.html` from the current `data/`.

Run it locally: `python3 -m http.server` and open http://localhost:8000.
Test the parsers: `node scripts/test-parse.mjs`.
Do a quick small update: `MAX_NEW_EVENTS=5 LOOKBACK_DAYS=7 node scripts/update.mjs`.

## Notes

- Tournament data is scraped from MTGTop8, which has no public API, so a layout change on their side could break the parser. The workflow runs `test-parse.mjs` first, so a failure shows up red in Actions.
- Prices come from Scryfall's daily snapshot: TCGplayer market for USD, Cardmarket for EUR, Cardhoarder for TIX.
- Fan Content notice: Meta Grimoire is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
