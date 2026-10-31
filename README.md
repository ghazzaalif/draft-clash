# Draft Clash

A 1v1 Dota 2 Captains Mode draft game. Two captains ban and pick five heroes each in the 24-turn tournament order. The match then simulates itself and stops at 15:00, at 30:00 and at the end to show kills, towers, barracks, Roshan and Tormentors.

## Ways to play

After the draft each captain sets positions 1 to 5 (carry, mid, offlane, soft support, hard support). Positions decide the lanes (Radiant's safe lane is bottom, Dire's is top) and change the win chance: heroes played far from where pros play them lose points, more so for supports early and carries late. Against the bot or online, the opponent's positions stay hidden until both captains lock in.

- **Bot**: you draft against a bot (Easy, Normal or Hard).
- **Same screen**: two captains share one device.
- **Online**: one captain clicks **Host a room** and sends the 5-character code (or the invite link) to the other, who enters it under **Join**. The room server checks every ban and pick, then gives both browsers the same match seed so they watch the identical match. The match waits at the start, at 15:00 and at 30:00 until both captains press continue. Reloading the page or a dropped connection rejoins the same seat.

Hero portraits are Valve's official Dota 2 images, loaded from Valve's CDN (the same source OpenDota uses). If one fails to load, a coloured monogram takes its place.

## Data

All numbers follow the live patch, **7.41f** (released 15 Sep 2026). Hero data comes from OpenDota's public pro-match data for patch 7.41 only: 8,881 matches from 24 Mar to 30 Oct 2026, 127 heroes. Games are weighted toward the live letter patch: 7.41f ×1.0 (954 matches), 7.41e ×0.6, 7.41d ×0.35, 7.41 to 7.41c ×0.15; older patches are left out. Counts in the data files are these weighted counts (about 2,760 match-equivalents).

- `data/heroes.csv`: id, name, attribute, melee/ranged, roles, weighted picks, wins, bans, weighted games:wins by game length (under 30, 30–42, over 42 minutes), internal name, then unweighted picks and bans on 7.41 and games and wins on 7.41f (for display).
- `data/positions.csv`: hero id, then pro games:wins at positions 1–5. Position comes from each player's lane (safe, mid, off) and farm order within that lane: the higher-GPM safe laner is position 1, the other is 5; the higher-GPM offlaner is 3, the other is 4. Teams that did not play a 2-1-2 lane setup are left out (91% of hero-games are classified).
- `data/vs.txt`, `data/syn.txt`: head-to-head and teammate values for every hero pair (upper triangle, one character per pair). Each value is the pair's win rate minus what the two heroes' own win rates predict, shrunk with 25 pseudo-games, in win-rate points (`ALPH.indexOf(c) - 31`).

## Model

- **Draft score per stage**: hero strength by game length, head-to-head counters, teammate synergy and team-shape penalties, combined into a win chance for early, mid and late game.
- **Positions**: off-role heroes (under 15% of their pro games at that position) lose up to 6 points, and a hero's pro win rate at its position adds or removes up to 2; both count more for supports early and carries late. Lane matchups count in the early and mid game.
- **Simulation**: a laning phase to 10:00 where kills happen between the heroes laning against each other, then each lane is won, lost or even; then minute-by-minute fights, kill credit by role, gold lead, tower → barracks → tier 4 → Ancient, Roshan and the Tormentor on 7.41f rules: Roshan respawns 8–11 minutes after dying and drops the Aegis every time, plus Roshan's Banner on the second kill and Cheese and a Refresher Shard from the third; he starts in the top pit and from 15:00 swaps pits at each day/night change. One Tormentor spawns at 20:00 in the bottom corner, always on the side away from Roshan, and returns 10 minutes after it dies; its Aghanim's Shard goes to a low-net-worth hero without one. Calibrated so a draft rated 60% wins about 60% of simulated games; games average about 39.6 minutes and 58.5 kills, with about one in five ending before 30:00, close to the weighted 7.41 pro averages of 38.7 minutes and 58.7 kills (23% under 30:00).

## Build and run

```
python3 build.py      # writes public/index.html
python3 -m http.server -d public 8000
```

## Deploy on Render

`render.yaml` defines two services:

- `draft-clash`: static site. Render runs `python3 build.py` and serves `public/`.
- `draft-clash-rooms`: Node WebSocket room server in `server/` (free plan). It sleeps after 15 idle minutes, so the first online game after a quiet spell waits up to a minute while it wakes.

The page connects to `wss://draft-clash-rooms.onrender.com` by default. Set `DC_SERVER` when building to point elsewhere, or add `?server=wss://…` to the page URL for testing.

## Run the room server locally

```
cd server && npm install && node index.js        # listens on :10000
python3 -m http.server -d public 8000
# open http://localhost:8000/?server=ws://localhost:10000 in two browsers
```
