# AGENTS.md — MKSZ-overlay (MKSZ Live Overlay)

Instructions for any AI coding agent or human developer. This repo is PUBLIC: never commit private
room names, keys or links.

## What it is
Broadcast overlay for Hungarian handball matches: live data from the Hungarian federation's livescore
(MKSZ — livescore.mksz.hu, real-time over socket.io at livescore-socket.mksz.hu) shown as an overlay
in OBS / Yolobox. Same idea as `handball-overlay`, different data source. Hungarian/English UI.

## Files (static, no build step)
- `index.html` — start page (Kezdés / Start): turns a typed name into a secret room id and shows the
  control/output links.
- `control.html` — operator panel (Vezérlő): connects to the MKSZ livescore, writes to Firebase
  `rooms/{room}` (`state`, `display`, `colors`). Hotkeys, carousel presets, opacity, clock hold.
- `output.html` — the overlay read by OBS/Yolobox. Only reads `rooms/{room}`; the carousel runs here.
- `feed.js` — the feed reducer (pure logic, also runs in Node). Keeps every event and rebuilds the whole
  state from the log, because the feed re-sends edited events (same UUID) and sends `deleted: true`.
- `demo.js` — an invented match in the feed's event shape (`control.html?demo=1`, or the Demó button).
- `test/feed.test.js` — reducer tests: `node --test test/feed.test.js`.
- `export.html` — thumbnail and statistics image as PNG (see Exports).
- `database.rules.json` — Realtime Database rules.

## Hosting
- GitHub Pages: https://pakotz-coder.github.io/MKSZ-overlay/ — deploy = push to `main`.
- Firebase Realtime Database (project `kezilabda-overlay`, europe-west1). Rules live in
  `database.rules.json` and are published by hand in the Firebase console (Realtime Database → Rules).
  The Firebase web config in the HTML is public by design; access is controlled by the rules.
  A new field under `display` or `colors` must be added to the rules too, or the write is rejected.

## What the feed does and does not give
- Events: goals (`gol`, `gol7m`; beach `gol2p`, `gol6m` = 2 points), saves, post, miss, block, turnovers,
  cards (`sargalap`, `piroslap`, `keklap`), suspensions (`kiallitas`, `2perc`, `4perc`), time-outs,
  court zone (`selectedArea` 0–16, penalties shown as 17) and goal cell (`selectedGateArea` 1–9).
- No clock start/stop signal (`playtime` is per-player minutes, not the match clock). The overlay clock
  runs on from the last event, holds on a time-out and re-syncs on the next event; the operator can hold it.
- No player rating: "A mezőny legjobbjai" shows the top scorer and the keeper, nothing computed beyond that.
- Finished matches leave the socket (`nodatafound`); the overlay is for live matches.

## Rules
- The room id is the only secret ("room = password"): never log or commit real room names.
- One socket connection per open control panel; no extra polling of the MKSZ site.
- Everything read from the room is untrusted: escape text (`esc`), whitelist colours and URLs. Never
  put feed data into HTML unescaped.
- Test locally with any static server (e.g. `npx serve .`), the demo match and a throwaway room.

## Exports
- `export.html?room=...&kind=thumb|stats` draws the YouTube thumbnail (1280x720) or the statistics image
  (1920x1080) on a canvas from the room's state and offers it as a PNG. A crest is drawn only if it loads
  with CORS (directly, then through images.weserv.nl); otherwise the team's initials are used.
- Feed crest URLs are signed and expire after 24 hours, so crests only show around the match itself.
- `rooms/{room}/info` holds the operator-typed competition and venue; they override the feed's values.
- `control.html` also writes the YouTube title and description from the current state.

## Look
- The palette follows the MKSZ livescore page: red `#F93154`, green `#1FB768`, navy `#1F2630`, light panels.
  In `output.html` every surface colour is a CSS variable on `:root`; `output.html?theme=dark` switches to
  the earlier dark look (`html.dark`). Team colours come from the room and default to the red and green.
