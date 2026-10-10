# Claude Play Arcade

A monorepo of single-file browser games. Play them at **https://jchandra74.github.io/claude_play/**.

## Games

| Game | Folder | Description |
|---|---|---|
| [Neon Breaker](https://jchandra74.github.io/claude_play/games/neon-breaker/) | `games/neon-breaker/` | Synthwave brick-breaker with bosses, power-ups, combos and a live-synthesised soundtrack. Mouse, keyboard or touch. |

## Layout

```
index.html                 # catalogue page linking to every game
games/<slug>/index.html    # the game: one self-contained HTML file
games/<slug>/cover.jpg     # 16:9 cover image shown in the catalogue (1280x720)
```

## Adding a game

1. Create `games/<slug>/index.html` (keep it a single self-contained file).
2. Add a 1280x720 `games/<slug>/cover.jpg`.
3. Add an entry to the `GAMES` array in the root `index.html` (slug, title, tagline, tags).
4. Add a row to the table above.

## Publishing

GitHub Pages serves the `gh-pages` branch, which mirrors this layout (catalogue at the root, games under `games/`).
