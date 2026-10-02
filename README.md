# FACTORY FIGHT 🔧⚔️

A **passthrough-AR tower defense** for Quest, played with **your bare hands**
against the real walls of your real room. Built on the engine of
[TUBES](https://github.com/yellkell/Tubes-), at **0.7 scale** so a whole
battlefield fits on your floor.

Something lives behind your walls. Place your core, and it comes for it.

- **Place the CORE.** A new siege offers exactly one thing: the core. Put it
  anywhere on your floor.
- **The LANES appear.** Up to four glowing roads run from cracks at the foot
  of your real walls to the core, with chevrons flowing toward it. They are
  laid once, when the core lands. Wave 1 opens one lane; later waves open
  more. A lane that hasn't opened yet is drawn faint and dashed, so you can
  see where it will come.
- **Build TOWERS beside the lanes,** anywhere on the floor except on a lane.
  Towers aim and fire on their own:

  | Tower | Coins | What it does |
  | --- | --- | --- |
  | TURRET | 50 | rapid tracer slugs, a mite a shot |
  | PISTON | 60 | a ram that shoves the front of a column back down its lane and stuns it |
  | FLAMER | 80 | a cone of fire that sets the whole column (and the floor) burning |
  | TESLA COIL | 100 | a bolt that chains through ten of them at once |
  | MORTAR | 120 | lobs shells into the thick of a lane; long reach, blind up close |

- **Touch a tower to UPGRADE or SELL it.** Three levels: each costs a share of
  the tower's price and buys damage, reach and rate of fire, shown on the
  panel as now → next. An upgraded tower stands a little bigger and wears a
  neon ring per level. Selling returns 70% of everything you put in.
- **Coins** come from kills (1 a mite, 5 a beetle, 60 a hulk) and from every
  wave you clear (40 + 15 × the wave). You start with 150.
- **They come in TIDES.** When the horn goes they pour out of the open cracks
  and march their lanes: a hundred-odd in the first wave, thousands by the
  end. There are three kinds, all the same neon-legged body:
  - **MITE:** the tide itself. Tiny, quick, and one hit kills it.
  - **BEETLE:** a lime-green shell that takes a few hits.
  - **HULK:** a big orange bruiser in the middle of the tide.
- **Whatever reaches the core takes a bite and is gone** (1 for a mite, 4 for
  a beetle, 25 for a hulk, out of 100). The core never heals.
- **They come apart.** Each death bursts into neon shards that bounce across
  the floor, leaves a glowing stain, and pops. The core's plate keeps the body
  count.
- **Ten waves,** each adding a tower or a threat, up to THE LAST SHIFT (3,600
  mites, 200 beetles, 6 hulks). After that comes OVERTIME, which never ends.

## Neon

Every tower is near-black glass traced in neon, standing on a ring of the same
light: TURRET red, PISTON steel white, FLAMER flame orange, TESLA COIL violet,
MORTAR teal, and the CORE gold. The tide and its lanes are magenta. The menus
use no drawings: at load, a small studio (`src/ui/pictures.ts`) photographs
every tower with the same builders the floor uses.

## Bare hands — your left palm is the menu

The game reads controllers or tracked hands through one layer
(`src/input/intents.ts`), so nothing downstream knows which you are using. On
hands, everything is **poked with your right index finger**.

- **Turn your left palm toward you.** One panel rises over it, facing you:
  - **The header** across the top: the wave, the time to the horn (or how
    many are left), your coins, and the buttons a hand doesn't have:
    **HORN** (call the wave now), **PAUSE**, and **TURN** / **DOWN** while
    you're holding a tower.
  - **The towers** below it: each tile shows the tower's picture and price,
    dimmed when you can't afford it. Poke one to pick it up, aim with your
    right hand and **pinch** to put it down. Poke the same tile again to put
    it away.

  Header and tiles are one flat panel, so nothing on it can hide anything
  else.
- **Touch a tower** (either hand) to open its panel: UPGRADE, SELL, CLOSE, with
  its reach drawn on the floor while it's open.
- **Panels come to you.** Pause and tower panels appear within arm's reach,
  and you press them by touch.

With controllers, the same verbs are on trigger, Ⓐ, Ⓑ and Ⓧ/Ⓨ: aim at a
tower and pull the trigger to open its panel.

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
```

On Quest, open the page and tap **PLAY**. Mark out your floor (SETTINGS → SET
THE FLOOR), then **MAN THE WALLS**. On desktop, the IWSDK dev plugin's emulator
stands in. Its hands can be switched on from its panel.

## Checks

```bash
npm run typecheck
npm run dev &
node tools/siege-walk.mjs   # end to end: lanes, wave 1, coins, upgrade, sell, a leak, the fall
node tools/hand-walk.mjs    # bare hands: the palm panel, pokes, touching a tower to upgrade and sell
node tools/horde-look.mjs   # 3,600 alive at once (sim cost), then a real 2,600-mite wave vs a ring of towers
node tools/weapons-look.mjs # each tower photographed firing (shots/weapons/)
node tools/enemy-look.mjs   # the three kinds, close up, and a crowd
node tools/floor-walk.mjs   # the hazard-tape floor
```

## Map of the parts

```
src/factory/lanes.ts      THE LANES: routed over the grid from each crack to the core
src/factory/horde.ts      THE HORDE: every crawler as typed-array columns (cap 4,096),
                          walking its lane, and a spatial hash for splash and chains
src/factory/siege.ts      the fight's sim: waves (streams), lanes, leaks, coins, the five
                          towers and their levels, shells, bolts, burning
src/systems/laneStrips.ts the lanes drawn: neon roads with chevrons flowing to the core
src/systems/swarm.ts      the horde drawn: every crawler in ONE instanced draw call with
                          its legs animated on the GPU; shards and floor splats
src/systems/SiegeSystem.ts  the fight drawn and voiced: the swarm, deaths, tracers,
                          lobbed shells, bolts, fire, the ram, level rings, the core's plate
src/systems/HandSystem.ts reads controllers or hands into intents; owns the palm panel
src/config.ts             THE SIEGE: enemies, TOWERS, costs and levels, the ten waves
```

`DESIGN.md` and `FACTORY.md` are TUBES' design notes, kept because everything
here still runs on them.
