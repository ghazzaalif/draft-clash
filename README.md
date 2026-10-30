# Draft Clash

A 1v1 Dota 2 Captains Mode draft game. Two captains (you against a bot, or two people on one screen) ban and pick five heroes each in the 24-turn tournament order. The match then simulates itself and stops at 15:00, at 30:00 and at the end to show kills, towers, barracks, Roshan and Tormentors.

## Data

All numbers come from OpenDota's public pro-match data for 30 Oct 2025 to 30 Oct 2026 (20,330 matches, 127 heroes):

- `data/heroes.csv`: id, name, attribute, melee/ranged, roles, pro picks, wins, bans, and games:wins by game length (under 30, 30–42, over 42 minutes), internal name.
- `data/vs.txt`, `data/syn.txt`: head-to-head and teammate values for every hero pair (upper triangle, one character per pair). Each value is the pair's win rate minus what the two heroes' own win rates predict, shrunk with 25 pseudo-games, in win-rate points (`ALPH.indexOf(c) - 31`).

## Model

- **Draft score per stage**: hero strength by game length, head-to-head counters, teammate synergy and team-shape penalties, combined into a win chance for early, mid and late game.
- **Simulation**: minute-by-minute fights, kill credit by role, gold lead, tower → barracks → tier 4 → Ancient, Roshan (8–11 min respawn; Aegis, Cheese, Refresher Shard) and Tormentors (from 20:00; Aghanim's Shard). Calibrated so a draft rated 60% wins about 60% of simulated games; games average about 34.5 minutes and 57 kills, close to the pro averages of 34.9 minutes and 58.8 kills.

## Build and run

```
python3 build.py      # writes public/index.html
python3 -m http.server -d public 8000
```

`public/index.html` is self-contained apart from Google Fonts.

## Deploy on Render

`render.yaml` defines a static site: Render runs `python3 build.py` and serves `public/`. In Render, choose **New → Blueprint** (or **New → Static Site**) and select this repository.
