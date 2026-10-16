# Claude Play Arcade

A monorepo of single-file browser games, published to GitHub Pages straight from `main` (merging to `main` publishes).

## Layout

- `index.html`: the catalogue page. Every game is an entry in its `GAMES` array.
- `games/<slug>/index.html`: one game, one **self-contained** HTML file. Vanilla JS, no libraries, no network requests, no external assets. Audio is synthesised with WebAudio.
- `games/<slug>/cover.jpg`: 1280x720 cover for the catalogue.
- `tools/pixel-lint.mjs`: quality checker for pixel-art games (Playwright + headless Chromium, both preinstalled).
- `.claude/skills/pixel-art/`: the pixel-art quality bar (`SKILL.md`), a starter `template.html`, and the exemplar prompts.

## Pixel-art games

Any game or scene with pixel/8-bit/16-bit visuals follows the `pixel-art` skill. Load it before
planning, start from its `template.html`, and write the plan it asks for before code.

A pixel game is not done until:

```
node tools/pixel-lint.mjs games/<slug>/index.html
```

passes with no FAIL, and you have looked at the PNG captures it writes and fixed what you saw.
Games expose `window.PIXEL = { canvas, palette, scenes }` so the linter can check every pixel against
the palette and capture each scene.

## Adding a game

1. `games/<slug>/index.html` (single file) plus a 1280x720 `games/<slug>/cover.jpg`.
2. Add an entry to `GAMES` in the root `index.html` (slug, title, tagline, tags).
3. Add a row to the table in `README.md`.
4. Desktop: keyboard. Phones: landscape with on-screen touch controls (see Iron Comet for the pattern).
