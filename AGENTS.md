# AGENTS.md — MKSZ-overlay (MKSZ Live Overlay)

Instructions for any AI coding agent or human developer. This repo is PUBLIC: never commit private
room names, keys or links.

## What it is
Broadcast overlay for Hungarian handball matches: live data from the Hungarian federation's livescore
(MKSZ — livescore.mksz.hu, real-time over socket.io at livescore-socket.mksz.hu) shown as an overlay
in OBS / Yolobox. Same idea as `handball-overlay`, different data source. Hungarian/English UI.

## Pages (static HTML, no build step)
- `index.html` — start page (Kezdés / Start): creates the room and shows the control/output links.
- `control.html` — operator panel (Vezérlő): connects to the MKSZ livescore, writes state to Firebase.
- `output.html` — the overlay read by OBS/Yolobox.

## Hosting
- GitHub Pages: https://pakotz-coder.github.io/MKSZ-overlay/ — deploy = push to `main`.
- Firebase Realtime Database (project `kezilabda-overlay`, europe-west1). The Firebase web config in the
  HTML is public by design; access is controlled by the database rules (managed in the Firebase console).

## Rules
- The room id acts as the password: never log or commit real room names.
- One socket connection per open control panel; no extra polling of the MKSZ site.
- Render feed data as text (escaped), never as HTML.
- Test locally with any static server (e.g. `npx serve .`) and a test room.
